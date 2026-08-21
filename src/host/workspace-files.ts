/**
 * Workspace file service for the Canvas host wire (host.listFiles /
 * host.readFile / host.writeFile). One root per call, resolved by the client
 * from the session's workspace path; every operation canonicalizes the root
 * and the target and rejects paths that escape it. The service mirrors the
 * semantics of the Pi Canvas FileHarness it ports: recursive capped listing
 * that skips hidden and tooling entries, text-vs-binary preview decisions,
 * and size caps on reads and writes. It uses plain node:fs — the API proxy
 * does not require the fs capability row — and throws typed
 * {@link WorkspaceFileError} values that the proxy maps onto wire codes.
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceFileKind, WorkspaceFileListing, WorkspaceFileNode, WorkspaceFileRead, WorkspaceFileWrite } from '../workspace-protocol.ts'
import { extractOfficePreview, isOfficeFile } from './workspace-office.ts'

/** Recursive listing cap: total files (files + folders) visited. */
export const MAX_LIST_FILES = 500
/** Recursive listing depth cap. */
export const MAX_LIST_DEPTH = 24
/** Total bytes of file content the listing may account for. */
export const MAX_LIST_TOTAL_BYTES = 256 * 1024 * 1024
/** Per-file text preview cap (also the text read slice cap). */
export const MAX_TEXT_READ_BYTES = 2 * 1024 * 1024
/** Per-file binary preview cap (image/PDF/office). */
export const MAX_BINARY_READ_BYTES = 20 * 1024 * 1024
/** Text write cap. */
export const MAX_TEXT_WRITE_BYTES = 2 * 1024 * 1024
/** Binary write cap (base64-decoded bytes). */
export const MAX_BINARY_WRITE_BYTES = 20 * 1024 * 1024

/** Tooling/vendor directories the listing skips, mirroring the Pi FileHarness. */
const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.pi-workspace', '.dsh',
  'node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage', '.venv', 'venv',
])

/** Text extensions that count as previewable text (everything else is binary by extension). */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mmd', 'mermaid', 'txt', 'log', 'csv', 'tsv', 'html', 'htm', 'xml', 'json', 'jsonl',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'py', 'pyw', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'css', 'scss', 'less',
  'java', 'kt', 'kts', 'scala', 'groovy', 'c', 'h', 'cpp', 'cc', 'hpp', 'cxx', 'go', 'rs',
  'rb', 'php', 'sql', 'r', 'lua', 'pl', 'pm', 'swift', 'dart', 'vue', 'svelte', 'gradle',
])
const TEXT_BASENAMES = new Set(['dockerfile', 'makefile', 'procfile', 'license', 'readme'])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'])
const OFFICE_EXTENSIONS = new Set(['docx', 'docm', 'dotx', 'dotm', 'xlsx', 'xlsm', 'xltx', 'xltm', 'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'])

/** Wire error code of one typed workspace-file failure. */
export type WorkspaceFileErrorCode =
  | 'workspace-invalid-path'
  | 'workspace-root-missing'
  | 'workspace-file-not-found'
  | 'workspace-file-unreadable'
  | 'workspace-file-too-large'
  | 'workspace-path-outside-root'
  | 'workspace-write-invalid'
  | 'workspace-write-failed'

/** Typed failure the proxy maps onto the wire vocabulary. */
export class WorkspaceFileError extends Error {
  constructor(
    readonly code: WorkspaceFileErrorCode,
    message: string,
    readonly details: { path?: string; totalBytes?: number; maxBytes?: number; reason?: string } = {},
  ) {
    super(message)
    this.name = 'WorkspaceFileError'
  }
}

/**
 * Map a typed Workspace failure to a wire error.
 * @param error - caught Workspace file failure.
 * @returns the corresponding public RPC error.
 */
function extensionOf(name: string): string {
  const clean = name.toLowerCase().split(/[?#]/)[0] ?? ''
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1) : ''
}

function kindOf(name: string): WorkspaceFileKind {
  const base = name.toLowerCase()
  const ext = extensionOf(base)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(base.replace(/\./g, ''))) return 'text'
  return 'binary'
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name.endsWith('~') || name.startsWith('#')
}

/** Canonicalize a path that must exist; resolves symlinks for the deepest existing ancestor. */
function canonicalize(input: string): string {
  const absolute = resolve(input)
  let cursor = absolute
  const suffix: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) break
    suffix.unshift(cursor.slice(parent.length).replace(/^[/\\]+/u, ''))
    cursor = parent
  }
  const base = existsSync(cursor) ? realpathSync.native(cursor) : cursor
  return resolve(base, ...suffix)
}

