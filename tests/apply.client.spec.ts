// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { ThemeRuntime, type ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject } from '../src/client/index.ts'

const TrajectoryView = () => null

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const theme = new ThemeRuntime(ctx, stubSettingsScope<ThemeSettings>().scope)
  ctx.provide('theme', theme)
  const workspaces = {
    listFiles: vi.fn(async () => ({ root: '/p', files: [], truncated: false })),
    readFile: vi.fn(async () => ({ path: 'x', content: '', truncated: false, totalBytes: 0 })),
    writeFile: vi.fn(async () => ({ path: 'x' })),
    renameFile: vi.fn(async () => ({ path: 'x' })),
    moveFile: vi.fn(async () => ({ path: 'x' })),
    deleteFile: vi.fn(async () => ({ path: 'x' })),
  }
  ctx.provide('workspaces', workspaces)
  const sessions = {
    list: createSnapshotStore<SessionListState>({
      ids: ['s1' as SessionId],
      byId: { ['s1' as SessionId]: { id: 's1' as SessionId, displayTitle: 'p', cwd: '/p', running: false, blank: false, updatedAt: 1 } },
      current: 's1' as SessionId,
      phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }),
    binding: vi.fn(() => undefined),
    scope: vi.fn(() => ({ sessionId: 's1' as SessionId })),
  } as unknown as ISessions
  ctx.provide('sessions', sessions)
  const inputTriggers = { registerSource: vi.fn(() => () => {}) }
  ctx.provide('inputTriggers', inputTriggers)
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn() }
  ctx.provide('layout', layout)
  const conversation = {
    input: { for: vi.fn(() => ({
      setDraft: vi.fn(),
      insertReference: vi.fn(() => true),
      state: { getSnapshot: () => ({ draft: '', draftRev: 0 }) },
    })) },
  }
  ctx.provide('conversation', conversation)
  const sessionLogDownload = { download: vi.fn(async () => {}) }
  ctx.provide('sessionLogDownload', sessionLogDownload)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: {
        describe: vi.fn(async () => ({ result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } } })),
        mutate: vi.fn(async () => ({ result: { ok: true, value: {} } })),
      },
    },
    rpc: {},
    hostDescription: { getSnapshot: () => undefined, subscribe: () => () => {} },
    start: () => ({ stop: () => {} }),
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      conversation: { kind: 'single', scope: 'root' },
      settings: { kind: 'single', scope: 'root' },
      details: { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'settings',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'conversation',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
      // The conversation body declares the view ring (ui-conversation apply);
      // AIDA's canvas redeclares the identical spec to share the seat.
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const trajectoryDuration = createSnapshotStore(false)
  slots.register({
    name: 'conversation.view',
    id: 'trajectory',
    order: 10,
    inject: () => ({
      hooks: { duration: trajectoryDuration },
      loadOlder: vi.fn(async () => false),
      setActualDuration: vi.fn(),
    }),
  } as never, TrajectoryView)
  // The built-in tool-details panel occupies the details seat at priority 0
  // (AIDA's canvas shadows it at -1).
  slots.register({ name: 'details' } as never, () => null)
  return { ctx, slots, theme, workspaces, sessions, inputTriggers, layout, conversation, sessionLogDownload }
}

