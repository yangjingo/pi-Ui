/**
 * Workspace-file mention: the AIDA '@' reference source and the canvas-side
 * injection helpers. Typing `@` in the composer lists the current session's
 * project files; a pick inserts a `@path` chip whose model form embeds the
 * file content at submit. The Canvas drawer (root scope) cannot see the
 * session-scoped input actions, so its 引用 actions route through the
 * conversation service's per-session input shell the same way the pick
 * pipeline does.
 */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ClientSessionContext, InputTriggerSource, ReferenceInsert, TokenSpan,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { WorkspaceFileNode } from '../../workspace-protocol.ts'
import { aidaWorkspaceApi } from '../workspace-api.ts'

/** Source name of the workspace-file '@' mention (renders as the menu group label). */
export const FILE_MENTION_SOURCE = '文件'

/** Max characters embedded for one file mention; longer files are cut with a marker. */
export const MAX_MENTION_CHARS = 48 * 1024

/** Separator between the workspace root and the relative path inside a mention ref. */
const REF_SEP = '\u0000'

/**
 * Flatten a recursive listing to text-file paths in tree order.
 * @param nodes - recursive Workspace nodes.
 * @returns relative paths of text files.
 */
export function flattenTextFiles(nodes: readonly WorkspaceFileNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'text') paths.push(node.path)
    if (node.kind === 'folder') paths.push(...flattenTextFiles(node.children ?? []))
  }
  return paths
}

/**
 * Build the model representation of one file mention.
 * @param path - Workspace-relative source path.
 * @param content - decoded source text.
 * @returns a capped, labeled file block.
 */
export function fileModelForm(path: string, content: string): string {
  const body = content.length <= MAX_MENTION_CHARS ? content : content.slice(0, MAX_MENTION_CHARS)
  const cut = content.length > MAX_MENTION_CHARS ? '\n[内容过长，已截断]' : ''
  return `[file: ${path}]\n${body}${cut}\n[/file]`
}

/**
 * Build a literal quoted block for a Canvas selection.
 * @param path - Workspace-relative source path.
 * @param text - selected text.
 * @returns a source-labeled Markdown quote.
 */
export function quoteBlock(path: string, text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(line => `> ${line}`).join('\n')
  return `> [引用自 ${path}]\n${lines}\n`
}

/**
 * Encode a root-qualified mention reference.
 * @param root - absolute Workspace root.
 * @param path - Workspace-relative file path.
 * @returns the opaque reference string.
 */
export function mentionRef(root: string, path: string): string {
  return `${root}${REF_SEP}${path}`
}

/**
 * Decode a root-qualified mention reference.
 * @param ref - opaque reference string.
 * @returns its Workspace root and relative path.
 */
export function splitMentionRef(ref: string): { root: string; path: string } {
  const sep = ref.indexOf(REF_SEP)
  return sep === -1 ? { root: '', path: ref } : { root: ref.slice(0, sep), path: ref.slice(sep + REF_SEP.length) }
}

/**
 * Build a mention insertion for the input pipeline.
 * @param root - absolute Workspace root.
 * @param path - Workspace-relative file path.
 * @returns a root-qualified reference insertion.
 */
export function fileReference(root: string, path: string): ReferenceInsert {
  return {
    source: FILE_MENTION_SOURCE,
    ref: mentionRef(root, path),
    label: path,
    clipboardText: `@${path}`,
  }
}

/** The per-session shell surface the mention helpers drive. */
interface ComposerShell {
  setDraft(text: string): void
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean
  state: { getSnapshot(): { draft: string; draftRev: number } }
}

/**
 * Last accepted mention per session: the ref plus the draft revision right
 * after the insert, so a consecutive mention of the same file (nothing typed
 * or inserted in between) is a no-op instead of a duplicate chip. Exported
 * for the package's own tests, which clear it between cases.
 */
export const lastMentionBySession = new Map<SessionId, { ref: string; rev: number }>()

/** Resolve the current session's composer shell, workspace root, and id, or undefined. */
function currentComposer(ctx: ClientContext): { shell: ComposerShell; root: string; sessionId: SessionId } | undefined {
  const conversation = ctx.get('conversation') as IConversation | undefined
  if (conversation === undefined) return undefined
  const state = ctx.sessions.list.getSnapshot()
  const sessionId = state.current
  if (sessionId === undefined) return undefined
  const root = state.byId[sessionId]?.cwd
  if (root === undefined) return undefined
  const actx = ctx.sessions.scope(sessionId)
  if (actx === undefined) return undefined
  return { shell: conversation.input.for(actx), root, sessionId }
}

/**
 * Insert a workspace-file mention chip at the end of the current session's
 * composer draft. The span CAS uses the shell's live revision, so a
 * concurrent keystroke makes the insert a no-op rather than a corruption.
 * A consecutive mention of the same file (no draft change since the last
 * accepted insert) is a no-op that still reports success.
 * @param ctx - client root context.
 * @param path - POSIX-relative path within the session's workspace root.
 * @returns whether the chip was accepted by the input machine.
 */
