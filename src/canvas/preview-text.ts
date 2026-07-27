import type { FileNode } from '../core/agent/protocol';
import { renderMd } from '../ui';
import { isOfficeWorkbookPreview, parseCSV } from '../workspace';

const COPYABLE_PREVIEW_TYPES = new Set<FileNode['type']>([
  'md',
  'sheet',
  'fig',
  'png',
  'html',
  'code',
  'json',
  'mermaid',
  'excalidraw',
  'pdf',
]);

export function supportsPreviewTextCopy(file: FileNode | null): file is FileNode {
  return !!file && COPYABLE_PREVIEW_TYPES.has(file.type);
}

function normalizePlainText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function elementText(element: Element | null): string {
  if (!element) return '';
  const value = element instanceof HTMLElement ? element.innerText : element.textContent;
  return normalizePlainText(value || '');
}

function markupText(markup: string): string {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  document.querySelectorAll('script,style,noscript,template').forEach(element => element.remove());
  return elementText(document.body);
}

function tableText(table: HTMLTableElement): string {
  return Array.from(table.rows)
    .map(row => Array.from(row.cells).map(cell => normalizePlainText(cell.textContent || '')).join('\t'))
    .join('\n');
}

function sheetSourceText(source: string): string {
  try {
    const value: unknown = JSON.parse(source);
    if (isOfficeWorkbookPreview(value)) {
      return value.sheets[0]?.rows.map(row => row.join('\t')).join('\n') || '';
    }
  } catch {
    // CSV and TSV previews are not JSON.
  }
  return parseCSV(source).map(row => row.join('\t')).join('\n');
}

function graphicText(root: HTMLElement): string {
  const labels = Array.from(root.querySelectorAll('svg text, svg foreignObject'))
    .map(elementText)
    .filter(Boolean);
  return normalizePlainText([...new Set(labels)].join('\n'));
}

function excalidrawText(source: string): string {
  try {
    const value = JSON.parse(source) as { elements?: Array<{ type?: string; text?: string; originalText?: string }> };
    return normalizePlainText((value.elements || [])
      .filter(element => element.type === 'text')
      .map(element => element.originalText || element.text || '')
      .filter(Boolean)
      .join('\n'));
  } catch {
    return '';
  }
}

export function previewPlainText(root: HTMLElement, file: FileNode, source: string): string {
  const table = root.querySelector('table');
  if (file.type === 'sheet') return table instanceof HTMLTableElement ? tableText(table) : sheetSourceText(source);

  const textarea = root.querySelector('textarea');
  const currentSource = textarea instanceof HTMLTextAreaElement ? textarea.value : source;

  switch (file.type) {
    case 'html':
      return markupText(currentSource);
    case 'md':
      return markupText(renderMd(currentSource));
    case 'code':
      return currentSource;
    case 'json': {
      const drawing = excalidrawText(currentSource);
      if (drawing) return drawing;
      return elementText(root.querySelector('pre code')) || currentSource;
    }
    case 'mermaid':
      return graphicText(root) || currentSource;
    case 'excalidraw':
      return excalidrawText(currentSource) || graphicText(root) || currentSource;
    case 'fig':
      return elementText(root.querySelector('.artboard')) || currentSource;
    case 'png':
      return normalizePlainText(file.caption || root.querySelector('img')?.getAttribute('alt') || file.name);
    case 'pdf':
      // The browser PDF viewer owns its text layer, so Canvas can expose only supplied
      // semantic metadata without copying binary bytes or a workspace path.
      return normalizePlainText(file.caption || file.name);
    default:
      return elementText(root) || currentSource;
  }
}
