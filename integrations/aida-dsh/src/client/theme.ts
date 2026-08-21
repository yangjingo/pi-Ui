import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** AIDA identity tokens adapted for the built-in light and dark palettes. */
export const AIDA_TOKENS: ThemeTokenOverrides = Object.freeze({
  '--dsw-font-family': {
    light: "Aptos, 'Segoe UI Variable', 'Segoe UI', sans-serif",
    dark: "Aptos, 'Segoe UI Variable', 'Segoe UI', sans-serif",
  },
  '--dsw-alias-brand-primary': { light: '#3551D8', dark: '#7386F5' },
  '--dsw-alias-brand-text': { light: '#1E34A8', dark: '#AAB5FF' },
  '--dsw-alias-button-primary': { light: '#3551D8', dark: '#7386F5' },
  '--dsw-alias-button-primary-hover': { light: '#2A44C2', dark: '#8C9BFF' },
  '--dsw-business-primary': { light: '#3551D8', dark: '#7386F5' },
  '--dsw-business-tertiary': { light: '#EEF1FC', dark: 'rgba(115, 134, 245, 0.16)' },
})
