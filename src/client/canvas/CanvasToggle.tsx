/**
 * AIDA Canvas toggle: an icon button in the session header's utilities row —
 * the same 28px circular icon-button style and icon size as the sidebar's
 * logo-row panel toggle, carrying the Canvas's own 2×2 grid mark (no text
 * label; the name rides tooltip/aria). Clicking opens the Canvas, the
 * right-hand details track of the frame, side-by-side with the conversation.
 * Column open/close is the frame's details-track state, so the button drives
 * `ctx.layout.openDetails` through the injected callback.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import PanelRightOpen from 'lucide-react/dist/esm/icons/panel-right-open.mjs'
import { NS } from '../locales.ts'
import { SessionLoadingTransition } from '../session/SessionLoadingTransition.tsx'
import css from './canvas.module.css'

/** Injected open affordance of the header toggle. */
export interface CanvasToggleInjected {
  /** Open the Canvas column (the frame's details track). */
  openCanvas: () => void
}

/** Full composed props of the header-utilities registration. */
export type AidaCanvasToggleProps =
  & PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<CanvasToggleInjected>
  & PropsLocale<typeof NS>

/** Render the header-utilities Canvas icon toggle (opens the right-hand column). */
export function AidaCanvasToggle({ openCanvas, t, useSession }: AidaCanvasToggleProps) {
  const loading = useSession(snapshot => snapshot.openState === 'loading')
  return (
    <>
      <button
        type="button"
        className={css.headerToggle}
        data-testid="aida-canvas-toggle"
        title={t('canvas.toggle')}
        aria-label={t('canvas.toggle')}
        onClick={openCanvas}
      >
        <PanelRightOpen size={16} aria-hidden="true" />
      </button>
      <SessionLoadingTransition loading={loading} label={t('session.loading')} />
    </>
  )
}
