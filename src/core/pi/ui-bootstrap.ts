export const UI_BOOTSTRAP_THEMES = {
  dark: { colorScheme: 'dark' },
  zengrid: { colorScheme: 'light' },
  aida: { colorScheme: 'light' },
} as const;

export const UI_BOOTSTRAP_LANGUAGES = {
  en: { aliases: ['en', 'en-us', 'en-gb'] },
  'zh-CN': { aliases: ['zh', 'zh-cn', 'zh-hans'] },
} as const;

export const UI_BOOTSTRAP_BRANDS = {
  pi: {},
  aida: {},
} as const;

export type UiBootstrapTheme = keyof typeof UI_BOOTSTRAP_THEMES;
export type UiBootstrapLanguage = keyof typeof UI_BOOTSTRAP_LANGUAGES;
export type UiBootstrapBrand = keyof typeof UI_BOOTSTRAP_BRANDS;

export interface UiBootstrapConfig {
  theme: UiBootstrapTheme;
  language: UiBootstrapLanguage;
  brand: UiBootstrapBrand;
}

export function resolveUiBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): UiBootstrapConfig {
  const themeValue = environment.PI_UI_THEME?.trim().toLowerCase();
  const theme = themeValue && Object.hasOwn(UI_BOOTSTRAP_THEMES, themeValue)
    ? themeValue as UiBootstrapTheme
    : 'dark';
  const languageValue = environment.PI_UI_LANGUAGE?.trim().toLowerCase();
  const language = (Object.entries(UI_BOOTSTRAP_LANGUAGES) as Array<[
    UiBootstrapLanguage,
    { aliases: readonly string[] },
  ]>).find(([, definition]) => languageValue && definition.aliases.includes(languageValue))?.[0] ?? 'en';
  const brandValue = environment.PI_UI_BRAND?.trim().toLowerCase();
  const brand = brandValue && Object.hasOwn(UI_BOOTSTRAP_BRANDS, brandValue)
    ? brandValue as UiBootstrapBrand
    : theme === 'aida' ? 'aida' : 'pi';
  return { theme, language, brand };
}

/** Inject startup-only visual configuration before first paint. Environment values are
 * allow-listed above and cannot become arbitrary HTML. */
export function injectUiBootstrap(
  html: string,
  config: UiBootstrapConfig = resolveUiBootstrap(),
): string {
  return html.replace(/<html\b[^>]*>/i, [
    '<html',
    `lang="${config.language}"`,
    `data-language="${config.language}"`,
    `data-theme="${config.theme}"`,
    `data-brand="${config.brand}"`,
    `style="color-scheme:${UI_BOOTSTRAP_THEMES[config.theme].colorScheme}"`,
    '>',
  ].join(' '));
}
