import { esc } from '../language/format';

export const MAX_HIGHLIGHT_CHARS = 200_000;

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  md: 'markdown',
  yml: 'yaml',
  htm: 'html',
};

const SUPPORTED = new Set([
  'typescript', 'javascript', 'json', 'css', 'html', 'shell', 'python', 'markdown', 'yaml',
]);

const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def',
  'delete', 'do', 'elif', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'if', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of',
  'pass', 'return', 'switch', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var',
  'while', 'with', 'yield', 'None', 'True', 'False',
]);

export function normalizeCodeLanguage(value: string): string {
  const raw = value.trim().toLowerCase().replace(/^\./, '');
  const normalized = ALIASES[raw] || raw;
  return SUPPORTED.has(normalized) ? normalized : 'text';
}
export function languageOfPath(path: string): string {
  const extension = path.split('.').pop() || '';
  return normalizeCodeLanguage(extension);
}

export interface HighlightResult {
  html: string;
  language: string;
  highlighted: boolean;
  truncated: boolean;
}

export function highlightCode(source: string, requestedLanguage: string): HighlightResult {
  const language = normalizeCodeLanguage(requestedLanguage);
  const truncated = source.length > MAX_HIGHLIGHT_CHARS;
  if (language === 'text' || truncated) {
    return { html: esc(source), language, highlighted: false, truncated };
  }

  const hashComments = language === 'python' || language === 'shell' || language === 'yaml';
  const commentPattern = hashComments
    ? String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*`
    : language === 'html' || language === 'markdown'
      ? String.raw`<!--[\s\S]*?-->`
      : String.raw`\/\*[\s\S]*?\*\/|\/\/[^\n]*`;
  const pattern = new RegExp(
    `${commentPattern}|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$-]*\\b`,
    'gm',
  );
  let html = '';
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const token = match[0];
    html += esc(source.slice(cursor, index));
    let kind = '';
    if (/^(?:\/\*|\/\/|#|<!--)/.test(token)) kind = 'comment';
    else if (/^["'`]/.test(token)) kind = 'string';
    else if (/^\d/.test(token)) kind = 'number';
    else if (KEYWORDS.has(token)) kind = 'keyword';
    else if (source.slice(index + token.length).trimStart().startsWith('(')) kind = 'function';
    html += kind ? `<span class="syntax-${kind}">${esc(token)}</span>` : esc(token);
    cursor = index + token.length;
  }
  html += esc(source.slice(cursor));
  return { html, language, highlighted: true, truncated: false };
}
