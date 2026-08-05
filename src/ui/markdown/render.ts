import { esc } from '../language/format';
import { t } from '../language/runtime';
import { highlightCode } from '../syntax/highlight';

export function renderMd(src: string): string {
  const inline = (s: string) =>
    s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const tableCells = (line: string): string[] => {
    const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let cell = '';
    for (let j = 0; j < source.length; j++) {
      if (source[j] === '\\' && source[j + 1] === '|') { cell += '|'; j++; }
      else if (source[j] === '|') { cells.push(cell.trim()); cell = ''; }
      else cell += source[j];
    }
    cells.push(cell.trim());
    return cells;
  };
  const divider = (cells: string[]) => cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
  const alignment = (cell: string) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left';
  const lines = src.split('\n');
  let html = '';
  let inList = false;
  let i = 0;
  const close = () => { if (inList) { html += '</ul>'; inList = false; } };
  while (i < lines.length) {
    // fenced code block: ```lang ... ```
    const fence = lines[i].match(/^```([\w-]*)\s*$/);
    if (fence) {
      close();
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; // consume closing fence
      const source = buf.join('\n');
      const code = esc(source);
      if (lang.toLowerCase() === 'mermaid') {
        html += `<div class="mermaid">${code}</div>`;
      } else {
        const highlighted = highlightCode(source, lang);
        const classes = [`lang-${esc(highlighted.language)}`, highlighted.highlighted ? 'is-highlighted' : 'is-plain'].join(' ');
        html += `<pre class="code-block"><code class="${classes}">${highlighted.html}</code>${highlighted.truncated ? `<small class="syntax-fallback">${esc(t('renderer.largePlainText'))}</small>` : ''}</pre>`;
      }
      continue;
    }
    // GFM-style table: a header row followed by a --- delimiter row. The wrapper keeps wide
    // model output inside the message column instead of expanding the entire conversation.
    if (lines[i].includes('|') && i + 1 < lines.length) {
      const headers = tableCells(lines[i]);
      const rules = tableCells(lines[i + 1]);
      if (headers.length > 1 && rules.length === headers.length && divider(rules)) {
        close();
        const aligns = rules.map(alignment);
        html += '<div class="md-table-wrap"><table><thead><tr>';
        html += headers.map((cell, index) => `<th class="align-${aligns[index]}">${inline(esc(cell))}</th>`).join('');
        html += '</tr></thead><tbody>';
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const cells = tableCells(lines[i]);
          html += '<tr>' + headers.map((_, index) => `<td class="align-${aligns[index]}">${inline(esc(cells[index] || ''))}</td>`).join('') + '</tr>';
          i++;
        }
        html += '</tbody></table></div>';
        continue;
      }
    }
    const e = esc(lines[i]);
    if (/^###\s+/.test(e)) { close(); html += `<h3>${inline(e.slice(4))}</h3>`; }
    else if (/^##\s+/.test(e)) { close(); html += `<h2>${inline(e.slice(3))}</h2>`; }
    else if (/^#\s+/.test(e)) { close(); html += `<h1>${inline(e.slice(2))}</h1>`; }
    else if (/^>\s+/.test(e)) { close(); html += `<blockquote>${inline(e.slice(2))}</blockquote>`; }
    else if (/^-\s+/.test(e)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(e.slice(2))}</li>`; }
    else if (e.trim() === '') { close(); }
    else { close(); html += `<p>${inline(e)}</p>`; }
    i++;
  }
  close();
  return html;
}
