/**
 * AIDA intranet model presets: a curated set of OpenAI-compatible provider
 * profiles for common intranet/local model servers (Ollama, vLLM, One API
 * gateways, LM Studio). Each preset installs with ONE `settings.mutate` into
 * the `llm-pi-ai` namespace at `providers.<route>` — the same write the
 * Models page's custom-provider card performs — after which the provider and
 * its models appear in the model picker. Base URLs default to loopback and
 * the user edits them for their intranet host in the Models page after
 * install.
 */

import type { AidaKey } from '../locales.ts'

/** The settings namespace hand-declared providers are written into. */
export const LLM_PROVIDER_NS = 'llm-pi-ai'

/** One default model of a preset. */
export interface IntranetModelPresetModel {
  /** Model id as the server exposes it. */
  id: string
  /** Optional display name. */
  name?: string
  /** Optional context-window capacity (tokens). */
  contextWindow?: number
  /** Optional max-output capacity (tokens). */
  maxTokens?: number
}

/** One installable intranet provider preset. */
export interface IntranetModelPreset {
  /** Route id (also the settings key and credential-name stem). */
  route: string
  /** Display name shown on the install card and in the model picker. */
  displayName: string
  /** Locale key of the one-line deployment description. */
  descriptionKey: AidaKey
  /** Wire protocol the preset speaks (OpenAI-compatible by default). */
  protocol: string
  /** Default endpoint; the user adjusts it for their intranet host. */
  baseURL: string
  /** Default models the server is expected to serve. */
  models: readonly IntranetModelPresetModel[]
}

/** The curated preset roster. */
export const INTRANET_MODEL_PRESETS: readonly IntranetModelPreset[] = [
  {
    route: 'intranet-ollama',
    displayName: 'Ollama',
    descriptionKey: 'intranet.descOllama',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [
      { id: 'qwen2.5:7b-instruct', name: 'Qwen2.5 7B Instruct', contextWindow: 32768, maxTokens: 8192 },
      { id: 'deepseek-r1:7b', name: 'DeepSeek-R1 7B', contextWindow: 32768, maxTokens: 8192 },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', contextWindow: 131072, maxTokens: 8192 },
      { id: 'glm4:9b-chat', name: 'GLM-4 9B Chat', contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    route: 'intranet-vllm',
    displayName: 'vLLM',
    descriptionKey: 'intranet.descVllm',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:8000/v1',
    models: [
      { id: 'deepseek-v3', name: 'DeepSeek-V3', contextWindow: 131072, maxTokens: 8192 },
      { id: 'deepseek-r1', name: 'DeepSeek-R1', contextWindow: 131072, maxTokens: 8192 },
      { id: 'qwen2.5-72b-instruct', name: 'Qwen2.5 72B Instruct', contextWindow: 131072, maxTokens: 8192 },
      { id: 'glm-4-9b-chat', name: 'GLM-4 9B Chat', contextWindow: 131072, maxTokens: 8192 },
      { id: 'llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    route: 'intranet-oneapi',
    displayName: 'One API gateway',
    descriptionKey: 'intranet.descOneApi',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:3000/v1',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 65536, maxTokens: 8192 },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 65536, maxTokens: 8192 },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, maxTokens: 8192 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 131072, maxTokens: 8192 },
    ],
  },
  {
    route: 'intranet-lmstudio',
    displayName: 'LM Studio',
    descriptionKey: 'intranet.descLmStudio',
    protocol: 'openai-completions',
    baseURL: 'http://127.0.0.1:1234/v1',
    models: [
      { id: 'local-model', name: 'Local model', contextWindow: 32768, maxTokens: 8192 },
    ],
  },
]

/**
 * Build the settings value written for one preset.
 * @param preset - selected intranet provider preset.
 * @returns a detached provider profile matching the custom-provider form.
 */
export function providerProfileFor(preset: IntranetModelPreset): {
  displayName: string
  api: string
  baseURL: string
  models: readonly IntranetModelPresetModel[]
} {
  return {
    displayName: preset.displayName,
    api: preset.protocol,
    baseURL: preset.baseURL,
    models: preset.models.map(model => ({ ...model })),
  }
}

/**
 * Check whether a provider route is already declared.
 * @param namespaceValue - current llm-pi-ai namespace value.
 * @param route - provider route id.
 * @returns true when the providers object owns that route.
 */
export function isRouteInstalled(namespaceValue: unknown, route: string): boolean {
  if (typeof namespaceValue !== 'object' || namespaceValue === null) return false
  const providers = (namespaceValue as Record<string, unknown>).providers
  if (typeof providers !== 'object' || providers === null) return false
  return Object.hasOwn(providers, route)
}

/**
 * List all currently declared provider routes.
 * @param namespaceValue - current llm-pi-ai namespace value.
 * @returns provider keys, or an empty list for a missing providers object.
 */
export function installedRoutes(namespaceValue: unknown): readonly string[] {
  if (typeof namespaceValue !== 'object' || namespaceValue === null) return []
  const providers = (namespaceValue as Record<string, unknown>).providers
  if (typeof providers !== 'object' || providers === null) return []
  return Object.keys(providers)
}
