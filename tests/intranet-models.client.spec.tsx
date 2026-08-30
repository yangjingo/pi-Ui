// @vitest-environment jsdom
// AIDA intranet-model presets: the pure preset helpers, the install
// controller (load + one-click install via settings.mutate), and the section
// rendering with install/installed states.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ClientRemote, RpcError } from '@deepseek-ai/dsh-api-remotes/client'
import { zh } from '../src/client/locales.ts'
import {
  installedRoutes, INTRANET_MODEL_PRESETS, isRouteInstalled, LLM_PROVIDER_NS, providerProfileFor,
} from '../src/client/models/presets.ts'
import { IntranetModelsController } from '../src/client/models/intranet-store.ts'
import { IntranetModelsSection } from '../src/client/models/IntranetModelsSection.tsx'
import type { IntranetModelsSectionProps } from '../src/client/models/IntranetModelsSection.tsx'

const t: IntranetModelsSectionProps['t'] = makeTranslate(zh, commonZh)

afterEach(() => { cleanup() })

function ok(value: unknown): { ok: true, value: unknown } {
  return { ok: true, value }
}

function err(): { ok: false, error: RpcError } {
  return { ok: false, error: { code: 'settings-rejected', message: 'no', details: { ns: LLM_PROVIDER_NS } } }
}

function fakeApi(overrides: Partial<Pick<ClientRemote, 'settings'>> = {}) {
  // A mutable providers record the fake mutate updates and describe reflects.
  const providers: Record<string, { api: string }> = { 'intranet-ollama': { api: 'openai-completions' } }
  let revision = 7
  const describe = vi.fn(async () => ok({
    writable: true, hasDocument: false,
    namespaces: [{ ns: LLM_PROVIDER_NS, schema: {}, value: { providers }, applies: 'live', secrets: [], revision }],
  }))
  const mutate = vi.fn(async (
    _ns: string,
    ops: { op: string, path: string[], value: unknown }[],
    _expectedRevision?: number,
  ) => {
    for (const op of ops) {
      if (op.op === 'set' && op.path[0] === 'providers' && op.path[1] !== undefined) {
        providers[op.path[1]] = op.value as { api: string }
        revision += 1
      }
    }
    return ok({})
  })
  const api = { settings: { describe, mutate, ...overrides } } as unknown as Pick<ClientRemote, 'settings'>
  return { api, describe, mutate }
}

describe('intranet model presets', () => {
  it('builds the provider profile the custom-provider card would write', () => {
    const preset = INTRANET_MODEL_PRESETS[0]!
    const profile = providerProfileFor(preset)
    expect(profile).toMatchObject({
      displayName: 'Ollama', api: 'openai-completions', baseURL: 'http://127.0.0.1:11434/v1',
    })
    expect(profile.models.length).toBeGreaterThan(0)
    expect(profile.models[0]).toMatchObject({ id: 'qwen2.5:7b-instruct' })
  })

  it('reports installed routes from the namespace value', () => {
    const value = { providers: { a: {}, b: {} } }
    expect(isRouteInstalled(value, 'a')).toBe(true)
    expect(isRouteInstalled(value, 'c')).toBe(false)
    expect(isRouteInstalled(null, 'a')).toBe(false)
    expect(installedRoutes(value)).toEqual(['a', 'b'])
  })

  it('treats a missing or non-object providers map as not installed', () => {
    expect(isRouteInstalled({ providers: null }, 'a')).toBe(false)
    expect(isRouteInstalled({ providers: 'gateway' }, 'a')).toBe(false)
  })

  it('reports no routes for non-object namespace or providers values', () => {
    expect(installedRoutes(null)).toEqual([])
    expect(installedRoutes('not-an-object')).toEqual([])
    expect(installedRoutes({ providers: null })).toEqual([])
  })
})

