/**
 * AIDA deployment skin + Canvas: fixed palette, a single sidebar logo, and
 * the Canvas — a right-docked drawer in the
 * frame-wide overlay layer with a workspace file tree, preview, trajectory,
 * and upload. Removing the plugin restores every previous surface.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { createTrajectoryDurationStore } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { AidaSidebarBrand, AidaSidebarMark } from './AidaBrand.tsx'
import { AidaHeroBrand } from './AidaHeroBrand.tsx'
import { AidaCanvasPanel } from './canvas/CanvasPanel.tsx'
import { AidaCanvasToggle, type CanvasToggleInjected } from './canvas/CanvasToggle.tsx'
import { ProducedTail, selectAidaProducedFiles, type ProducedTailInjected } from './canvas/ProducedTail.tsx'
import { createAidaCanvasStore } from './canvas/store.ts'
import type { AidaCanvasInjected } from './canvas/contract.ts'
import { createFileMentionSource, mentionFileIntoComposer, quoteSelectionIntoComposer } from './canvas/mention.ts'
import { startChromeSkin } from './skin/chrome.ts'
import { IntranetModelsSection, type IntranetModelsInjected } from './models/IntranetModelsSection.tsx'
import { IntranetModelsController } from './models/intranet-store.ts'
import { en, NS, zh, type AidaKey } from './locales.ts'
import { AIDA_TOKENS } from './theme.ts'
import { aidaWorkspaceApi } from './workspace-api.ts'

export type { AidaKey } from './locales.ts'
export { AIDA_TOKENS } from './theme.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AIDA brand and Canvas copy. */
    aida: AidaKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Framework-owned Session log download controller. */
    sessionLogDownload: { download: (sessionId: SessionId) => Promise<void> }
  }
}

/** Services required by the AIDA browser skin, Canvas, and intranet models. */
export const inject = ['slots', 'locale', 'theme', 'workspaces', 'sessions', 'connection', 'conversation', 'inputTriggers', 'layout', 'sessionLogDownload']

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-aida'

/**
 * Activate the AIDA identity tokens, brand takeovers, and the Canvas drawer
 * while preserving the user's light, dark, or system preference.
 * @param ctx - client context carrying the theme, locale, sessions, and slot services.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-aida: dictionaries')

  ctx.effect(
    () => ctx.theme.overrideTokens(PACKAGE_NAME, AIDA_TOKENS),
    'ui-aida: adaptive identity tokens',
  )

  // AIDA chrome skin: hide only the original center-column trajectory entry;
  // Canvas relocates that same TrajectoryView without replacing its controls.
  // reads "Project" (see skin/chrome.ts).
  ctx.effect(() => startChromeSkin(document), 'ui-aida: chrome skin')

  // Workspace-file '@' mentions: typing `@` in the composer lists the current
  // session's project files; a pick inserts a `@path` chip whose model form
  // embeds the file content at submit (see canvas/mention.ts).
  ctx.effect(
    () => ctx.inputTriggers.registerSource(createFileMentionSource(ctx, aidaWorkspaceApi)),
    'ui-aida: @ workspace-file source',
  )

  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    priority: -1,
    locale: NS,
  }, AidaSidebarMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    priority: -1,
    locale: NS,
  }, AidaSidebarBrand))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    priority: -1,
    locale: NS,
  }, AidaHeroBrand))
  // ── Canvas: right-hand column, header toggle, and turn-tail chips ────────
  // One shared per-session store handle mounts under the three session-scoped
  // registrations (details column, header utilities, turn tail), so opening a
  // produced file from the chat tail lands in the column. Column open/close is
  // the frame's details-track state: the toggle and tail open it through
  // `ctx.layout.openDetails`, and the panel's close affordance calls
  // `ctx.layout.closeDetails`. The panel shadows the built-in tool-details
  // panel (`details` seat, lower priority) and renders the shared tool-output
  // seat (`conversation.details.tool`) through the original TrajectoryView, so
  // tool inspection survives the takeover.
  const canvasStore = createAidaCanvasStore()
  const openColumn = (): void => { ctx.layout.openDetails() }
  const closeColumn = (): void => { ctx.layout.closeDetails() }

  const trajectoryDuration = createTrajectoryDurationStore()
  const canvasInjected = (sessionId: SessionId): AidaCanvasInjected => {
    return {
      ...aidaWorkspaceApi,
      hooks: { trajectoryDuration },
      loadTrajectoryOlder: async () => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error(`ui-aida: session "${sessionId}" is unavailable`)
        const before = session.getSnapshot().views.get('trajectory')
        await session.loadOlder()
        return session.getSnapshot().views.get('trajectory') !== before
      },
      setTrajectoryActualDuration: value => { trajectoryDuration.set(value) },
      trajectoryT: ctx.locale.bind('trajectory'),
      downloadSessionLog: () => ctx.sessionLogDownload.download(sessionId),
      closeCanvas: closeColumn,
      // The composer draft is per-session, so the 引用 actions route through the
      // conversation service's session shell.
      mentionFile: path => mentionFileIntoComposer(ctx, path),
      quoteSelection: (path, text) => quoteSelectionIntoComposer(ctx, path, text),
    }
  }

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    locale: NS,
    store: canvasStore,
    inject: canvasInjected,
  }, AidaCanvasPanel))

  // Canvas is AIDA's primary workspace surface. Plugin loading can finish
  // before DSH wires the root layout actions, so retry briefly until the
  // details column is ready instead of failing the whole plugin entry.
  const openCanvasWhenReady = (attempt = 0): void => {
    try {
      openColumn()
    } catch {
      if (attempt < 20) {
        globalThis.setTimeout(() => openCanvasWhenReady(attempt + 1), 50)
      }
    }
  }
  openCanvasWhenReady()

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'aida-canvas',
    order: 100,
    locale: NS,
    inject: (): CanvasToggleInjected => ({ openCanvas: openColumn }),
  }, AidaCanvasToggle))

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectAidaProducedFiles,
    locale: NS,
    store: canvasStore,
    inject: (): ProducedTailInjected => ({ openCanvas: openColumn }),
  }, ProducedTail))

  // ── Intranet models: one-click install of intranet model presets ────────
  // A dedicated settings section beside the shipped Models page; install
  // writes the same `llm-pi-ai` provider profile the Models page's custom
  // provider card does.
  const connection = ctx.get('connection') as ConnectionHandle
  const intranetModels = new IntranetModelsController(connection.api)
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'aida-intranet-models',
    order: 100,
    label: () => t('intranet.title'),
    locale: NS,
    inject: (): IntranetModelsInjected => ({
      controller: intranetModels,
      hooks: { intranetModels: intranetModels.store },
    }),
  }, IntranetModelsSection))
}
