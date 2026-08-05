// Session-scoped File harness for the Pi Agent loop.
//
// It deliberately contains no Pi SDK dependency and emits no transport events. PiRuntime owns
// the agent loop; callers can replace or remove this harness without changing that loop.

export { WorkspaceAccessPolicy } from './access-policy';
export type { ToolAccessDecision, WorkspaceAccessContext, WorkspaceAccessMode } from './access-policy';

import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { zipSync } from 'fflate';

import {
  fileTypeOf,
  type AgentContentBlock,
  type Artifact,
  type FileNode,
  type FileType,
  type Message,
} from '../../core/agent/protocol';
import { extractOfficePreview, isOfficeFile, isOfficeWorkbookFile } from './office';

export const MAX_WORKSPACE_OFFICE_BYTES = 50 * 1024 * 1024;
export const MAX_BINARY_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_CANVAS_RAW_BYTES = 20 * 1024 * 1024;
export const MAX_ARCHIVE_FILES = 500;
export const MAX_ARCHIVE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_TOTAL_BYTES = 256 * 1024 * 1024;

const CANVAS_BINARY_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const MAX_WORKSPACE_FILES = 500;
const MAX_WORKSPACE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WORKSPACE_TOTAL_BYTES = 256 * 1024 * 1024;
const IGNORED_WORKSPACE_DIRS = new Set(['.git', '.pi-workspace', 'node_modules', 'dist', 'build', '.next', 'coverage']);
const TEXT_FILE_NAMES = new Set(['dockerfile', 'makefile', 'procfile', 'license']);
const TEXT_FILE_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'log', 'csv', 'tsv', 'html', 'htm', 'json', 'mmd', 'mermaid', 'excalidraw',
  'py', 'pyw', 'pyi', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'mts', 'cts',
  'sh', 'bash', 'zsh', 'fish', 'css', 'scss', 'less', 'xml', 'yml', 'yaml', 'toml',
  'ini', 'cfg', 'conf', 'java', 'kt', 'scala', 'groovy', 'c', 'h', 'cpp', 'cc', 'hpp',
  'cxx', 'go', 'rs', 'rb', 'php', 'sql', 'r', 'lua', 'pl', 'pm', 'swift', 'dart',
  'vue', 'svelte', 'gradle',
]);
const CANVAS_PREVIEW_TYPES = new Set<FileType>([
  'md', 'sheet', 'fig', 'png', 'html', 'code', 'json', 'mermaid', 'excalidraw', 'pdf',
]);
const ARTIFACT_LABELS: Partial<Record<FileType, string>> = {
  md: 'Markdown',
  sheet: '表格',
  fig: '设计文件',
  png: '图像',
  html: 'HTML',
  code: '代码',
  json: 'JSON',
  mermaid: 'Mermaid',
  excalidraw: 'Excalidraw',
  pdf: 'PDF',
  doc: 'Word',
  slides: '演示文稿',
  binary: '文件',
};
const ARTIFACT_DISCLOSURE_HINT = /(?:文件(?:路径|位置)?|输出文件|生成文件|产物|保存(?:路径|位置|到|至)|file\s*path|output\s*file|(?:浏览器|canvas|画布).*?(?:打开|预览|使用))/iu;

