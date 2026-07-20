// Node-only. Persistence + Pi provider wiring for user-defined model endpoints.
// A CustomModelEntry (plain data) becomes a Pi ProviderConfigInput via toProviderConfig;
// the registry itself is a JSON file under .pi-workspace/ (gitignored, server-side).

import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { CustomModelEntry } from '../types';

const REGISTRY_DIR = join(process.cwd(), '.pi-workspace');
const REGISTRY_PATH = join(REGISTRY_DIR, 'custom-models.json');

/** Build the id Pi uses for the provider + model pair (`provider/modelId`). */
export function modelSpec(e: CustomModelEntry): string {
  return `${e.id}/${e.modelId}`;
}

/** Sluggify a free-form name into a provider id, guaranteed [a-z0-9-_]. */
export function slugify(name: string): string {
  const s = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'custom';
}

/** Read the persisted registry (empty if missing/corrupt). */
export function loadRegistry(): CustomModelEntry[] {
  try {
    if (!existsSync(REGISTRY_PATH)) return [];
    const raw = readFileSync(REGISTRY_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data?.models) ? data.models as CustomModelEntry[] : [];
  } catch {
    return [];
  }
}

/** Persist the whole registry atomically (best-effort). */
export function saveRegistry(models: CustomModelEntry[]): void {
  try {
    mkdirSync(REGISTRY_DIR, { recursive: true });
    writeFileSync(REGISTRY_PATH, JSON.stringify({ models }, null, 2), 'utf8');
  } catch {
    /* non-fatal — registry stays in memory for this process */
  }
}

/**
 * Map a CustomModelEntry onto Pi's ProviderConfigInput. openai → chat/completions
 * with Bearer auth; anthropic → messages with x-api-key. Cost defaults to 0 so an
 * unconfigured pricing tier never blocks a request.
 */
export function toProviderConfig(e: CustomModelEntry): any {
  const api = e.format === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
  return {
    name: e.label,
    baseUrl: e.baseUrl,
    apiKey: e.apiKey,
    api,
    authHeader: e.format !== 'anthropic',     // Bearer for openai; x-api-key for anthropic
    models: [
      {
        id: e.modelId,
        name: e.modelId,
        api,
        reasoning: !!e.reasoning,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: e.contextWindow || 128000,
        maxTokens: e.maxTokens || 4096,
      },
    ],
  };
}

/** Validate the user-facing fields before registering/testing. */
export function validateEntry(e: Partial<CustomModelEntry>): string | null {
  if (!e.label?.trim()) return '请填写名称';
  if (e.format !== 'openai' && e.format !== 'anthropic') return '请选择格式';
  if (!e.baseUrl?.trim()) return '请填写 Base URL';
  try { new URL(e.baseUrl); } catch { return 'Base URL 格式不正确'; }
  if (!e.apiKey?.trim()) return '请填写 API Key';
  if (!e.modelId?.trim()) return '请填写模型 ID';
  return null;
}
