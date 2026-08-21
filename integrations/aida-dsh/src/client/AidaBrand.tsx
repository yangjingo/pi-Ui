import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useId, type CSSProperties } from 'react'
// Type-only: load the brand slot declarations without coupling the bundle to
// either shell implementation.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import css from './AidaBrand.module.css'

/** Selector currency returned by each AIDA brand takeover. */
export interface AidaBrandMatch {
  /** Stable tag used only to select this plugin's visual replacement. */
  skin: 'aida'
}

/** Shared immutable match value for all AIDA chain entries. */
export const AIDA_BRAND_MATCH: AidaBrandMatch = Object.freeze({ skin: 'aida' })

/** Properties for the reusable AIDA mark. */
export interface AidaMarkProps {
  /** CSS class applied to the SVG root. */
  className?: string | undefined
  /** Square edge length in CSS pixels. */
  size?: number
  /** Accessible name; omit when surrounding content already names the logo. */
  label?: string
}

/**
 * Render the official AIDA symbol with its light/dark asset palette.
 * @param props - size, class, and optional accessible label.
 * @returns the vector mark.
 */
export function AidaMark({ className, size = 32, label }: AidaMarkProps) {
  const gradientId = `aida-brand-accent-${useId().replaceAll(':', '')}`
  const accentStyle: CSSProperties & { '--aida-logo-accent': string } = {
    '--aida-logo-accent': `url(#${gradientId})`,
  }
  const accessibility = label === undefined
    ? { 'aria-hidden': true as const }
    : { 'aria-label': label, role: 'img' as const }
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      {...accessibility}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1565C0" />
          <stop offset="100%" stopColor="#4FC3F7" />
        </linearGradient>
      </defs>
      <path className={css.body} d="M 50 6 L 11 92 L 26 92 L 50 36 L 74 92 L 89 92 Z" />
      <path
        className={css.accent}
        style={accentStyle}
        d="M 36.0855 92 L 53.0855 92 L 59.248 80.7375 L 50 80.7375 Z"
      />
    </svg>
  )
}

/** Full expanded-sidebar chain props. */
export type AidaSidebarBrandProps = SidebarBrandNameOwnerProps & PropsLocale<typeof NS>

/**
 * Replace the expanded sidebar's default product wordmark.
 * @param props - standard slot props and AIDA dictionary.
 * @returns the single AIDA logo requested for the main interface.
 */
export function AidaSidebarBrand({ t }: Pick<AidaSidebarBrandProps, 't'>) {
  return <span className={css.logo} aria-label={t('logo.label')}>AIDA</span>
}

/** Full collapsed-sidebar chain props. */
export type AidaSidebarMarkProps = SidebarBrandMarkOwnerProps & PropsLocale<typeof NS>

/**
 * Replace the collapsed sidebar's default symbol.
 * @param props - standard slot props and AIDA dictionary.
 * @returns the compact AIDA mark.
 */
export function AidaSidebarMark({ size, t }: AidaSidebarMarkProps) {
  return <AidaMark className={css.railMark} size={size} label={t('logo.label')} />
}
