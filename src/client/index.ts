/**
 * AIDA deployment skin + Canvas: fixed palette, a single sidebar logo, and
 * the Canvas — a right-docked drawer in the
 * frame-wide overlay layer with a workspace file tree, preview, trajectory,
 * and upload. Removing the plugin restores every previous surface.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { AidaSidebarBrand, AidaSidebarMark } from './AidaBrand.tsx'
import { AidaHeroBrand } from './AidaHeroBrand.tsx'
import { AidaCanvasPanel } from './canvas/CanvasPanel.tsx'
import { AidaCanvasToggle, type CanvasToggleInjected } from './canvas/CanvasToggle.tsx'
import { ProducedTail, type ProducedTailInjected } from './canvas/ProducedTail.tsx'
import { createAidaCanvasStore } from './canvas/store.ts'
import type { AidaCanvasInjected } from './canvas/contract.ts'
import { createFileMentionSource, mentionFileIntoComposer, quoteSelectionIntoComposer } from './canvas/mention.ts'
import { startChromeSkin } from './skin/chrome.ts'
import { IntranetModelsSection, type IntranetModelsInjected } from './models/IntranetModelsSection.tsx'
import { IntranetModelsController, type SettingsWireApi } from './models/intranet-store.ts'
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
export const inject = ['slots', 'locale', 'theme', 'sessions', 'uiSession', 'remote', 'conversation', 'inputTriggers', 'sidebarRight', 'sidebarRightTabs', 'sessionLogDownload']

const PACKAGE_NAME = '@aida/aida-ui-dsh'

/** Public injection face recorded by the trajectory conversation.view entry. */
interface RegisteredTrajectoryFace {
  hooks: { duration: SnapshotStore<boolean> }
  loadOlder: () => Promise<boolean>
  setActualDuration: (actualDuration: boolean) => void
}

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
  // registrations (rightbar tab body, header utilities, turn tail), so opening a
  // produced file from the chat tail lands in the column. The column is the
  // right Sidebar's docking kit: the Canvas registers a page tab type
  // (`aida-canvas`) whose body is the panel in the keyed `sidebar.right.pane.tab`
  // seat, opens through `ctx.sidebarRight.openTab`, and closes through the tab's
  // own actions (the panel reads them from its `useTabInfo` hook).
  const canvasStore = createAidaCanvasStore()
  const t = ctx.locale.bind(NS)
  const openCanvas = (): void => { ctx.sidebarRight.openTab('aida-canvas') }

  const canvasInjected = (sessionId: SessionId): AidaCanvasInjected => {
    const trajectoryEntry = ctx.slots.entries('conversation.view')
      .find(entry => entry.options.id === 'trajectory')
    if (trajectoryEntry === undefined || trajectoryEntry.inject === undefined) {
      throw new Error('ui-aida: trajectory conversation.view entry is unavailable')
    }
    const injectTrajectory = trajectoryEntry.inject as unknown as (
      sessionId: SessionId,
    ) => RegisteredTrajectoryFace
    const trajectory = injectTrajectory(sessionId)
    return {
      ...aidaWorkspaceApi,
      trajectoryView: trajectoryEntry.component as AidaCanvasInjected['trajectoryView'],
      hooks: { trajectoryDuration: trajectory.hooks.duration },
      loadTrajectoryOlder: trajectory.loadOlder,
      setTrajectoryActualDuration: trajectory.setActualDuration,
      trajectoryT: ctx.locale.bind('trajectory') as AidaCanvasInjected['trajectoryT'],
      downloadSessionLog: () => ctx.sessionLogDownload.download(sessionId),
      // The panel closes its own tab through the tab actions carried by its
      // useTabInfo hook; no injected close face is needed.
      // The composer draft is per-session, so the 引用 actions route through the
      // conversation service's session shell.
      mentionFile: path => mentionFileIntoComposer(ctx, path),
      quoteSelection: (path, text) => quoteSelectionIntoComposer(ctx, path, text),
    }
  }

  // Stage one: the tab type. No `patterns`, so nothing claims it by address —
  // it is opened explicitly by kind (header toggle, tail chips).
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE_NAME,
    kind: 'aida-canvas',
    title: () => t('canvas.title'),
  }), 'ui-aida: canvas tab type')

  // Stage two: the body under the type's id in the keyed pane seat.
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PACKAGE_NAME,
    locale: NS,
    store: canvasStore,
    inject: canvasInjected,
  }, AidaCanvasPanel))

  // Canvas is AIDA's primary workspace surface. Plugin loading can finish
  // before DSH wires the right Sidebar services, so retry briefly until the
  // tab type is registered instead of failing the whole plugin entry.
  const openCanvasWhenReady = (attempt = 0): void => {
    try {
      openCanvas()
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
    inject: (): CanvasToggleInjected => ({ openCanvas }),
  }, AidaCanvasToggle))

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'aida-canvas-tail',
    order: 100,
    locale: NS,
    store: canvasStore,
    inject: (): ProducedTailInjected => ({ openCanvas }),
  }, ProducedTail))

  // ── Intranet models: one-click install of intranet model presets ────────
  // A dedicated settings section beside the shipped Models page; install
  // writes the same `llm-pi-ai` provider profile the Models page's custom
  // provider card does.
  const intranetModels = new IntranetModelsController(ctx.remote as typeof ctx.remote & SettingsWireApi)
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
