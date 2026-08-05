export const UI_BRANDS = ['pi', 'aida'] as const;

export type UiBrand = typeof UI_BRANDS[number];
export const DEFAULT_UI_BRAND: UiBrand = 'pi';

export function parseBrand(value: unknown): UiBrand {
  const normalized = String(value ?? '').trim().toLowerCase();
  return UI_BRANDS.includes(normalized as UiBrand) ? normalized as UiBrand : DEFAULT_UI_BRAND;
}

export function readBrand(root?: Pick<HTMLElement, 'dataset'>): UiBrand {
  return parseBrand(root?.dataset.brand);
}
