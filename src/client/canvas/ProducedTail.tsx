/**
 * AIDA Canvas turn-tail chips: the produced-files row under a closing
 * assistant message. The `conversation.chat.turnTail` slot is a list in
 * dsh 0.2.0, so the component itself reads the deliverables location data
 * the ui-deliverables definition publishes (key 'deliverables' on the Turn
 * data map — the documented location-data channel) and renders nothing when
 * the turn produced nothing, letting the shipped row show instead. The chips
 * keep the Host's native open linkage (`openFile` → the right Sidebar's
 * own preview tabs); the AIDA Canvas stays a separate tab opened from the
 * session header, so the two previews never fight over the same click.
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { NS } from '../locales.ts'
import { basename } from './files.ts'
import css from './canvas.module.css'

/** At most six chips in the tail row; the rest stay counted. */
const SHOWN_LIMIT = 6

/** Produced-path facts the ui-deliverables definition publishes per turn. */
interface AidaDeliverablesTurnData {
  readonly produced: readonly { readonly path: string; readonly seq: number }[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn (ui-deliverables publishes it). */
    deliverables: AidaDeliverablesTurnData
  }
}

/** Full composed props of the turn-tail registration. */
export type ProducedTailProps =
  & PropsRuntime<'conversation.chat.turnTail'>
  & TurnTailOwnerProps
  & PropsLocale<typeof NS>

/**
 * Collect the produced paths of the closing turn, or null when it produced
 * nothing (the component then renders nothing).
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths, or null when the turn produced no files.
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

/** Render the produced-files chips of one turn with the Host's native open linkage. */
export function ProducedTail({ turn, seq, openFile, t }: ProducedTailProps) {
  const paths = selectAidaProducedFiles({ turn, seq, openFile })
  if (paths === null) return null
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
            onClick={() => { openFile(path) }}
          >
            {basename(path)}
          </button>
        ))}
        {hidden > 0 && <span className={css.tailMore}>+{hidden}</span>}
      </div>
    </div>
  )
}
