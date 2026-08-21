/**
 * Intranet-models install state: joins the `llm-pi-ai` settings namespace
 * with the AIDA preset roster and performs the one-click install write.
 * Mirrors the Models page's custom-provider card: one `settings.mutate` sets
 * the whole profile at `providers.<route>` with the read-time revision, so a
 * route another surface declared meanwhile is a `settings-conflict` refusal
 * rather than a silent overwrite.
 */

import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { installedRoutes, LLM_PROVIDER_NS, providerProfileFor, type IntranetModelPreset } from './presets.ts'

/** State rendered by the intranet-models section. */
export interface IntranetModelsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Revision of the namespace the current view was read at (write guard). */
  revision: number | undefined
  /** Route ids already declared. */
  taken: readonly string[]
  /** Route currently being installed. */
  busy: string | null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Find the llm-pi-ai namespace in a settings description.
 * @param namespaces - described settings namespaces.
 * @returns the provider namespace, when present.
 */
export function providerNamespaceView(namespaces: readonly SettingsNamespaceView[]): SettingsNamespaceView | undefined {
  return namespaces.find(candidate => candidate.ns === LLM_PROVIDER_NS)
}

/** Coordinates the install reads/writes and their store. */
export class IntranetModelsController {
  /** uSES-safe state source shared by the registered section. */
  readonly store: SnapshotStore<IntranetModelsState> = createSnapshotStore({
    status: 'idle', error: null, writable: false, revision: undefined, taken: [], busy: null,
  })

  private generation = 0

  /**
   * @param api - settings wire face used for durable reads and writes.
   */
  constructor(private readonly api: Pick<IApiClient, 'settings'>) {}

  /** Load the namespace view and project the preset install states. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    try {
      const response = await this.api.settings.describe({})
      const result = response.result
      if (!result.ok) throw new Error(result.error.message)
      const view = providerNamespaceView(result.value.namespaces)
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.writable = result.value.writable
        state.revision = view?.revision
        state.taken = view === undefined ? [] : installedRoutes(view.value)
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Install one preset into the llm-pi-ai namespace.
   * @param preset - the preset to install.
   * @returns a failure message, or undefined on success.
   */
  async install(preset: IntranetModelPreset): Promise<string | undefined> {
    this.store.update((state) => { state.busy = preset.route; state.error = null })
    try {
      const revision = this.store.getSnapshot().revision
      const response = await this.api.settings.mutate({
        ns: LLM_PROVIDER_NS,
        ops: [{ op: 'set', path: ['providers', preset.route], value: providerProfileFor(preset) }],
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      })
      if (!response.result.ok) return response.result.error.message
      await this.load()
      return undefined
    } catch (error) {
      return messageOf(error)
    } finally {
      // install is the sole writer of `busy`; clear it regardless of any load
      // the install triggered (load advances its own generation counter).
      this.store.update((state) => { state.busy = null })
    }
  }
}
