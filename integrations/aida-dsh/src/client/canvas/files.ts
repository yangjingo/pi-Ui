/**
 * Pure workspace-file helpers for the AIDA Canvas: tree flattening, query
 * filtering, path utilities, and binary payload conversion. No React, no
 * transport — the panel and the tree render from these shapes only.
 */

import type { WorkspaceFileKind, WorkspaceFileNode } from '../../workspace-protocol.ts'
import { isSvgName } from './formats.ts'

/**
 * Flatten a listing tree to its leaf files.
 * @param nodes - recursive Workspace nodes.
 * @param result - accumulator used by recursive calls.
 * @returns the leaf file nodes in tree order.
 */
export function listFiles(nodes: readonly WorkspaceFileNode[], result: WorkspaceFileNode[] = []): WorkspaceFileNode[] {
  for (const node of nodes) {
    if (node.kind === 'folder') listFiles(node.children ?? [], result)
    else result.push(node)
  }
  return result
}

/**
 * Count files (leaves) under a listing.
 * @param nodes - recursive Workspace nodes.
 * @returns the number of non-folder nodes.
 */
export function countFiles(nodes: readonly WorkspaceFileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.kind === 'folder') count += countFiles(node.children ?? [])
    else count += 1
  }
  return count
}

/**
 * Read the last path segment.
 * @param path - slash- or backslash-separated path.
 * @returns the final segment without trailing separators.
 */
export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/**
 * Read the parent directory of a path.
 * @param path - Workspace-relative path.
 * @returns the parent path, or an empty string for a top-level file.
 */
export function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : ''
}

/**
 * Filter a tree case-insensitively; matching folders remain in the result.
 * @param nodes - recursive Workspace nodes.
 * @param query - path/name substring.
 * @returns a copied tree containing only matching branches.
 */
export function filterFileTree(nodes: readonly WorkspaceFileNode[], query: string): WorkspaceFileNode[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...nodes]
  const result: WorkspaceFileNode[] = []
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const children = filterFileTree(node.children ?? [], query)
      if (children.length > 0 || node.name.toLocaleLowerCase().includes(needle)) {
        result.push({ ...node, children })
      }
    } else if (node.path.toLocaleLowerCase().includes(needle) || node.name.toLocaleLowerCase().includes(needle)) {
      result.push(node)
    }
  }
  return result
}

/**
 * Flatten the visible leaf paths of a tree in render order, honoring the
 * collapsed set (the row order a shift+click range selection follows).
 * @param nodes - recursive Workspace nodes (already filtered).
 * @param collapsed - folder paths the user collapsed.
 * @returns the visible file paths in row order.
 */
export function visiblePathsOf(nodes: readonly WorkspaceFileNode[], collapsed: ReadonlySet<string>): string[] {
  const paths: string[] = []
  const visit = (list: readonly WorkspaceFileNode[]): void => {
    for (const node of list) {
      if (node.kind === 'folder') {
        if (!collapsed.has(node.path)) visit(node.children ?? [])
      } else {
        paths.push(node.path)
      }
    }
  }
  visit(nodes)
  return paths
}

/**
 * Decide whether a node has a source form the Canvas can edit: plain text
 * files and SVG documents (the host classifies SVG as an image, but its
 * source is UTF-8 text the canvas edits and writes back).
 * @param node - selected Workspace node, when any.
 * @returns true for text files and SVG documents.
 */
export function isSourceEditable(node: WorkspaceFileNode | undefined): boolean {
  if (node === undefined) return false
  if (node.kind === 'text') return true
  return node.kind === 'image' && isSvgName(node.name)
}

/**
 * Convert a file kind to its stable label.
 * @param kind - Workspace file kind.
 * @returns the corresponding lowercase label.
 */
export function kindLabel(kind: WorkspaceFileKind): string {
  switch (kind) {
    case 'folder': return 'folder'
    case 'text': return 'text'
    case 'image': return 'image'
    case 'pdf': return 'pdf'
    case 'office': return 'office'
    case 'binary': return 'binary'
  }
}

/**
 * Decode a base64 payload into a browser Blob.
 * @param base64 - encoded bytes.
 * @param contentType - MIME type assigned to the Blob.
 * @returns the decoded Blob.
 */
export function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: contentType })
}

/**
 * Decode a base64 payload into UTF-8 text (an SVG read arrives as base64
 * because the host classifies SVG as an image).
 * @param base64 - encoded bytes.
 * @returns the decoded text, or an empty string when the payload is invalid.
 */
export function base64ToText(base64: string): string {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

/**
 * Encode UTF-8 text as a base64 payload (the SVG preview consumes base64,
 * so a saved source is re-encoded locally to refresh the rendered image).
 * @param text - source text.
 * @returns the encoded payload.
 */
export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

/**
 * Parse a delimited table (RFC-4180 quoting: double quotes quote a field,
 * doubled quotes escape one; CRLF and LF both end rows). A trailing newline
 * does not add an empty row, and blank rows (every field empty) are dropped.
 * @param text - the raw table text.
 * @param delimiter - field separator (`,` or `\t`).
 * @returns the parsed rows.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const pushRow = (): void => {
    if (row.some(cell => cell !== '')) rows.push(row)
    row = []
    field = ''
  }
  for (let index = 0; index < input.length; index++) {
    const ch = input.charAt(index)
    if (quoted) {
      if (ch === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      pushRow()
    } else {
      field += ch
    }
  }
  row.push(field)
  if (row.length > 1 || field !== '') pushRow()
  return rows
}

/**
 * Encode bytes as base64 without a Buffer dependency.
 * @param bytes - bytes to encode.
 * @returns the base64 payload.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/**
 * Trigger a browser download for a Blob.
 * @param blob - content to download.
 * @param filename - suggested download name.
 */
export function saveBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() =>{  URL.revokeObjectURL(url) }, 0)
}
