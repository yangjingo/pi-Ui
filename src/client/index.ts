/**
 * AIDA deployment skin + Canvas: fixed palette, a single sidebar logo, and
 * the Canvas — a right-docked drawer in the
 * frame-wide overlay layer with a workspace file tree, preview, trajectory,
 * and upload. Removing the plugin restores every previous surface.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
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
import { ProducedTail } from './canvas/ProducedTail.tsx'
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
export const inject = ['slots', 'locale', 'theme', 'sessions', 'uiSession', 'remote', 'conversation', 'inputTriggers', 'sidebarRight', 'sidebarRightTabs', 'shortcuts', 'sessionLogDownload']

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
  // ── Canvas: rightbar tab and turn-tail chips ────────────────────────────
  // One shared per-session store handle mounts under the two session-scoped
  // registrations (rightbar tab body, turn tail), so opening a produced file
  // from the chat tail lands in the column. The column is the right Sidebar's
  // docking kit: the Canvas registers a page tab type (`aida-canvas`) whose
  // body is the panel in the keyed `sidebar.right.pane.tab` seat, opens
  // through the kit's own affordances (guide entry, expand button), and
  // closes through the tab's own actions (the panel reads them from its
  // `useTabInfo` hook). No custom header toggle is registered: 0.2.0's
  // ui-sidebar-right already puts its ExpandButton in the session header's
  // corner seat, and a second button there fights it for the same gesture.
  const canvasStore = createAidaCanvasStore()
  const t = ctx.locale.bind(NS)

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
  // it opens explicitly by kind. The guide entry puts the Canvas on the right
  // Sidebar's guide page, which is the kit's native discovery surface; picking
  // it opens the tab.
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE_NAME,
    kind: 'aida-canvas',
    title: () => t('canvas.title'),
    guide: [{
      id: 'aida-canvas',
      order: 100,
      title: () => t('canvas.guideTitle'),
      description: () => t('canvas.guideDescription'),
    }],
  }), 'ui-aida: canvas tab type')

  // Stage two: the body under the type's id in the keyed pane seat.
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PACKAGE_NAME,
    locale: NS,
    store: canvasStore,
    inject: canvasInjected,
  }, AidaCanvasPanel))

  // Canvas shortcut: one toggle gesture over the page type the guide entry
  // opens. When the active tab is the Canvas it closes it; otherwise it opens
  // (and focuses) the Canvas tab in the on-screen Session's right Sidebar.
  ctx.effect(() => ctx.shortcuts.register({
    id: 'aida.canvas.toggle' as ShortcutCommandId,
    label: () => t('canvas.shortcut'),
    aliases: ['canvas', 'aida'],
    defaults: {
      'desktop:macos': { code: 'KeyK', modifiers: ['primary', 'alt'] },
      'desktop:windows': { code: 'KeyK', modifiers: ['primary', 'alt'] },
      'desktop:linux': { code: 'KeyK', modifiers: ['primary', 'alt'] },
      'web:macos': { code: 'KeyK', modifiers: ['primary', 'shift'] },
      'web:windows': { code: 'KeyK', modifiers: ['primary', 'shift'] },
    },
    regions: ['page', 'editable', 'terminal'],
    modals: [],
    resolve: () => {
      if (ctx.sidebarRight.mounted.getSnapshot() === undefined) {
        return { status: 'blocked', reason: t('canvas.shortcutNoSession') }
      }
      const active = ctx.sidebarRight.active()
      if (active !== undefined && active.kind === 'aida-canvas') {
        return { status: 'handled', run: () => { ctx.sidebarRight.close(active.id) } }
      }
      return { status: 'handled', run: () => { ctx.sidebarRight.openTab('aida-canvas') } }
    },
  }), 'ui-aida: canvas shortcut')

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'aida-canvas-tail',
    order: 100,
    locale: NS,
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