describe('ui-aida apply', () => {
  it('declares the presentation, workspace-file, sessions, connection, conversation, trigger, and layout services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme', 'workspaces', 'sessions', 'connection', 'conversation', 'inputTriggers', 'layout', 'sessionLogDownload'])
  })

  it('owns adaptive identity tokens and reversible brand + Canvas takeovers', async () => {
    const b = await bench()
    const previous = b.theme.getTheme().preference
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.theme.getTheme().preference).toBe(previous)
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe('#3551D8')
    expect(b.slots.entries('sidebar.brand.mark')).toHaveLength(1)
    expect(b.slots.entries('sidebar.brand.name')).toHaveLength(1)
    expect(b.slots.entries('conversation.hero.brand.mark')).toHaveLength(1)
    // The Canvas surface: the right-hand details column, the session-header
    // toggle, and the turn-tail chips.
    expect(b.slots.entries('details')).toHaveLength(2)
    expect(b.slots.entries('details')[0]!.options.priority).toBe(-1)
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(1)
    expect(b.slots.entries('conversation.chat.turnTail')).toHaveLength(1)
    // The intranet-models settings section.
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    // The workspace-file '@' mention source registers with the trigger service.
    expect(b.inputTriggers.registerSource).toHaveBeenCalledTimes(1)

    b.theme.setTheme('dark')
    expect(b.theme.getTheme().preference).toBe('dark')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe('#7386F5')

    await fiber.dispose()
    expect(b.theme.getTheme().preference).toBe('dark')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBeUndefined()
    expect(b.slots.entries('sidebar.brand.mark')).toHaveLength(0)
    expect(b.slots.entries('sidebar.brand.name')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.brand.mark')).toHaveLength(0)
    // AIDA's canvas entry withdraws; the bench's fake built-in details entry
    // (registered before the fiber) stays.
    expect(b.slots.entries('details')).toHaveLength(1)
    expect(b.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    expect(b.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
    expect(b.slots.entries('settings.section')).toHaveLength(0)
  })

  it('wires the injected faces to the bench services', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    // The panel's inject face binds the workspace verbs, the column close,
    // the original DSH trajectory view controls, and the composer actions.
    const details = b.slots.entries('details').find(entry => entry.options.priority === -1)!
    const injected = details.inject?.('s1' as SessionId) as {
      listFiles: (root: string, signal?: AbortSignal) => Promise<unknown>
      readFile: (root: string, path: string) => Promise<unknown>
      writeFile: (root: string, path: string, input: object) => Promise<unknown>
      renameFile: (root: string, path: string, nextName: string) => Promise<unknown>
      moveFile: (root: string, path: string, targetPath: string) => Promise<unknown>
      deleteFile: (root: string, path: string) => Promise<unknown>
      closeCanvas: () => void
      loadTrajectoryOlder: () => Promise<boolean>
      setTrajectoryActualDuration: (value: boolean) => void
      trajectoryView: typeof TrajectoryView
      trajectoryT: (key: string) => string
      downloadSessionLog: () => Promise<void>
      mentionFile: (path: string) => void
      quoteSelection: (path: string, text: string) => void
    }
    expect(injected.listFiles).toEqual(expect.any(Function))
    expect(injected.loadTrajectoryOlder).toEqual(expect.any(Function))
    expect(injected.setTrajectoryActualDuration).toEqual(expect.any(Function))
    expect(injected.trajectoryView).toBe(TrajectoryView)
    expect(injected.trajectoryT).toEqual(expect.any(Function))
    await injected.downloadSessionLog()
    expect(b.sessionLogDownload.download).toHaveBeenCalledWith('s1')
    expect(injected.readFile).toEqual(expect.any(Function))
    expect(injected.writeFile).toEqual(expect.any(Function))
    expect(injected.renameFile).toEqual(expect.any(Function))
    expect(injected.moveFile).toEqual(expect.any(Function))
    expect(injected.deleteFile).toEqual(expect.any(Function))
    expect(typeof injected.closeCanvas).toBe('function')
    expect(b.layout.openDetails).toHaveBeenCalledTimes(1)
    injected.closeCanvas()
    expect(b.layout.closeDetails).toHaveBeenCalledTimes(1)
    injected.mentionFile('README.md')
    injected.quoteSelection('README.md', 'hello')
    expect(b.conversation.input.for).toHaveBeenCalled()

    // The header toggle and the turn-tail chips open the column.
    const toggle = b.slots.entries('conversation.session.header.utilities')[0]!
    const toggleInjected = toggle.inject?.() as { openCanvas: () => void }
    toggleInjected.openCanvas()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(2)
    const tail = b.slots.entries('conversation.chat.turnTail')[0]!
    const tailInjected = tail.inject?.() as { openCanvas: () => void }
    tailInjected.openCanvas()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(3)

    // The intranet settings section binds its controller and label.
    const section = b.slots.entries('settings.section')[0]!
    // The bench browser locale is English; the label follows the locale runtime.
    expect((section.options.label as () => string)()).toBe('Intranet models')
    const sectionInjected = section.inject?.() as {
      controller: { store: { getSnapshot: () => unknown } }
      hooks: { intranetModels: unknown }
    }
    expect(sectionInjected.hooks.intranetModels).toBe(sectionInjected.controller.store)

    await fiber.dispose()
  })
})
