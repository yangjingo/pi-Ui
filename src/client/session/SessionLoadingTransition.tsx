import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import css from './SessionLoadingTransition.module.css'

type TransitionPhase = 'idle' | 'loading' | 'leaving'

export interface SessionLoadingTransitionProps {
  /** Whether the active session is replaying its persisted history. */
  loading: boolean
  /** Localized status announced to assistive technology. */
  label: string
}

/**
 * Bridge the session replay state into the transcript flow without replacing
 * DSH's chat implementation. The header utility is session-scoped and stays
 * mounted for the whole replay, while the portal keeps the visual transition
 * colocated with the content it reveals.
 */
export function SessionLoadingTransition({ loading, label }: SessionLoadingTransitionProps) {
  const [flow, setFlow] = useState<HTMLElement | null>(null)
  const [phase, setPhase] = useState<TransitionPhase>(loading ? 'loading' : 'idle')

  useLayoutEffect(() => {
    setFlow(document.querySelector<HTMLElement>('[data-chat-flow]'))
  }, [])

  useEffect(() => {
    if (loading) {
      setPhase('loading')
      return undefined
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    setPhase(current => {
      if (current === 'idle') return current
      timeout = setTimeout(() => { setPhase('idle') }, 260)
      return 'leaving'
    })
    return () => { if (timeout !== undefined) clearTimeout(timeout) }
  }, [loading])

  useLayoutEffect(() => {
    if (flow === null || phase === 'idle') return undefined
    flow.dataset.aidaSessionTransition = phase
    return () => { delete flow.dataset.aidaSessionTransition }
  }, [flow, phase])

  if (flow === null || phase === 'idle') return null
  return createPortal(
    <div
      className={css.surface}
      data-aida-session-loader=""
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className={css.content}>
        <span className={css.motionMark} aria-hidden="true">
          <span className={css.orbit} />
          <span className={css.core} />
        </span>
        <span className={css.label}>{label}</span>
        <span className={css.dots} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>,
    flow,
  )
}
