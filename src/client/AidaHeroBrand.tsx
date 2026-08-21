import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AidaMark } from './AidaBrand.tsx'
import { NS } from './locales.ts'
import css from './AidaHeroBrand.module.css'

/** Full AIDA new-session brand props. */
export type AidaHeroBrandProps = HeroBrandMarkOwnerProps & PropsLocale<typeof NS>

/**
 * Render the AIDA logo, localized slogan, and release-stage label.
 * @param props - owner-provided localized copy plus the AIDA locale seat.
 * @returns the centered new-session brand lockup.
 */
export function AidaHeroBrand({ size, className, t }: AidaHeroBrandProps) {
  return <AidaMark className={`${css.mark} ${className ?? ''}`} size={size} label={t('logo.label')} />
}