describe('intranet models controller', () => {
  it('loads the namespace and projects writable/revision/taken', async () => {
    const { api } = fakeApi()
    const controller = new IntranetModelsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.writable).toBe(true)
    expect(state.revision).toBe(7)
    expect(state.taken).toEqual(['intranet-ollama'])
  })

  it('installs a preset with the read-time revision, then reloads', async () => {
    const { api, mutate } = fakeApi()
    const controller = new IntranetModelsController(api)
    await controller.load()
    const preset = INTRANET_MODEL_PRESETS[1]!
    const failure = await controller.install(preset)
    expect(failure).toBeUndefined()
    expect(mutate).toHaveBeenCalledWith(
      LLM_PROVIDER_NS,
      [{ op: 'set', path: ['providers', 'intranet-vllm'], value: expect.objectContaining({ api: 'openai-completions' }) }],
      7,
    )
    expect(api.settings.describe).toHaveBeenCalledTimes(2)
  })

  it('reports a rejected write as a failure', async () => {
    const { api } = fakeApi()
    api.settings.mutate = vi.fn(async () => err()) as never
    const controller = new IntranetModelsController(api)
    await controller.load()
    const failure = await controller.install(INTRANET_MODEL_PRESETS[0]!)
    expect(failure).toBe('no')
  })

  it('reports a failed describe as an error state', async () => {
    const { api } = fakeApi()
    api.settings.describe = vi.fn(async () => err()) as never
    const controller = new IntranetModelsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('no')
  })

  it('maps a non-Error describe rejection to its string form', async () => {
    const { api } = fakeApi()
    api.settings.describe = vi.fn(async () => { throw { code: 'boom' } })
    const controller = new IntranetModelsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('[object Object]')
  })

  it('ignores a stale load that resolves after a newer one', async () => {
    const { api } = fakeApi()
    const controller = new IntranetModelsController(api)
    const first = controller.load()
    const second = controller.load()
    await Promise.all([first, second])
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.revision).toBe(7)
  })

  it('ignores a stale failed load', async () => {
    const { api } = fakeApi()
    api.settings.describe = vi.fn(async () => { throw new Error('boom') })
    const controller = new IntranetModelsController(api)
    const first = controller.load()
    const second = controller.load()
    await Promise.all([first, second])
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('returns the mutate error message when install transport fails', async () => {
    const { api } = fakeApi()
    api.settings.mutate = vi.fn(async () => { throw new Error('transport down') })
    const controller = new IntranetModelsController(api)
    await controller.load()
    const failure = await controller.install(INTRANET_MODEL_PRESETS[0]!)
    expect(failure).toBe('transport down')
    expect(controller.store.getSnapshot().busy).toBeNull()
  })

  it('loads without the namespace: no taken routes and a revision-less install', async () => {
    const { api, mutate } = fakeApi()
    api.settings.describe = vi.fn(async () => ok({
      writable: true, hasDocument: false, namespaces: [],
    })) as never
    const controller = new IntranetModelsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.taken).toEqual([])
    expect(state.revision).toBeUndefined()
    const failure = await controller.install(INTRANET_MODEL_PRESETS[0]!)
    expect(failure).toBeUndefined()
    // Without a read-time revision the install carries no expectedRevision.
    const payload = mutate.mock.calls[0]?.[0] as { expectedRevision?: number }
    expect(payload.expectedRevision).toBeUndefined()
  })
})

