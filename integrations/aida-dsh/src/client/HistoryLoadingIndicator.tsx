export interface HistoryLoadingProps { label: string }
import css from './HistoryLoadingIndicator.module.css'

/**
 * Render the AIDA history-open signal as two counter-rotating circular rails.
 * @param props - localized label and standard Session slot currency.
 * @returns the accessible loading indicator.
 */
export function AidaHistoryLoadingIndicator({ label }: HistoryLoadingProps) {
  return (
    <div className={css.loading} role="status" aria-live="polite">
      <span className={css.orbit} aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
