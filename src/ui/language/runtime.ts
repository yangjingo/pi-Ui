import {
  DEFAULT_UI_LANGUAGE,
  resolveMessage,
  UI_LOCALES,
  type MessageParameters,
  type UiLanguage,
  type UiMessageKey,
} from './catalog';

export type { UiLanguage } from './catalog';
export { UI_LOCALES } from './catalog';

export function parseLanguage(value: unknown): UiLanguage {
  const normalized = String(value ?? '').trim().toLowerCase();
  const language = (Object.entries(UI_LOCALES) as Array<[UiLanguage, typeof UI_LOCALES[UiLanguage]]>)
    .find(([, definition]) => (definition.aliases as readonly string[]).includes(normalized));
  return language?.[0] || DEFAULT_UI_LANGUAGE;
}

export function readLanguage(root?: Pick<HTMLElement, 'dataset' | 'lang'>): UiLanguage {
  return parseLanguage(root?.dataset.language || root?.lang);
}

export function applyLanguage(
  language: UiLanguage,
  root: HTMLElement = document.documentElement,
): void {
  const next = parseLanguage(language);
  root.lang = next;
  root.dataset.language = next;
}

export function t(
  key: UiMessageKey,
  parameters?: MessageParameters,
  language: UiLanguage = typeof document === 'undefined' ? DEFAULT_UI_LANGUAGE : readLanguage(document.documentElement),
): string {
  return resolveMessage(language, key, parameters);
}