describe('intranet models section', () => {
  function mount(overrides: Partial<IntranetModelsSectionProps> = {}) {
    const { api } = fakeApi()
    const controller = new IntranetModelsController(api)
    render(
      (
        <IntranetModelsSection
          close={vi.fn()}
          useSessions={undefined as never}
          useWorkspaces={undefined as never}
          useIntranetModels={bindSnapshotSelector(controller.store)}
          controller={controller}
          t={t}
          {...overrides}
        />
      ) as unknown as Parameters<typeof render>[0],
    )
    return { controller, api }
  }

  it('lists every preset card and shows the installed badge for taken routes', async () => {
    const { controller } = mount()
    // The mount effect loads asynchronously; wait for the ready render.
    await waitFor(() =>{  expect(controller.store.getSnapshot().status).toBe('ready') })
    const cards = screen.getAllByTestId('aida-intranet-card')
    expect(cards.length).toBe(INTRANET_MODEL_PRESETS.length)
    // The first preset is taken in the fake namespace: exactly one disabled
    // ("installed") button; the rest are enabled ("install").
    const buttons = screen.getAllByTestId('aida-intranet-install')
    const disabled = buttons.filter(button => (button as HTMLButtonElement).disabled)
    expect(disabled.length).toBe(1)
    expect(buttons.length - disabled.length).toBe(INTRANET_MODEL_PRESETS.length - 1)
    expect(cards[0]!.textContent).toContain('已安装')
  })

  it('shows the +N overflow when a preset lists more than four models', async () => {
    const { controller } = mount()
    await waitFor(() =>{  expect(controller.store.getSnapshot().status).toBe('ready') })
    // The vLLM preset carries five models; its card shows the overflow count.
    const vllm = screen.getAllByTestId('aida-intranet-card')[1]!
    expect(vllm.textContent).toContain('+1')
    expect(vllm.querySelectorAll('li')).toHaveLength(5)
  })

  it('renders the error state and the read-only notice', async () => {
    const broken = fakeApi()
    broken.api.settings.describe = vi.fn(async () => { throw new Error('describe boom') })
    const errorController = new IntranetModelsController(broken.api)
    mount({
      controller: errorController,
      useIntranetModels: bindSnapshotSelector(errorController.store),
    })
    expect(await screen.findByText('describe boom')).toBeTruthy()
    cleanup()

    const readonly = fakeApi()
    readonly.api.settings.describe = vi.fn(async () => ok({
      writable: false, hasDocument: false, namespaces: [],
    })) as never
    const readOnlyController = new IntranetModelsController(readonly.api)
    mount({
      controller: readOnlyController,
      useIntranetModels: bindSnapshotSelector(readOnlyController.store),
    })
    expect(await screen.findByText('当前设置不可写，无法安装模型提供方。')).toBeTruthy()
  })

  it('installs a preset on click and disables while busy', async () => {
    const { controller } = mount()
    await waitFor(() =>{  expect(controller.store.getSnapshot().status).toBe('ready') })
    const card = screen.getAllByTestId('aida-intranet-card')[1]!
    fireEvent.click(card.querySelector('[data-testid="aida-intranet-install"]')!)
    await waitFor(() =>{  expect(controller.store.getSnapshot().taken).toContain('intranet-vllm') })
    expect(controller.store.getSnapshot().busy).toBeNull()
  })

  it('disables every install button while an install is in flight', async () => {
    const { controller, api } = mount()
    api.settings.mutate = vi.fn(() => new Promise<never>(() => {}))
    await waitFor(() =>{  expect(controller.store.getSnapshot().status).toBe('ready') })
    const button = screen.getAllByTestId('aida-intranet-install')[1]!
    fireEvent.click(button)
    await waitFor(() =>{  expect(controller.store.getSnapshot().busy).toBe('intranet-vllm') })
    // While the install is pending, every button is disabled and the busy
    // one shows the in-flight label.
    const buttons = screen.getAllByTestId('aida-intranet-install')
    expect(buttons.every(candidate => (candidate as HTMLButtonElement).disabled)).toBe(true)
    expect(button.textContent).toContain('安装中…')
  })

  it('reloads the roster when an install is rejected', async () => {
    const { controller, api } = mount()
    api.settings.mutate = vi.fn(async () => err()) as never
    await waitFor(() =>{  expect(controller.store.getSnapshot().status).toBe('ready') })
    expect(api.settings.describe).toHaveBeenCalledTimes(1)
    const card = screen.getAllByTestId('aida-intranet-card')[1]!
    fireEvent.click(card.querySelector('[data-testid="aida-intranet-install"]')!)
    await waitFor(() =>{  expect(api.settings.describe).toHaveBeenCalledTimes(2) })
    // The rejected write leaves the roster unchanged and the card installable.
    expect(controller.store.getSnapshot().taken).toEqual(['intranet-ollama'])
    expect(card.textContent).toContain('一键安装')
  })
})
