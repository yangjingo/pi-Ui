/**
 * AIDA Canvas turn-tail chips: the produced-files row under a closing
 * assistant message. The chain selector reads the deliverables location data
 * the ui-deliverables definition publishes (key 'deliverables' on the Turn
 * data map — the documented location-data channel), and the chips open the
 * file in the AIDA Canvas column instead of the Host's OS opener. When the
 * turn produced nothing the selector declines and the shipped row still
 * renders.
 */

import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import { NS } from '../locales.ts'
import { basename } from './files.ts'
import { createAidaCanvasStore } from './store.ts'
import css from './canvas.module.css'

/** At most six chips in the tail row; the rest stay counted. */
const SHOWN_LIMIT = 6

/** Injected open affordance of the turn-tail chips. */
export interface ProducedTailInjected {
  /** Open the Canvas column (the frame's details track). */
  openCanvas: () => void
}

/** Produced-path facts the ui-deliverables definition publishes per turn. */
interface AidaDeliverablesTurnData {
  readonly produced: readonly { readonly path: string; readonly seq: number }[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn (ui-deliverables publishes it). */
    deliverables: AidaDeliverablesTurnData
  }
}

/** Full composed props of the turn-tail registration. */
export type ProducedTailProps =
  & PropsRuntime<'conversation.chat.turnTail'>
  & Pick<TurnTailOwnerProps, 'turn' | 'seq'>
  & { matched: readonly string[] }
  & PropsStore<ReturnType<typeof createAidaCanvasStore>>
  & InjectFace<ProducedTailInjected>
  & PropsLocale<typeof NS>

/**
 * Claim the turn-tail chain only when the closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline.
 */
export function selectAidaProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const data = owner.turn.data.get('deliverables')
  if (data === undefined) return null
  const paths: string[] = []
  for (const produced of data.produced) {
    if (produced.seq > owner.seq || paths.includes(produced.path)) continue
    paths.push(produced.path)
  }
  return paths.length === 0 ? null : paths
}

/** Render the produced-files chips of one turn, opening into the Canvas column. */
export function ProducedTail({ matched: paths, actions, openCanvas, t }: ProducedTailProps) {
  const shown = paths.slice(0, SHOWN_LIMIT)
  const hidden = paths.length - shown.length
  return (
    <div className={css.tail} data-testid="aida-canvas-tail">
      <span className={css.tailLabel}>{t('canvas.producedLabel')}</span>
      <div className={css.tailRow}>
        {shown.map(path => (
          <button
            key={path}
            type="button"
            className={css.tailChip}
            title={path}
            aria-label={t('canvas.producedOpen', { name: path })}
            onClick={() => { actions.openFile(path); openCanvas() }}
          >
            {basename(path)}
          </button>
        ))}
        {hidden > 0 && <span className={css.tailMore}>+{hidden}</span>}
      </div>
    </div>
  )
}
