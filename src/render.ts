// UI/UX layer — pure string rendering helpers (escaping, lightweight Markdown).
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Compact ms → "320ms" / "1.2s". */
export function fmtMs(ms: number | undefined): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compact token count → "612" / "12.4k". */
export function fmtTok(n: number | undefined): string {
  if (!n || n < 0) return '—';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function renderMd(src: string): string {
  const inline = (s: string) =>
    s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
      const code = esc(buf.join('\n'));
      if (lang.toLowerCase() === 'mermaid') {
        html += `<div class="mermaid">${code}</div>`;
      } else {
        html += `<pre class="code-block"><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${code}</code></pre>`;
      }
      continue;
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