export function mentionFileIntoComposer(ctx: ClientContext, path: string): boolean {
  const current = currentComposer(ctx)
  if (current === undefined) return false
  const ref = mentionRef(current.root, path)
  const state = current.shell.state.getSnapshot()
  const prior = lastMentionBySession.get(current.sessionId)
  if (prior !== undefined && prior.ref === ref && prior.rev === state.draftRev) return true
  const accepted = current.shell.insertReference(fileReference(current.root, path), {
    start: state.draft.length,
    end: state.draft.length,
    draftRev: state.draftRev,
  })
  if (accepted) {
    lastMentionBySession.set(current.sessionId, { ref, rev: current.shell.state.getSnapshot().draftRev })
  }
  return accepted
}

/**
 * Inject a quoted selection (labeled with its source path) into the current
 * session's composer draft as literal text.
 * @param ctx - client root context.
 * @param path - POSIX-relative source path of the selection.
 * @param text - the selected text, quoted verbatim.
 * @returns whether the draft accepted the write.
 */
export function quoteSelectionIntoComposer(ctx: ClientContext, path: string, text: string): boolean {
  const current = currentComposer(ctx)
  if (current === undefined) return false
  const draft = current.shell.state.getSnapshot().draft
  const block = quoteBlock(path, text)
  current.shell.setDraft(draft === '' ? block : `${draft}${draft.endsWith('\n') ? '' : '\n'}${block}`)
  return true
}

/**
 * The '@' workspace-file source: candidates are the current session's text
 * files, picks insert {@link fileReference} chips, and the codec embeds the
 * file content at submit. The lexicon roll (for plain-text decoration of
 * persisted drafts) is warmed per session from the same listing.
 * @param ctx - client root context carrying the session face.
 * @param workspace - workspace-file transport; the plugin supplies its HTTP client.
 * @returns the Workspace-file trigger source.
 */
export function createFileMentionSource(
  ctx: ClientContext,
  workspace: Pick<typeof aidaWorkspaceApi, 'listFiles' | 'readFile'> = aidaWorkspaceApi,
): InputTriggerSource {
  const sessions: ISessions = ctx.sessions
  const cache = new Map<SessionId, readonly string[]>()
  const listeners = new Map<SessionId, Set<() => void>>()
  const refreshing = new Map<SessionId, Promise<void>>()

  const rootOf = (session: ClientSessionContext): string | undefined =>
    sessions.list.getSnapshot().byId[session.sessionId]?.cwd

  const notify = (sessionId: SessionId): void => {
    for (const listener of listeners.get(sessionId) ?? []) listener()
  }

  /** One deduplicated listing per session; failures keep the last warm roll. */
  const refreshCache = (sessionId: SessionId, root: string): Promise<void> => {
    const pending = refreshing.get(sessionId)
    if (pending !== undefined) return pending
    const task = workspace.listFiles(root)
      .then((listing) => { cache.set(sessionId, flattenTextFiles(listing.files)) })
      .catch(() => { /* keep the last warm roll; candidates fall back to it */ })
      .finally(() => { refreshing.delete(sessionId); notify(sessionId) })
    refreshing.set(sessionId, task)
    return task
  }

  return {
    trigger: '@',
    name: FILE_MENTION_SOURCE,
    order: -1,
    async candidates(session, { query, signal }) {
      const root = rootOf(session)
      if (root === undefined) return []
      void refreshCache(session.sessionId, root)
      await refreshing.get(session.sessionId)
      if (signal.aborted) return []
      const paths = cache.get(session.sessionId) ?? []
      const needle = query.trim().toLowerCase()
      const matched = (needle === '' ? paths : paths.filter(path => path.toLowerCase().includes(needle))).slice(0, 60)
      return matched.map(path => ({ name: path }))
    },
    warm(session) {
      const root = rootOf(session)
      if (root !== undefined) void refreshCache(session.sessionId, root)
    },
    lexicon(session) {
      return cache.get(session.sessionId)
    },
    subscribeLexicon(session, listener) {
      const sessionId = session.sessionId
      const set = listeners.get(sessionId) ?? new Set()
      set.add(listener)
      listeners.set(sessionId, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(sessionId)
      }
    },
    onPick({ candidate, session }) {
      const root = rootOf(session)
      if (root === undefined) return undefined
      return { insert: fileReference(root, candidate.name) }
    },
    codec: {
      clipboardText: ref => `@${splitMentionRef(ref).path}`,
      async serialize(ref, signal) {
        const { root, path } = splitMentionRef(ref)
        const result = await workspace.readFile(root, path, {}, signal)
        return fileModelForm(path, result.content ?? '')
      },
    },
  }
}
