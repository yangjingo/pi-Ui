// Browser/Node-safe Office Open XML preview extraction governed by the File harness.

import { strFromU8, unzipSync } from 'fflate';

export const OFFICE_EXTENSIONS = new Set([
  'docx', 'docm', 'dotx', 'dotm',
  'xlsx', 'xlsm', 'xltx', 'xltm',
  'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm',
]);

export interface OfficeWorkbookPreview {
  __office: 'workbook';
  sheets: Array<{ name: string; rows: string[][] }>;
}

const extensionOf = (name: string) => {
  const clean = name.toLowerCase().split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1) : '';
};

export function isOfficeFile(name: string): boolean {
  return OFFICE_EXTENSIONS.has(extensionOf(name));
}

/** Excel workbooks are the only Office documents with an in-Canvas preview. Word and
 * PowerPoint files stay available as their original binaries for download. */
export function isOfficeWorkbookFile(name: string): boolean {
  return /^(?:xlsx|xlsm|xltx|xltm)$/.test(extensionOf(name));
}

export function isOfficeWorkbookPreview(value: unknown): value is OfficeWorkbookPreview {
  const v = value as OfficeWorkbookPreview | null;
  return !!v && v.__office === 'workbook' && Array.isArray(v.sheets);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function tagTexts(xml: string, qualifiedTag: string): string[] {
  const re = new RegExp(`<${qualifiedTag}\\b[^>]*>([\\s\\S]*?)<\\/${qualifiedTag}>`, 'gi');
  return [...xml.matchAll(re)].map(match => decodeXml(match[1].replace(/<[^>]+>/g, '')));
}

function xmlFile(files: Record<string, Uint8Array>, path: string): string {
  const file = files[path];
  return file ? strFromU8(file) : '';
}

function openPackage(data: Uint8Array): Record<string, Uint8Array> {
  const files = unzipSync(data, {
    // Images, embedded objects and fonts are unnecessary for a semantic preview and may be huge.
    filter: file => /(?:^|\/)(?:document|header\d*|footer\d*|slide\d*|workbook|sharedStrings|sheet\d*)\.xml$/i.test(file.name),
  });
  const entries = Object.values(files);
  const total = entries.reduce((sum, file) => sum + file.length, 0);
  if (entries.length > 512 || total > 24 * 1024 * 1024) throw new Error('Office 文档内容过大，无法生成预览');
  return files;
}

function extractWord(files: Record<string, Uint8Array>): string {
  const xml = xmlFile(files, 'word/document.xml');
  if (!xml) throw new Error('未找到 Word 文档正文');
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gi)]
    .map(match => {
      const block = match[0];
      const value = tagTexts(block, 'w:t').join('').trim();
      if (!value) return '';
      const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/i.exec(block)?.[1] || '';
      const heading = /heading\s*([1-6])/i.exec(style);
      if (heading) return `${'#'.repeat(Number(heading[1]))} ${value}`;
      return /<w:numPr\b/i.test(block) ? `- ${value}` : value;
    })
    .filter(Boolean)
    .slice(0, 1200);
  return paragraphs.join('\n\n') || '（文档没有可提取的文字）';
}

function slideNumber(path: string): number {
  return Number(/slide(\d+)\.xml$/i.exec(path)?.[1] || 0);
}

function extractPowerPoint(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .slice(0, 200);
  if (!slides.length) throw new Error('未找到 PowerPoint 幻灯片');
  return slides.map((path, index) => {
    const xml = xmlFile(files, path);
    const paragraphs = [...xml.matchAll(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/gi)]
      .map(match => tagTexts(match[0], 'a:t').join('').trim())
      .filter(Boolean);
    return `## 幻灯片 ${index + 1}\n\n${paragraphs.join('\n\n') || '（无文字内容）'}`;
  }).join('\n\n');
}

function columnIndex(ref: string): number {
  const letters = (/^[A-Z]+/i.exec(ref)?.[0] || '').toUpperCase();
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function cellValue(block: string, shared: string[]): string {
  const type = /<(?:\w+:)?c\b[^>]*\bt="([^"]+)"/i.exec(block)?.[1] || '';
  if (type === 'inlineStr') return tagTexts(block, '(?:\\w+:)?t').join('').slice(0, 2000);
  const raw = decodeXml(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(block)?.[1] || '');
  if (type === 's') return (shared[Number(raw)] || '').slice(0, 2000);
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw.slice(0, 2000);
}

function extractExcel(files: Record<string, Uint8Array>): string {
  const sharedXml = xmlFile(files, 'xl/sharedStrings.xml');
  const shared = [...sharedXml.matchAll(/<(?:\w+:)?si\b[^>]*>[\s\S]*?<\/(?:\w+:)?si>/gi)]
    .map(match => tagTexts(match[0], '(?:\\w+:)?t').join(''));
  const workbookXml = xmlFile(files, 'xl/workbook.xml');
  const names = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"/gi)].map(match => decodeXml(match[1]));
  const paths = Object.keys(files)
    .filter(path => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((a, b) => Number(/sheet(\d+)/i.exec(a)?.[1] || 0) - Number(/sheet(\d+)/i.exec(b)?.[1] || 0))
    .slice(0, 24);
  if (!paths.length) throw new Error('未找到 Excel 工作表');

  const sheets = paths.map((path, sheetIndex) => {
    const xml = xmlFile(files, path);
    const rows = [...xml.matchAll(/<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>/gi)].slice(0, 500).map(rowMatch => {
      const row: string[] = [];
      for (const cell of rowMatch[0].matchAll(/<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/gi)) {
        const ref = /<(?:\w+:)?c\b[^>]*\br="([^"]+)"/i.exec(cell[0])?.[1] || '';
        const index = Math.min(99, columnIndex(ref));
        while (row.length < index) row.push('');
        row[index] = cellValue(cell[0], shared);
      }
      return row.slice(0, 100);
    });
    return { name: names[sheetIndex] || `Sheet ${sheetIndex + 1}`, rows };
  });
  return JSON.stringify({ __office: 'workbook', sheets } satisfies OfficeWorkbookPreview);
}

export function extractOfficePreview(name: string, data: Uint8Array): string {
  const ext = extensionOf(name);
  if (!OFFICE_EXTENSIONS.has(ext)) throw new Error('不支持的 Office 文件格式');
  const files = openPackage(data);
  if (/^(?:docx|docm|dotx|dotm)$/.test(ext)) return extractWord(files);
  if (/^(?:xlsx|xlsm|xltx|xltm)$/.test(ext)) return extractExcel(files);
  return extractPowerPoint(files);
}
