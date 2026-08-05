import { t, type UiLanguage } from './runtime';

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

export const PRODUCT_TERMS = {
  workspace: 'Workspace',
  files: 'Files',
  canvas: 'Canvas',
  goal: 'Goal',
  skill: 'Skill',
  skillCenter: 'Skills',
  thinking: 'Thinking',
  toolCall: 'Tool call',
  trajectory: 'Trajectory',
  agent: 'Agent',
} as const;

export type ProductTermKey = keyof typeof PRODUCT_TERMS;

export function term(
  key: ProductTermKey,
  language?: UiLanguage,
): string {
  return t(`term.${key}`, undefined, language);
}

/** Localize only Core-owned Session chrome. User titles and message content stay untouched. */
export function sessionGroupLabel(group: string, language?: UiLanguage): string {
  const value = String(group || '').trim();
  if (value === '今天' || value.toLowerCase() === 'today') return t('session.today', undefined, language);
  const existing = value.match(/^(?:已有 Pi 会话|Existing Pi sessions)\s*·\s*(.+)$/i);
  if (!existing) return value;
  const suffix = existing[1].trim();
  return suffix === '今天' || suffix.toLowerCase() === 'today'
    ? t('session.existingToday', undefined, language)
    : t('session.existingDate', { date: suffix }, language);
}

export function relativeTimeLabel(value: string, language?: UiLanguage): string {
  const normalized = String(value || '').trim();
  return normalized === '刚刚' || normalized.toLowerCase() === 'just now'
    ? t('conversation.justNow', undefined, language)
    : normalized;
}

const TRAJECTORY_KEYS = {
  analyze: 'trajectory.analysis',
  canvas: 'trajectory.canvas',
  edit: 'trajectory.edit',
  find: 'trajectory.find',
  goal: 'trajectory.goal',
  plan: 'trajectory.plan',
  query: 'trajectory.query',
  read: 'trajectory.read',
  search: 'trajectory.search',
  sheet: 'trajectory.sheet',
  think: 'trajectory.thinking',
  write: 'trajectory.write',
} as const;

/** Localized UI chrome for a semantic trajectory kind. Raw historical titles stay untouched. */
export function trajectoryLabel(
  kind: string,
  shell?: 'bash' | 'powershell',
  language?: UiLanguage,
): string {
  if (kind === 'code') return shell === 'powershell' ? 'PowerShell' : 'Bash';
  const key = TRAJECTORY_KEYS[kind as keyof typeof TRAJECTORY_KEYS];
  return key ? t(key, undefined, language) : kind.toUpperCase();
}
