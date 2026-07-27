// Shared language and presentation formatting. Product state does not belong here.
export function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** Normalize unknown values for React text nodes. React performs the HTML escaping itself. */
export function text(value: unknown): string {
  return String(value ?? '');
}

/** Compact ms → "320ms" / "1.2s". */
export function fmtMs(ms: number | undefined): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Compact token count → "612" / "12.4k". */
export function fmtTok(count: number | undefined): string {
  if (!count || count < 0) return '—';
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}