/** POSIX-relative path of `target` against `root`, or null when it escapes. */
function relativeWithin(root: string, target: string): string | null {
  const rel = relative(root, target)
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/** Resolve `root` + relative `path` into a canonical absolute target, enforcing containment. */
function resolveTarget(root: string, path: string): { rootReal: string; target: string; rel: string } {
  const rootReal = canonicalize(root)
  if (!existsSync(rootReal) || !statSync(rootReal).isDirectory()) {
    throw new WorkspaceFileError('workspace-root-missing', `工作区根目录不存在：${root}`, { path: root })
  }
  const normalized = (path || '').replace(/\\/g, '/').replace(/^\.?\//, '')
  if (!normalized || normalized.split('/').some(segment => segment === '..' || segment === '.')) {
    throw new WorkspaceFileError('workspace-path-outside-root', `路径不在工作区内：${path}`, { path })
  }
  const target = resolve(rootReal, normalized)
  const rel = relativeWithin(rootReal, target)
  if (rel === null) {
    throw new WorkspaceFileError('workspace-path-outside-root', `路径不在工作区内：${path}`, { path })
  }
  return { rootReal, target, rel }
}

/** Read the whole regular file, enforcing a byte cap before buffering. */
function readCapped(target: string, cap: number): Uint8Array {
  const info = statSync(target)
  if (!info.isFile()) throw new WorkspaceFileError('workspace-file-unreadable', '不是普通文件', { path: target })
  if (info.size > cap) {
    throw new WorkspaceFileError('workspace-file-too-large', `文件超过预览大小限制（${Math.floor(cap / (1024 * 1024))}MB）`, {
      path: target, totalBytes: info.size, maxBytes: cap,
    })
  }
  return readFileSync(target)
}

/** Registered-Workspace filesystem operations used by the Canvas wire. */
export class WorkspaceFiles {
  /**
   * @param registeredRoots - current canonical Workspace roots. File calls
   * are accepted only for one of these roots; a browser payload cannot turn
   * this service into an arbitrary host-filesystem reader.
   */
  constructor(private readonly registeredRoots: () => readonly string[]) {}

  /** Resolve and authorize one requested Workspace root. */
  private root(root: string): string {
    const rootReal = canonicalize(root)
    const registered = this.registeredRoots().some(candidate => canonicalize(candidate) === rootReal)
    if (!registered) {
      throw new WorkspaceFileError('workspace-invalid-path', `目录不是已注册的工作区：${root}`, { path: root })
    }
    return rootReal
  }

  /**
   * Recursively list one workspace root (capped, hidden/tooling entries skipped).
   * @param root - absolute workspace root to list.
   * @returns the listing; `truncated` reports a cap stop.
   */
  list(root: string): WorkspaceFileListing {
    const rootReal = this.root(root)
    if (!existsSync(rootReal) || !statSync(rootReal).isDirectory()) {
      throw new WorkspaceFileError('workspace-root-missing', `工作区根目录不存在：${root}`, { path: root })
    }
    const state = { files: 0, bytes: 0, truncated: false }
    const visit = (dir: string, prefix: string, depth: number): WorkspaceFileNode[] => {
      if (depth > MAX_LIST_DEPTH) { state.truncated = true; return [] }
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
      } catch {
        state.truncated = true
        return []
      }
      const nodes: WorkspaceFileNode[] = []
      for (const entry of entries) {
        if (state.files >= MAX_LIST_FILES) { state.truncated = true; break }
        if (entry.isSymbolicLink() || isHidden(entry.name)) continue
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name.toLowerCase())) continue
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          state.files++
          const children = visit(join(dir, entry.name), rel, depth + 1)
          nodes.push({ name: entry.name, path: rel, kind: 'folder', children })
          continue
        }
        if (!entry.isFile()) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        state.files++
        let size: number | undefined
        try { size = statSync(join(dir, entry.name)).size } catch { /* absent between readdir and stat */ }
        state.bytes += size ?? 0
        if (state.bytes > MAX_LIST_TOTAL_BYTES) { state.truncated = true; break }
        nodes.push({ name: entry.name, path: rel, kind: kindOf(entry.name), ...(size !== undefined ? { size } : {}) })
      }
      // Folders first, then natural name order — the Canvas tree convention.
      nodes.sort((a, b) => (a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1)
        || a.name.localeCompare(b.name, 'en', { numeric: true }))
      return nodes
    }
    return { root: rootReal, files: visit(rootReal, '', 0), truncated: state.truncated }
  }

  /**
   * Read one workspace file for preview.
   * @param root - absolute workspace root.
   * @param path - POSIX-relative path within the root.
   * @param opts - optional slice bounds (offset/maxBytes for text files).
   * @returns the decoded text slice or base64 binary payload.
   */
  read(root: string, path: string, opts: { offset?: number; maxBytes?: number } = {}): WorkspaceFileRead {
    const { target, rel } = resolveTarget(this.root(root), path)
    if (!existsSync(target)) {
      throw new WorkspaceFileError('workspace-file-not-found', `文件不存在：${path}`, { path })
    }
    if (isOfficeFile(rel)) {
      // Office Open XML documents get a semantic text preview on the host
      // (Word/PPT prose, Excel sheet-table JSON), never raw base64.
      const bytes = readCapped(target, MAX_BINARY_READ_BYTES)
      const content = extractOfficePreview(rel, bytes)
      return {
        path: rel,
        content,
        truncated: false,
        totalBytes: bytes.length,
      }
    }
    if (kindOf(rel) !== 'text') {
      const bytes = readCapped(target, MAX_BINARY_READ_BYTES)
      return {
        path: rel,
        base64: Buffer.from(bytes).toString('base64'),
        contentType: binaryContentType(rel),
        truncated: false,
        totalBytes: bytes.length,
      }
    }
    const fd = openSync(target, 'r')
    try {
      const fileInfo = fstatSync(fd)
      const offset = Math.min(opts.offset ?? 0, fileInfo.size)
      const cap = Math.min(MAX_TEXT_READ_BYTES, opts.maxBytes ?? MAX_TEXT_READ_BYTES)
      const length = Math.min(cap, Math.max(0, fileInfo.size - offset))
      const buffer = Buffer.alloc(length)
      let position = 0
      while (position < length) {
        const count = readSync(fd, buffer, position, length - position, offset + position)
        if (count <= 0) break
        position += count
      }
      const content = buffer.subarray(0, position).toString('utf8')
      if (content.includes('\u0000')) {
        // A "text" extension can still hold binary bytes; hand the client the
        // raw payload instead of a corrupted decode.
        return {
          path: rel,
          base64: buffer.subarray(0, position).toString('base64'),
          contentType: 'application/octet-stream',
          truncated: false,
          totalBytes: fileInfo.size,
        }
      }
      return {
        path: rel,
        content,
        truncated: offset + position < fileInfo.size,
        totalBytes: fileInfo.size,
      }
    } finally {
      closeSync(fd)
    }
  }

  /**
   * Write one workspace file (text or base64 binary), creating parents.
   * @param root - absolute workspace root.
   * @param path - POSIX-relative path within the root.
   * @param input - exactly one of `content` (UTF-8 text) or `base64` (binary).
   * @returns the resolved relative path.
   */
  write(root: string, path: string, input: { content?: string; base64?: string }): WorkspaceFileWrite {
    const { target, rel } = resolveTarget(this.root(root), path)
    if ((input.content !== undefined) === (input.base64 !== undefined)) {
      throw new WorkspaceFileError('workspace-write-invalid', '必须且只能提供 content 或 base64 之一', {})
    }
    if (rel.split('/').some(segment => segment.startsWith('.'))) {
      throw new WorkspaceFileError('workspace-write-invalid', '不允许写入隐藏文件', {})
    }
    const existing = existsSync(target) ? statSync(target) : null
    if (existing !== null && existing.isDirectory()) {
      throw new WorkspaceFileError('workspace-write-failed', '目标路径是目录', { path: rel })
    }
    try {
      mkdirSync(dirname(target), { recursive: true })
      if (input.base64 !== undefined) {
        const bytes = Buffer.from(input.base64, 'base64')
        if (bytes.length > MAX_BINARY_WRITE_BYTES) {
          throw new WorkspaceFileError('workspace-write-invalid', `文件不能超过 ${Math.floor(MAX_BINARY_WRITE_BYTES / (1024 * 1024))}MB`, {})
        }
        writeFileSync(target, bytes)
      } else {
        const content = input.content as string
        if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_WRITE_BYTES) {
          throw new WorkspaceFileError('workspace-write-invalid', `文本不能超过 ${Math.floor(MAX_TEXT_WRITE_BYTES / (1024 * 1024))}MB`, {})
        }
        if (content.includes('\u0000')) {
          throw new WorkspaceFileError('workspace-write-invalid', '文本内容包含 NUL 字节', {})
        }
        writeFileSync(target, content, 'utf8')
      }
    } catch (error) {
      if (error instanceof WorkspaceFileError) throw error
      throw new WorkspaceFileError('workspace-write-failed', `写入失败：${error instanceof Error ? error.message : String(error)}`, { path: rel })
    }
    return { path: rel }
  }

  /**
   * Rename one workspace file within the root (new name only — the parent
   * stays the source's parent). Fails when the target already exists.
   * @param root - absolute workspace root.
   * @param path - POSIX-relative source path.
   * @param nextName - single non-blank path segment.
   * @returns the resolved relative path.
   */
  rename(root: string, path: string, nextName: string): WorkspaceFileWrite {
    const { target, rel } = resolveTarget(this.root(root), path)
    const name = nextName.trim()
    if (!name || name === '.' || name === '..' || /[/\\\u0000]/.test(name) || /[. ]$/.test(name)) {
      throw new WorkspaceFileError('workspace-write-invalid', '文件名不能包含 / \\ 或 NUL，也不能以空格或句点结尾', {})
    }
    if (rel.split('/').some(segment => segment.startsWith('.'))) {
      throw new WorkspaceFileError('workspace-write-invalid', '不允许重命名隐藏文件', {})
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new WorkspaceFileError('workspace-file-not-found', `文件不存在：${path}`, { path })
    }
    const slash = rel.lastIndexOf('/')
    const nextRel = slash >= 0 ? `${rel.slice(0, slash + 1)}${name}` : name
    const nextTarget = resolve(dirname(target), name)
    if (existsSync(nextTarget)) {
      throw new WorkspaceFileError('workspace-write-failed', '目标文件已存在', { path: nextRel })
    }
    try {
      renameSync(target, nextTarget)
    } catch (error) {
      throw new WorkspaceFileError('workspace-write-failed', `重命名失败：${error instanceof Error ? error.message : String(error)}`, { path: rel })
    }
    return { path: nextRel }
  }

  /**
   * Delete one workspace file.
   * @param root - absolute workspace root.
   * @param path - POSIX-relative path.
   * @returns the deleted relative path.
   */
  remove(root: string, path: string): WorkspaceFileWrite {
    const { target, rel } = resolveTarget(this.root(root), path)
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new WorkspaceFileError('workspace-file-not-found', `文件不存在：${path}`, { path })
    }
    try {
      unlinkSync(target)
    } catch (error) {
      throw new WorkspaceFileError('workspace-write-failed', `删除失败：${error instanceof Error ? error.message : String(error)}`, { path: rel })
    }
    return { path: rel }
  }

  /**
   * Move one workspace file to a new location within the root (a full
   * relative destination; the destination's parent must already exist).
   * Fails when the destination exists or equals the source.
   * @param root - absolute workspace root.
   * @param path - POSIX-relative source path.
   * @param targetPath - POSIX-relative destination path.
   * @returns the resolved relative destination path.
   */
  move(root: string, path: string, targetPath: string): WorkspaceFileWrite {
    const { target, rel } = resolveTarget(this.root(root), path)
    const { target: nextTarget, rel: nextRel } = resolveTarget(this.root(root), targetPath)
    if (rel.split('/').some(segment => segment.startsWith('.')) || nextRel.split('/').some(segment => segment.startsWith('.'))) {
      throw new WorkspaceFileError('workspace-write-invalid', '不允许移动隐藏文件', {})
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      throw new WorkspaceFileError('workspace-file-not-found', `文件不存在：${path}`, { path })
    }
    if (!existsSync(dirname(nextTarget)) || !statSync(dirname(nextTarget)).isDirectory()) {
      throw new WorkspaceFileError('workspace-write-failed', '目标目录不存在', { path: nextRel })
    }
    if (nextRel === rel) {
      throw new WorkspaceFileError('workspace-write-invalid', '目标位置与源位置相同', {})
    }
    if (existsSync(nextTarget)) {
      throw new WorkspaceFileError('workspace-write-failed', '目标文件已存在', { path: nextRel })
    }
    try {
      renameSync(target, nextTarget)
    } catch (error) {
      throw new WorkspaceFileError('workspace-write-failed', `移动失败：${error instanceof Error ? error.message : String(error)}`, { path: rel })
    }
    return { path: nextRel }
  }
}

function binaryContentType(path: string): string {
  const ext = extensionOf(path)
  const table: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    svg: 'image/svg+xml', webp: 'image/webp', pdf: 'application/pdf',
  }
  return table[ext] ?? 'application/octet-stream'
}
