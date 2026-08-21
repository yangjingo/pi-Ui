/**
 * Canvas file-format dispatch: which renderer a file's preview uses, derived
 * from its extension. Markdown, HTML, Mermaid, SVG, JSON, and CSV get
 * dedicated renderers (and keep the plain textarea for editing); source-code
 * extensions render with syntax highlighting; everything else stays the
 * generic text pane.
 */

/** Preview/rendering formats the Canvas understands. */
export type CanvasFileFormat = 'markdown' | 'html' | 'mermaid' | 'svg' | 'json' | 'csv' | 'code' | 'text'

/**
 * Resolve the Canvas renderer for a file name.
 * @param name - file name or relative path.
 * @returns the extension-selected render format.
 */
export function formatOf(name: string): CanvasFileFormat {
  const base = name.toLowerCase()
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid'
  if (ext === 'svg') return 'svg'
  if (ext === 'json' || ext === 'jsonl') return 'json'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (CODE_LANGS.has(ext)) return 'code'
  return 'text'
}

/**
 * Whether a file name is an SVG source document.
 * @param name - file name or relative path.
 * @returns true for a `.svg` name (case-insensitive).
 */
export function isSvgName(name: string): boolean {
  return name.toLowerCase().endsWith('.svg')
}

/**
 * Whether a file name is a tab-separated table.
 * @param name - file name or relative path.
 * @returns true for a `.tsv` name (case-insensitive).
 */
export function isTsvName(name: string): boolean {
  return name.toLowerCase().endsWith('.tsv')
}

/**
 * Map a file extension to the shiki language id `CodeBlock` accepts (the
 * alias table lives in ui-primitives; ids here resolve there). Extensions
 * whose grammar ui-primitives does not register are absent, so `formatOf`
 * keeps them on the plain text pane instead of claiming a highlight.
 */
const CODE_LANGS = new Map<string, string>([
  // Scripting
  ['py', 'python'],
  ['pyw', 'python'],
  ['rb', 'ruby'],
  ['php', 'php'],
  ['lua', 'lua'],
  ['sh', 'bash'],
  ['bash', 'bash'],
  ['zsh', 'zsh'],
  // JS/TS family (all resolve to the TypeScript grammar inside ui-primitives)
  ['js', 'typescript'],
  ['mjs', 'typescript'],
  ['cjs', 'typescript'],
  ['jsx', 'typescript'],
  ['ts', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'typescript'],
  // Compiled
  ['java', 'java'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['c', 'c'],
  ['h', 'c'],
  ['cpp', 'cpp'],
  ['cc', 'cpp'],
  ['hpp', 'cpp'],
  ['cxx', 'cpp'],
  ['cs', 'csharp'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['swift', 'swift'],
  // Markup / config
  ['xml', 'xml'],
  ['yml', 'yaml'],
  ['yaml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['cfg', 'ini'],
  ['conf', 'ini'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
])

/**
 * Resolve the shiki language hint for a source file.
 * @param name - file name or relative path.
 * @returns the grammar id, or undefined for an extension without a grammar.
 */
export function codeLangOf(name: string): string | undefined {
  const base = name.toLowerCase()
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1) : ''
  return CODE_LANGS.get(ext)
}

/** Formats with a dedicated renderer (editing still uses the plain textarea). */
export const FORMATTED_FORMATS: readonly CanvasFileFormat[] = ['markdown', 'html', 'mermaid', 'svg', 'json', 'csv', 'code']