export type HarnessFileEvent = { file: FileNode; content: string };
export type HarnessSync = { deleted: string[]; files: HarnessFileEvent[] };
export type FileWriteResult = { ok: boolean; file?: FileNode; content?: string; error?: string };
export type FileRenameResult = FileWriteResult & { path?: string; previousPath?: string };
export type FileDeleteResult = { ok: boolean; path?: string; tracked?: boolean; error?: string };
export type FileReadResult = { ok: boolean; data?: Buffer; contentType?: string; path?: string; error?: string };
export type FileArchiveResult = { ok: boolean; data?: Buffer; files?: string[]; error?: string };
export interface AgentOutputProjection {
  text: string;
  blocks: AgentContentBlock[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function maxFileBytes(name: string): number {
  const type = fileTypeOf(name);
  if (type === 'binary') return MAX_BINARY_BYTES;
  if (isOfficeFile(name) || type === 'pdf') return MAX_WORKSPACE_OFFICE_BYTES;
  if (type === 'png') return MAX_IMAGE_BYTES;
  return MAX_WORKSPACE_FILE_BYTES;
}

function isWorkspaceTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('.')) return false;
  if (TEXT_FILE_NAMES.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && TEXT_FILE_EXTENSIONS.has(lower.slice(dot + 1));
}

function binaryFileNotice(name: string, size: number, modified: number): string {
  return `__PI_BINARY_FILE__:${JSON.stringify({ name, size, modified: Math.floor(modified) })}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripArtifactDisclosure(text: string, artifacts: ReadonlyArray<Artifact>): string {
  if (!text || !artifacts.length) return text;
  const names = [...new Set(artifacts.flatMap(artifact => [artifact.name, artifact.path || '']).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const reference = new RegExp(names.map(escapeRegExp).join('|'), 'iu');
  const locator = /(?:文件(?:路径|位置)?|输出文件|生成文件|产物路径|保存(?:路径|位置|到|至)|file\s*path|output\s*file)\s*[：:]/iu;
  const generatedAnnouncement = /(?:文件|产物)\s*(?:已\s*)?(?:完成|创建|生成|更新|保存|写入)(?:如下)?\s*[：:]/iu;
  const openInstruction = /^(?:[。.!！]\s*)?(?:你\s*)?(?:(?:可以|可|请)\s*)?(?:直接\s*)?(?:在|用)?\s*(?:浏览器|canvas|画布).*?(?:打开|预览|使用)/iu;
  const artifactHeader = /^(?:已完成[。.!！：:]?\s*)?(?:[\w.+-]+\s*)?(?:(?:生成的?\s*)?(?:文件|产物)(?:如下)?|(?:文件|产物)\s*(?:已\s*)?(?:完成|创建|生成|更新|保存|写入)(?:如下)?)[：:]?$/iu;
  const pathOnly = /^(?:[-*]\s*)?(?:`|\[)?(?:[a-z]:[\\/]|\.{0,2}[\\/]|\.workspace[\\/]|[\w.-]+[\\/])?[\w./\\-]+\.[a-z0-9]{1,12}(?:`|\]\([^)]*\))?[。.]?$/iu;
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(paragraph => {
      const sentences = paragraph.match(/[^。！]+[。！]?/gu);
      if (!sentences || sentences.length < 2) return paragraph;
      return sentences.filter(sentence => {
        const value = sentence.trim().replace(/[。！]$/u, '').trim();
        return !(reference.test(value) && openInstruction.test(value));
      }).join('').trim();
    })
    .filter(Boolean);
  const kinds: Array<'locator' | 'open' | 'header' | 'content'> = [];
  for (const paragraph of paragraphs) {
    const hasReference = reference.test(paragraph);
    if (hasReference && (locator.test(paragraph) || generatedAnnouncement.test(paragraph) || pathOnly.test(paragraph))) {
      kinds.push('locator');
    } else if (openInstruction.test(paragraph) && (hasReference || kinds.at(-1) === 'locator')) {
      kinds.push('open');
    } else if (artifactHeader.test(paragraph)) {
      kinds.push('header');
    } else {
      kinds.push('content');
    }
  }
  return paragraphs.filter((_paragraph, index) => {
    if (kinds[index] === 'locator' || kinds[index] === 'open') return false;
    if (kinds[index] === 'header') return false;
    return true;
  }).join('\n\n').trim();
}

function artifactForPath(path: string): Artifact {
  const type = fileTypeOf(path);
  return {
    name: basename(path),
    path,
    type,
    label: ARTIFACT_LABELS[type] || '文件',
    canvasPreview: CANVAS_PREVIEW_TYPES.has(type),
  };
}

function safeWorkspacePreview(name: string, abs: string, st: { size: number; mtimeMs: number }, allowPreview = true): string {
  const previewable = isWorkspaceTextFile(name) || isOfficeWorkbookFile(name);
  const limit = maxFileBytes(name);
  if (!allowPreview || !previewable || st.size > limit) return binaryFileNotice(name, st.size, st.mtimeMs);
  try {
    const raw = readFileSync(abs);
    if (isOfficeWorkbookFile(name)) return extractOfficePreview(name, raw);
    if (raw.includes(0)) throw new Error('binary');
    return raw.toString('utf8');
  } catch {
    return binaryFileNotice(name, st.size, st.mtimeMs);
  }
}

/** The removable filesystem layer between an Agent turn and Canvas Files. */
export class FileHarness {
  private files = new Map<string, string>();
  private turnArtifacts = new Set<string>();

  constructor(private readonly workspacePath: () => string) {}

  private get root() { return resolve(this.workspacePath()); }

  resolveFile(path: string): { abs: string; rel: string } {
    const raw = String(path || '').trim().replace(/\\/g, '/');
    if (!raw || raw.includes('\0')) throw new Error('无效文件路径');
    const abs = isAbsolute(raw) ? resolve(raw) : resolve(this.root, raw.replace(/^\.?\//, ''));
    const rel = relative(this.root, abs).replace(/\\/g, '/');
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('文件必须位于当前工作目录内');
    return { abs, rel };
  }

  private describe(path: string, content: string): HarnessFileEvent {
    let size = formatSize(Buffer.byteLength(content));
    try { size = formatSize(statSync(join(this.root, path)).size); } catch { /* use preview size */ }
    return { file: { name: basename(path), path, type: fileTypeOf(path), size }, content };
  }

  private scan(): Map<string, string> {
    const next = new Map<string, string>();
    let totalBytes = 0;
    try { mkdirSync(this.root, { recursive: true }); } catch { return next; }
    const visit = (dir: string, prefix: string) => {
      if (next.size >= MAX_WORKSPACE_FILES || totalBytes >= MAX_WORKSPACE_TOTAL_BYTES) return;
      let entries: Dirent<string>[];
      try { entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
      catch { return; }
      for (const entry of entries) {
        if (next.size >= MAX_WORKSPACE_FILES || totalBytes >= MAX_WORKSPACE_TOTAL_BYTES) break;
        if (entry.isSymbolicLink()) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !IGNORED_WORKSPACE_DIRS.has(entry.name.toLowerCase())) visit(abs, rel);
          continue;
        }
        if (!entry.isFile() || entry.name.startsWith('.')) continue;
        try {
          const st = statSync(abs);
          const previewable = isWorkspaceTextFile(entry.name) || isOfficeWorkbookFile(entry.name);
          const limit = maxFileBytes(entry.name);
          const mayRead = previewable && st.size <= limit && totalBytes + st.size <= MAX_WORKSPACE_TOTAL_BYTES;
          next.set(rel.replace(/\\/g, '/'), safeWorkspacePreview(entry.name, abs, st, mayRead));
          if (mayRead) totalBytes += st.size;
        } catch { /* unreadable file */ }
      }
    };
    visit(this.root, '');
    return next;
  }

  reload(): void { this.files = this.scan(); }
  clear(): void { this.files.clear(); this.turnArtifacts.clear(); }
  clearTurn(): void { this.turnArtifacts.clear(); }
  has(path: string): boolean { return this.files.has(path); }
  content(path: string): string | undefined { return this.files.get(path); }
  cache(path: string, content: string): void { this.files.set(path, content); }

  saveText(path: string, content: string): FileWriteResult {
    try {
      const target = this.resolveFile(path);
      writeFileSync(target.abs, content, 'utf8');
      this.files.set(target.rel, content);
      return { ok: true, ...this.describe(target.rel, content) };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  importOffice(path: string, data: string): FileWriteResult {
    try {
      const ft = fileTypeOf(path);
      if (!isOfficeFile(path) && !['pdf', 'png', 'binary'].includes(ft)) return { ok: false, error: '不支持的文件类型，仅支持图片、PDF、压缩包和 Office 文档' };
      const raw = Buffer.from(data || '', 'base64');
      if (!raw.length) return { ok: false, error: '文件内容为空' };
      const maxBytes = ft === 'binary' ? MAX_BINARY_BYTES : (ft === 'pdf' || isOfficeFile(path)) ? MAX_WORKSPACE_OFFICE_BYTES : MAX_IMAGE_BYTES;
      if (raw.length > maxBytes) return { ok: false, error: `文件不能超过 ${maxBytes / (1024 * 1024)}MB` };
      const target = this.resolveFile(path);
      writeFileSync(target.abs, raw);
      const imported = this.capture(target.rel);
      return imported ? { ok: true, ...imported } : { ok: false, error: '无法读取已导入的文件' };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  renameFile(path: string, nextPath: string): FileRenameResult {
    try {
      const from = this.resolveFile(path);
      const to = this.resolveFile(nextPath);
      if (!existsSync(from.abs) || !statSync(from.abs).isFile()) return { ok: false, error: '源文件不存在' };
      if (existsSync(to.abs)) return { ok: false, error: '目标文件已存在' };
      renameSync(from.abs, to.abs);
      const cached = this.rename(from.rel, to.rel);
      const renamed = cached == null ? this.capture(to.rel) : this.describe(to.rel, cached);
      return {
        ok: true,
        path: to.rel,
        previousPath: from.rel,
        file: renamed?.file,
        content: renamed?.content,
      };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  deleteFile(path: string): FileDeleteResult {
    try {
      const target = this.resolveFile(path);
      if (!existsSync(target.abs) || !statSync(target.abs).isFile()) return { ok: false, error: '文件不存在' };
      unlinkSync(target.abs);
      return { ok: true, path: target.rel, tracked: this.delete(target.rel) };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  snapshot(): HarnessFileEvent[] {
    return [...this.files.entries()].map(([path, content]) => this.describe(path, content));
  }

  capture(rawPath: string): HarnessFileEvent | null {
    try {
      const target = this.resolveFile(rawPath);
      const st = statSync(target.abs);
      if (!st.isFile() || basename(target.rel).startsWith('.')) return null;
      const content = safeWorkspacePreview(basename(target.rel), target.abs, st);
      this.files.set(target.rel, content);
      this.turnArtifacts.add(target.rel);
      return this.describe(target.rel, content);
    } catch { return null; }
  }

  sync(): HarnessSync {
    const previous = this.files;
    const next = this.scan();
    this.files = next;
    const deleted: string[] = [];
    const files: HarnessFileEvent[] = [];
    for (const path of previous.keys()) {
      if (!next.has(path)) {
        this.turnArtifacts.delete(path);
        deleted.push(path);
      }
    }
    for (const [path, content] of next) {
      if (previous.get(path) !== content) {
        this.turnArtifacts.add(path);
        files.push(this.describe(path, content));
      }
    }
    return { deleted, files };
  }

  rename(from: string, to: string): string | undefined {
    const content = this.files.get(from);
    this.files.delete(from);
    if (this.turnArtifacts.delete(from)) this.turnArtifacts.add(to);
    if (content != null) this.files.set(to, content);
    return content;
  }

  delete(path: string): boolean {
    const tracked = this.files.delete(path);
    this.turnArtifacts.delete(path);
    return tracked;
  }

  finalArtifacts(): Artifact[] {
    return [...this.turnArtifacts].filter(path => this.files.has(path)).map(artifactForPath);
  }

  /** Replace path-only Agent prose with the structured Artifact channel. The card remains a
   * Canvas concern; the filesystem-aware recognition and safe path matching live here. */
  projectAgentOutput(
    text: string,
    blocks: ReadonlyArray<AgentContentBlock>,
    artifacts: ReadonlyArray<Artifact>,
  ): AgentOutputProjection {
    return {
      text: stripArtifactDisclosure(text, artifacts),
      blocks: blocks.flatMap<AgentContentBlock>(block => {
        if (block.kind !== 'text') return [{ ...block }];
        const projected = stripArtifactDisclosure(block.text, artifacts);
        return projected ? [{ ...block, text: projected }] : [];
      }),
    };
  }

  private inferMessageArtifacts(message: Message): Artifact[] {
    const paragraphs = [
      message.intro || '',
      message.outro || '',
      ...(message.blocks || [])
        .filter((block): block is Extract<AgentContentBlock, { kind: 'text' }> => block.kind === 'text')
        .map(block => block.text),
    ].join('\n\n').replace(/\r\n/g, '\n').split(/\n{2,}/).map(value => value.trim()).filter(Boolean);
    if (!paragraphs.some(paragraph => ARTIFACT_DISCLOSURE_HINT.test(paragraph))) return [];
    return [...this.files.keys()]
      .filter(path => {
        const references = [path.replace(/\\/g, '/'), basename(path)]
          .map(value => value.toLocaleLowerCase());
        return paragraphs.some(paragraph => {
          if (!ARTIFACT_DISCLOSURE_HINT.test(paragraph)) return false;
          const normalized = paragraph.replace(/\\/g, '/').toLocaleLowerCase();
          return references.some(reference => normalized.includes(reference));
        });
      })
      .map(artifactForPath);
  }

  /** Re-project durable transcripts created before the current disclosure rules existed.
   * Stored Artifacts win; older path announcements can recover entries only from real files in
   * the active session workspace. */
  projectMessage(message: Message): Message {
    if (message.role !== 'agent') return message;
    const artifacts = message.artifacts?.length
      ? message.artifacts
      : this.inferMessageArtifacts(message);
    if (!artifacts.length) return message;
    const projected = this.projectAgentOutput(
      message.intro || '',
      message.blocks || [],
      artifacts,
    );
    const outro = this.projectAgentOutput(message.outro || '', [], artifacts).text.trim();
    return {
      ...message,
      intro: projected.text.trim() || undefined,
      blocks: message.blocks ? projected.blocks : undefined,
      outro: outro || undefined,
      artifacts,
    };
  }

  readCanvasBinary(path: string): { ok: boolean; data?: Buffer; contentType?: string; error?: string } {
    try {
      const target = this.resolveFile(path);
      if (target.rel.split('/').some(part => part.startsWith('.'))) return { ok: false, error: '不允许预览隐藏文件' };
      const st = statSync(target.abs);
      if (!st.isFile()) return { ok: false, error: '文件不存在' };
      if (st.size > MAX_CANVAS_RAW_BYTES) return { ok: false, error: '文件超过 Canvas 预览大小限制（20MB）' };
      const ext = target.rel.slice(target.rel.lastIndexOf('.') + 1).toLowerCase();
      return { ok: true, data: readFileSync(target.abs), contentType: CANVAS_BINARY_CONTENT_TYPES[ext] || 'application/octet-stream' };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  private downloadableFile(path: string): {
    abs: string;
    rel: string;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    dev: number;
    ino: number;
  } {
    const target = this.resolveFile(path);
    if (target.rel.split('/').some(part => part.startsWith('.'))) throw new Error('不允许下载隐藏文件');
    const link = lstatSync(target.abs);
    if (link.isSymbolicLink()) throw new Error('不允许下载符号链接');
    if (!link.isFile()) throw new Error('文件不存在');
    const rootReal = realpathSync(this.root);
    const fileReal = realpathSync(target.abs);
    const realRel = relative(rootReal, fileReal).replace(/\\/g, '/');
    if (!realRel || realRel === '..' || realRel.startsWith('../') || isAbsolute(realRel)) {
      throw new Error('文件必须位于当前工作目录内');
    }
    const limit = MAX_ARCHIVE_FILE_BYTES;
    if (link.size > limit) throw new Error(`文件超过下载大小限制（${Math.floor(limit / (1024 * 1024))}MB）`);
    return {
      abs: target.abs,
      rel: target.rel,
      size: link.size,
      mtimeMs: link.mtimeMs,
      ctimeMs: link.ctimeMs,
      dev: link.dev,
      ino: link.ino,
    };
  }

  /** Open once, verify the opened object against the authorized path snapshot, read from that
   * same descriptor, then verify it again. O_NOFOLLOW closes the final-component symlink race
   * where the platform supports it; dev/ino also catches parent replacement between checks. */
  private readStableDownloadFile(
    target: ReturnType<FileHarness['downloadableFile']>,
    action: '下载' | '归档',
  ): Buffer {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    let fd: number | null = null;
    try {
      fd = openSync(target.abs, fsConstants.O_RDONLY | noFollow);
      const before = fstatSync(fd);
      if (!before.isFile()) throw new Error('文件不存在');
      if (
        before.dev !== target.dev ||
        before.ino !== target.ino ||
        before.size !== target.size ||
        before.mtimeMs !== target.mtimeMs ||
        before.ctimeMs !== target.ctimeMs
      ) {
        throw new Error(`文件在${action}准备期间发生变化${action === '归档' ? `：${target.rel}` : '，请重试'}`);
      }
      const data = readFileSync(fd);
      const after = fstatSync(fd);
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        data.length !== before.size
      ) {
        throw new Error(`文件在${action}准备期间发生变化${action === '归档' ? `：${target.rel}` : '，请重试'}`);
      }
      return data;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  readDownload(path: string): FileReadResult {
    try {
      const target = this.downloadableFile(path);
      const data = this.readStableDownloadFile(target, '下载');
      const ext = target.rel.slice(target.rel.lastIndexOf('.') + 1).toLowerCase();
      return {
        ok: true,
        data,
        path: target.rel,
        contentType: CANVAS_BINARY_CONTENT_TYPES[ext] || 'application/octet-stream',
      };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  archive(paths: ReadonlyArray<string>): FileArchiveResult {
    try {
      const unique = new Map<string, ReturnType<FileHarness['downloadableFile']>>();
      const collisions = new Map<string, string>();
      for (const rawPath of paths) {
        const target = this.downloadableFile(String(rawPath || ''));
        const collisionKey = target.rel.toLocaleLowerCase('en-US');
        const previous = collisions.get(collisionKey);
        if (previous && previous !== target.rel) {
          throw new Error(`归档路径大小写冲突：${previous} / ${target.rel}`);
        }
        collisions.set(collisionKey, target.rel);
        unique.set(target.rel, target);
      }
      const files = [...unique.values()].sort((a, b) => a.rel.localeCompare(b.rel, 'en-US'));
      if (!files.length) throw new Error('请至少选择一个文件');
      if (files.length > MAX_ARCHIVE_FILES) throw new Error(`一次最多下载 ${MAX_ARCHIVE_FILES} 个文件`);
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (total > MAX_ARCHIVE_TOTAL_BYTES) {
        throw new Error(`归档总大小不能超过 ${MAX_ARCHIVE_TOTAL_BYTES / (1024 * 1024)}MB`);
      }
      const entries: Record<string, Uint8Array> = {};
      for (const file of files) {
        entries[file.rel.replace(/\\/g, '/')] = this.readStableDownloadFile(file, '归档');
      }
      return {
        ok: true,
        data: Buffer.from(zipSync(entries, { level: 6 })),
        files: files.map(file => file.rel),
      };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

}
