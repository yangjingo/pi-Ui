export const UI_THEMES = {
  dark: { colorScheme: 'dark' },
  zengrid: { colorScheme: 'light' },
  aida: { colorScheme: 'light' },
} as const;

export type UiTheme = keyof typeof UI_THEMES;
export const DEFAULT_UI_THEME: UiTheme = 'dark';

export function parseTheme(value: unknown): UiTheme {
  const normalized = String(value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UI_THEMES, normalized)
    ? normalized as UiTheme
    : DEFAULT_UI_THEME;
}

export function readTheme(root?: Pick<HTMLElement, 'dataset'>): UiTheme {
  return parseTheme(root?.dataset.theme);
}

export function applyTheme(theme: UiTheme, root: HTMLElement = document.documentElement): void {
  const next = parseTheme(theme);
  root.dataset.theme = next;
  root.style.colorScheme = UI_THEMES[next].colorScheme;
}
