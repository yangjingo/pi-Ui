// Node-only model configuration built around the pi-ai Models and CredentialStore contracts.
// Canvas never parses or persists provider configuration; PiRuntime and the HTTP transport
// delegate every model operation to this Core service.

import type {
  Api,
  Credential,
  CredentialInfo,
  CredentialStore,
  Model,
  Models,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  CustomModelEntry,
  ModelConfigFile,
  ModelConfigImportResult,
  ModelOption,
  ModelTestResult,
  UpdateModelEntry,
} from '../agent/protocol';

export const DEFAULT_MODEL_SPEC = process.env.PI_MODEL || '';

const MODEL_BENCHMARKS = [
  { inputTarget: 1024, outputTarget: 1024 },
  { inputTarget: 8192, outputTarget: 1024 },
  { inputTarget: 512, outputTarget: 512 },
] as const;

const DEFAULT_MODELS_CONFIG = { providers: {} };

type ProviderConfig = Parameters<ModelRuntime['registerProvider']>[1];
type ModelsConfig = { providers: Record<string, ProviderConfig> };
type CredentialData = Record<string, Credential>;

function jsonObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatOf(api: unknown): CustomModelEntry['format'] {
  return typeof api === 'string' && api.includes('anthropic') ? 'anthropic' : 'openai';
}

function apiOf(format: CustomModelEntry['format']): Api {
  return format === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function slugify(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'custom';
}

function validateEntry(entry: Partial<CustomModelEntry>, requireApiKey: boolean): string | null {
  if (!entry.label?.trim()) return '请填写名称';
  if (entry.format !== 'openai' && entry.format !== 'anthropic') return '请选择格式';
  if (!entry.baseUrl?.trim()) return '请填写 Base URL';
  try { new URL(entry.baseUrl); } catch { return 'Base URL 格式不正确'; }
  if (requireApiKey && !entry.apiKey?.trim()) return '请填写 API Key';
  if (!entry.modelId?.trim()) return '请填写模型 ID';
  return null;
}

function providerConfigOf(entry: CustomModelEntry): ProviderConfig {
  const api = apiOf(entry.format);
  return {
    name: entry.label.trim(),
    baseUrl: entry.baseUrl.trim(),
    api,
    authHeader: entry.format !== 'anthropic',
    models: [{
      id: entry.modelId.trim(),
      name: entry.label.trim() || entry.modelId.trim(),
      api,
      reasoning: Boolean(entry.reasoning),
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: entry.contextWindow || 128_000,
      maxTokens: entry.maxTokens || 4096,
    }],
  };
}

function normalizeModelsConfig(value: unknown): ModelsConfig | null {
  if (!jsonObject(value) || !jsonObject(value.providers)) return null;
  const providers: Record<string, ProviderConfig> = {};
  for (const [providerId, rawProvider] of Object.entries(value.providers)) {
    if (!providerId.trim() || !jsonObject(rawProvider)) return null;
    const provider = structuredClone(rawProvider) as Record<string, any>;
    delete provider.apiKey;
    providers[providerId] = provider as ProviderConfig;
  }
  return { providers };
}

function configuredModelSpecs(config: ModelsConfig): Set<string> {
  const specs = new Set<string>();
  for (const [providerId, provider] of Object.entries(config.providers)) {
    const models = Array.isArray((provider as any)?.models) ? (provider as any).models : [];
    for (const model of models) {
      const modelId = cleanString(model?.id);
      if (modelId) specs.add(`${providerId}/${modelId}`);
    }
  }
  return specs;
}

function parseJson(content: string): { value?: any; error?: string } {
  try {
    return { value: JSON.parse(content) };
  } catch (error: any) {
    return { error: `JSON 格式错误：${error?.message || error}` };
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

/** A project-local implementation of pi-ai's CredentialStore contract. */
export class FileCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private data(): CredentialData {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'));
      return jsonObject(value) ? value as CredentialData : {};
    } catch {
      return {};
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return this.data()[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.data()).flatMap(([providerId, credential]) =>
      credential?.type === 'api_key' || credential?.type === 'oauth'
        ? [{ providerId, type: credential.type }]
        : []);
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const operation = this.chain.then(async () => {
      const data = this.data();
      const next = await fn(data[providerId]);
      if (next !== undefined) {
        data[providerId] = next;
        atomicWrite(this.path, JSON.stringify(data, null, 2) + '\n');
      }
      return next ?? data[providerId];
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }

  async delete(providerId: string): Promise<void> {
    const operation = this.chain.then(() => {
      const data = this.data();
      if (!Object.prototype.hasOwnProperty.call(data, providerId)) return;
      delete data[providerId];
      atomicWrite(this.path, JSON.stringify(data, null, 2) + '\n');
    });
    this.chain = operation.catch(() => undefined);
    await operation;
  }
}

export interface CoreModelConfigurationOptions {
  root?: string;
  allowNetwork?: boolean;
}

/**
 * Core-owned facade over coding-agent's ModelRuntime, which is the configured
 * pi-ai Models collection used by Agent sessions and SDK consumers.
 */
export class CoreModelConfiguration {
  readonly coreDirectory: string;
  readonly modelsPath: string;
  readonly authPath: string;
  readonly modelsStorePath: string;
  readonly selectionPath: string;

  private readonly credentials: FileCredentialStore;
  private readonly allowNetwork: boolean;
  private runtimeValue: ModelRuntime | null = null;
  private activeSpecValue = DEFAULT_MODEL_SPEC;
  private prepared = false;

  constructor(options: CoreModelConfigurationOptions = {}) {
    const root = options.root || process.cwd();
    this.coreDirectory = join(root, '.workspace', '.agentcore');
    this.modelsPath = join(this.coreDirectory, 'models.json');
    this.authPath = join(this.coreDirectory, 'auth.json');
    this.modelsStorePath = join(this.coreDirectory, 'models-store.json');
    this.selectionPath = join(this.coreDirectory, 'active-model.json');
    this.credentials = new FileCredentialStore(this.authPath);
    this.allowNetwork = options.allowNetwork ?? false;
  }

  get activeSpec(): string {
    return this.activeSpecValue;
  }

  get runtime(): ModelRuntime {
    if (!this.runtimeValue) throw new Error('模型运行时尚未初始化');
    return this.runtimeValue;
  }

  private config(): ModelsConfig {
    const parsed = parseJson(readFileSync(this.modelsPath, 'utf8'));
    return normalizeModelsConfig(parsed.value) || { providers: {} };
  }

  private saveSelection(spec: string): void {
    this.activeSpecValue = spec;
    atomicWrite(this.selectionPath, JSON.stringify({ model: spec }, null, 2) + '\n');
  }

  private async migrateCredential(providerId: string, apiKey: unknown): Promise<void> {
    const key = cleanString(apiKey);
    if (!key) return;
    await this.credentials.modify(providerId, async () => ({ type: 'api_key', key }));
  }

  private async migrateLegacyConfig(): Promise<ModelsConfig | null> {
    const legacyPaths = [
      join(dirname(this.coreDirectory), 'settings.json'),
      join(this.coreDirectory, 'settings.json'),
    ];
    for (const path of legacyPaths) {
      if (!existsSync(path)) continue;
      const parsed = parseJson(readFileSync(path, 'utf8')).value;
      const normalized = normalizeModelsConfig(parsed);
      if (!normalized) continue;
      for (const [providerId, provider] of Object.entries(parsed.providers as Record<string, any>)) {
        await this.migrateCredential(providerId, provider?.apiKey);
      }
      const provider = cleanString(parsed.defaultProvider);
      const model = cleanString(parsed.defaultModel);
      if (provider && model) this.saveSelection(`${provider}/${model}`);
      return normalized;
    }
    return null;
  }

  private async prepare(): Promise<void> {
    if (this.prepared) return;
    mkdirSync(this.coreDirectory, { recursive: true });

    let existing: any;
    if (existsSync(this.modelsPath)) {
      existing = parseJson(readFileSync(this.modelsPath, 'utf8')).value;
    }

    // Older builds used this path for a { models: CustomModelEntry[] } registry.
    if (jsonObject(existing) && Array.isArray(existing.models) && !existing.providers) {
      const providers: Record<string, ProviderConfig> = {};
      for (const raw of existing.models) {
        if (!jsonObject(raw)) continue;
        const entry = raw as unknown as CustomModelEntry;
        if (validateEntry(entry, true)) continue;
        providers[entry.id || slugify(entry.label)] = providerConfigOf(entry);
        await this.migrateCredential(entry.id || slugify(entry.label), entry.apiKey);
      }
      existing = { providers };
    }

    if (jsonObject(existing?.providers)) {
      for (const [providerId, provider] of Object.entries(existing.providers)) {
        if (jsonObject(provider)) await this.migrateCredential(providerId, provider.apiKey);
      }
    }

    const normalized = normalizeModelsConfig(existing)
      || await this.migrateLegacyConfig()
      || structuredClone(DEFAULT_MODELS_CONFIG);
    atomicWrite(this.modelsPath, JSON.stringify(normalized, null, 2) + '\n');

    if (existsSync(this.selectionPath)) {
      const selection = parseJson(readFileSync(this.selectionPath, 'utf8')).value;
      this.activeSpecValue = cleanString(selection?.model) || this.activeSpecValue;
    } else {
      this.saveSelection(this.activeSpecValue);
    }
    this.prepared = true;
  }

  async ensureRuntime(): Promise<ModelRuntime> {
    if (this.runtimeValue) return this.runtimeValue;
    await this.prepare();
    this.runtimeValue = await ModelRuntime.create({
      credentials: this.credentials,
      modelsPath: this.modelsPath,
      modelsStorePath: this.modelsStorePath,
      allowModelNetwork: this.allowNetwork,
    });
    await this.runtimeValue.refresh({ allowNetwork: this.allowNetwork });
    return this.runtimeValue;
  }

  resolveModel(spec: string): Model<Api> | undefined {
    const separator = spec.indexOf('/');
    if (separator < 1) return undefined;
    const providerId = spec.slice(0, separator);
    const modelId = spec.slice(separator + 1);
    if (!configuredModelSpecs(this.config()).has(`${providerId}/${modelId}`)) return undefined;
    return this.runtime.getModel(providerId, modelId);
  }

  fallbackModel(): Model<Api> | undefined {
    const configured = configuredModelSpecs(this.config());
    const isConfigured = (model: Model<Api>) => configured.has(`${model.provider}/${model.id}`);
    return this.runtime.getAvailableSnapshot().find(isConfigured)
      || this.runtime.getModels().find(isConfigured);
  }

  async listModels(activeSpec = this.activeSpecValue): Promise<ModelOption[]> {
    await this.ensureRuntime();
    const config = this.config();
    const configured = config.providers;
    const specs = configuredModelSpecs(config);
    const credentials = new Map((await this.credentials.list()).map(item => [item.providerId, item]));
    const candidates = this.runtime.getModels()
      .filter(model => specs.has(`${model.provider}/${model.id}`));

    return candidates.map((model): ModelOption => {
      const providerConfig = configured[model.provider] as any;
      const status = this.runtime.getProviderAuthStatus(model.provider);
      const storedCredential = credentials.get(model.provider);
      return {
        id: `${model.provider}/${model.id}`,
        provider: model.provider,
        modelId: model.id,
        label: model.name || model.id,
        custom: true,
        active: `${model.provider}/${model.id}` === activeSpec,
        baseUrl: model.baseUrl || providerConfig?.baseUrl,
        apiKeyMasked: storedCredential ? '已安全存储' : undefined,
        apiKeyConfigured: Boolean(status?.configured || storedCredential),
        configSource: 'core',
        sourceLabel: '.workspace/.agentcore/models.json',
        format: formatOf(model.api),
      };
    }).sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
  }

  async getConfigFile(): Promise<ModelConfigFile> {
    await this.prepare();
    return {
      path: '.workspace/.agentcore/models.json',
      authPath: '.workspace/.agentcore/auth.json',
      content: readFileSync(this.modelsPath, 'utf8'),
    };
  }

  private async applyConfig(next: ModelsConfig): Promise<void> {
    const previous = existsSync(this.modelsPath) ? readFileSync(this.modelsPath, 'utf8') : '';
    atomicWrite(this.modelsPath, JSON.stringify(next, null, 2) + '\n');
    try {
      if (this.runtimeValue) {
        await this.runtimeValue.reloadConfig();
        const error = this.runtimeValue.getError();
        if (error) throw new Error(error);
      }
    } catch (error) {
      atomicWrite(this.modelsPath, previous);
      if (this.runtimeValue) await this.runtimeValue.reloadConfig();
      throw error;
    }
  }

  async saveConfigFile(content: string): Promise<{ ok: boolean; error?: string; file?: ModelConfigFile }> {
    const parsed = parseJson(content);
    if (parsed.error) return { ok: false, error: parsed.error };
    const config = normalizeModelsConfig(parsed.value);
    if (!config) return { ok: false, error: 'models.json 需要包含 providers 对象' };

    try {
      for (const [providerId, provider] of Object.entries(parsed.value.providers as Record<string, any>)) {
        await this.migrateCredential(providerId, provider?.apiKey);
      }
      await this.applyConfig(config);
      return { ok: true, file: await this.getConfigFile() };
    } catch (error: any) {
      return { ok: false, error: `应用 Core 模型配置失败：${error?.message || error}` };
    }
  }

  parseImportedConfig(content: string): ModelConfigImportResult {
    const parsed = parseJson(content);
    if (parsed.error) return { ok: false, error: parsed.error };
    const value = parsed.value;
    if (!jsonObject(value)) return { ok: false, error: '配置根节点必须是 JSON 对象' };

    let source: Record<string, any> = value;
    let providerId = '';
    if (jsonObject(value.providers)) {
      const first = Object.entries(value.providers).find(([, provider]) => jsonObject(provider));
      if (first) {
        providerId = first[0];
        source = first[1] as Record<string, any>;
      }
    }
    const model = Array.isArray(source.models) && jsonObject(source.models[0])
      ? source.models[0] as Record<string, any>
      : jsonObject(value.model) ? value.model : source;
    const nestedCandidates = [
      value.customModel,
      value.custom_model,
      value.modelConfig,
      value.model_config,
      value.llm,
      value.config,
      value.settings,
      value.provider,
      value.openai,
      value.anthropic,
    ].filter(jsonObject);
    if (!providerId && nestedCandidates.length) source = nestedCandidates[0];

    const pick = (objects: Record<string, any>[], ...keys: string[]) => {
      for (const object of objects) {
        for (const key of keys) {
          const matching = Object.keys(object).find(candidate => candidate.toLowerCase() === key.toLowerCase());
          const selected = matching ? cleanString(object[matching]) : undefined;
          if (selected) return selected;
        }
      }
      return undefined;
    };
    const objects = [model, source, value].filter(jsonObject);
    const rawKey = pick(objects, 'apiKey', 'api_key', 'apikey', 'key', 'token', 'authorization');
    const bearer = rawKey?.match(/^Bearer\s+(.+)$/i);
    const api = pick(objects, 'api', 'format', 'apiType', 'provider');
    const baseUrl = pick(objects, 'baseUrl', 'base_url', 'baseURL', 'url', 'endpoint', 'apiBase');
    const entry: Partial<CustomModelEntry> = {
      id: providerId || undefined,
      label: pick(objects, 'label', 'name', 'title') || providerId || undefined,
      format: formatOf(api || baseUrl),
      baseUrl,
      apiKey: bearer ? bearer[1].trim() : rawKey,
      modelId: pick([model, source, value], 'modelId', 'model_id', 'id', 'model'),
    };
    const missing: string[] = [];
    if (!entry.label) missing.push('显示名称');
    if (!entry.baseUrl) missing.push('Base URL');
    if (!entry.apiKey) missing.push('API Key');
    if (!entry.modelId) missing.push('模型 ID');
    return { ok: true, entry, missing };
  }

  async addCustomModel(entry: CustomModelEntry): Promise<{ ok: boolean; error?: string; entry?: CustomModelEntry }> {
    const error = validateEntry(entry, true);
    if (error) return { ok: false, error };
    await this.ensureRuntime();

    const config = this.config();
    let providerId = entry.id?.trim() || slugify(entry.label);
    if (config.providers[providerId]) {
      providerId = `${providerId}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const saved = { ...entry, id: providerId };
    try {
      await this.credentials.modify(providerId, async () => ({ type: 'api_key', key: entry.apiKey.trim() }));
      config.providers[providerId] = providerConfigOf(saved);
      await this.applyConfig(config);
      return { ok: true, entry: { ...saved, apiKey: '' } };
    } catch (cause: any) {
      return { ok: false, error: `保存配置失败：${cause?.message || cause}` };
    }
  }

  async updateModel(
    providerId: string,
    currentModelId: string,
    update: UpdateModelEntry,
  ): Promise<{ ok: boolean; error?: string; model?: string }> {
    const entry: CustomModelEntry = {
      id: providerId,
      label: update.label,
      format: update.format,
      baseUrl: update.baseUrl,
      apiKey: update.apiKey || '',
      modelId: update.modelId,
      reasoning: update.reasoning,
      contextWindow: update.contextWindow,
      maxTokens: update.maxTokens,
    };
    const error = validateEntry(entry, false);
    if (error) return { ok: false, error };

    const config = this.config();
    let provider = config.providers[providerId] as any;
    if (!provider) {
      const sdkModel = this.runtimeValue?.getModel(providerId, currentModelId);
      if (!sdkModel) return { ok: false, error: 'pi-ai SDK 中未找到该 Provider/模型' };
      provider = providerConfigOf({
        ...entry,
        modelId: currentModelId,
        reasoning: sdkModel.reasoning,
        contextWindow: sdkModel.contextWindow,
        maxTokens: sdkModel.maxTokens,
      });
      config.providers[providerId] = provider;
    }
    const models = Array.isArray(provider.models) ? provider.models : [];
    const target = models.find((model: any) => model?.id === currentModelId);
    if (!target) return { ok: false, error: 'Core models.json 中未找到该模型' };
    if (update.modelId !== currentModelId && models.some((model: any) => model !== target && model?.id === update.modelId)) {
      return { ok: false, error: '该 Provider 已存在相同的模型 ID' };
    }

    const api = apiOf(update.format);
    provider.name = update.label.trim();
    provider.baseUrl = update.baseUrl.trim();
    provider.api = api;
    provider.authHeader = update.format !== 'anthropic';
    target.id = update.modelId.trim();
    target.name = update.label.trim() || update.modelId.trim();
    target.api = api;
    if (typeof update.reasoning === 'boolean') target.reasoning = update.reasoning;
    if (update.contextWindow) target.contextWindow = update.contextWindow;
    if (update.maxTokens) target.maxTokens = update.maxTokens;

    try {
      if (update.apiKey?.trim()) {
        await this.credentials.modify(providerId, async () => ({ type: 'api_key', key: update.apiKey!.trim() }));
      }
      await this.applyConfig(config);
      const nextSpec = `${providerId}/${update.modelId.trim()}`;
      if (this.activeSpecValue === `${providerId}/${currentModelId}`) this.saveSelection(nextSpec);
      return { ok: true, model: nextSpec };
    } catch (cause: any) {
      return { ok: false, error: `保存模型失败：${cause?.message || cause}` };
    }
  }

  async removeCustomModel(providerId: string): Promise<{ ok: boolean; active?: string; error?: string }> {
    const config = this.config();
    if (!config.providers[providerId]) return { ok: false, error: 'Core models.json 中未找到该 Provider' };
    try {
      delete config.providers[providerId];
      await this.applyConfig(config);
      await this.credentials.delete(providerId);
      let active = this.activeSpecValue;
      if (active.startsWith(`${providerId}/`)) {
        const fallback = this.fallbackModel();
        active = fallback ? `${fallback.provider}/${fallback.id}` : DEFAULT_MODEL_SPEC;
        this.saveSelection(active);
      }
      return { ok: true, active };
    } catch (cause: any) {
      return { ok: false, error: cause?.message || String(cause) };
    }
  }

  async selectModel(
    providerId: string,
    modelId: string,
  ): Promise<{ ok: boolean; error?: string; spec?: string; model?: Model<Api> }> {
    await this.ensureRuntime();
    if (!configuredModelSpecs(this.config()).has(`${providerId}/${modelId}`)) {
      return { ok: false, error: 'Core models.json 中未声明该模型' };
    }
    const model = this.runtime.getModel(providerId, modelId);
    if (!model) return { ok: false, error: '未找到该模型' };
    try {
      const auth = await (this.runtime as Models).getAuth(model);
      if (!auth) return { ok: false, error: `${providerId} 尚未配置凭据` };
    } catch (cause: any) {
      return { ok: false, error: cause?.message || String(cause) };
    }
    const spec = `${providerId}/${modelId}`;
    this.saveSelection(spec);
    return { ok: true, spec, model };
  }

  private async probeModel(
    models: Models,
    model: Model<Api>,
    apiKey: string | undefined,
    benchmark: { inputTarget: number; outputTarget: number } | undefined,
    prompt: string | undefined,
  ): Promise<ModelTestResult> {
    const workload = benchmark
      ? `The following filler is part of a latency benchmark. Reply with exactly ${benchmark.outputTarget} tokens of the word "ok", separated by spaces.\n\n${'x '.repeat(benchmark.inputTarget)}`
      : (prompt || '');
    const context = { messages: [{ role: 'user' as const, content: workload, timestamp: Date.now() }] };
    const startedAt = Date.now();
    let firstTokenAt = 0;
    let reply = '';

    try {
      const stream = models.streamSimple(model, context, {
        ...(apiKey ? { apiKey } : {}),
        ...(!benchmark ? { reasoning: 'medium' } : {}),
        maxTokens: benchmark?.outputTarget || 512,
        maxRetries: 0,
      });
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.delta) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          reply += event.delta;
        }
      }
      const result = await stream.result();
      const finishedAt = Date.now();
      if (result.stopReason === 'error' || result.errorMessage) {
        return { ok: false, error: result.errorMessage || '模型返回错误' };
      }
      const inputTokens = result.usage.input > 0 ? result.usage.input : undefined;
      const outputTokens = result.usage.output > 0 ? result.usage.output : undefined;
      const ttft = (firstTokenAt || finishedAt) - startedAt;
      const tpot = outputTokens && outputTokens > 1 && firstTokenAt
        ? (finishedAt - firstTokenAt) / (outputTokens - 1)
        : undefined;
      const content = reply.trim()
        || result.content.map(block => block.type === 'text' ? block.text : '').join('').trim();
      return {
        ok: true,
        latencyMs: finishedAt - startedAt,
        ttft,
        tpot,
        reply: content || '(空回复)',
        inputTokens,
        outputTokens,
      };
    } catch (cause: any) {
      return { ok: false, error: cause?.message || String(cause) };
    }
  }

  async testCustomModel(entry: CustomModelEntry, prompt: string): Promise<ModelTestResult> {
    const error = validateEntry(entry, true);
    if (error) return { ok: false, error };
    if (!prompt.trim()) return { ok: false, error: '请输入测试 Prompt' };
    await this.ensureRuntime();

    const transientId = `preview-${slugify(entry.label)}-${Math.random().toString(36).slice(2, 8)}`;
    const transient = { ...entry, id: transientId };
    try {
      this.runtime.registerProvider(transientId, providerConfigOf(transient));
      const model = this.runtime.getModel(transientId, entry.modelId);
      if (!model) return { ok: false, error: '模型未能注册（检查格式 / 模型 ID）' };
      return await this.probeModel(this.runtime, model, entry.apiKey, undefined, prompt.trim());
    } finally {
      this.runtime.unregisterProvider(transientId);
    }
  }

  async testModel(
    providerId: string,
    modelId: string,
    benchmark = false,
    prompt = '',
  ): Promise<ModelTestResult> {
    await this.ensureRuntime();
    if (!configuredModelSpecs(this.config()).has(`${providerId}/${modelId}`)) {
      return { ok: false, error: 'Core models.json 中未声明该模型' };
    }
    const model = this.runtime.getModel(providerId, modelId);
    if (!model) return { ok: false, error: '模型当前不可用，请检查 Core 模型配置' };
    try {
      const auth = await this.runtime.getAuth(model);
      if (!auth) return { ok: false, error: `${providerId} 尚未配置凭据` };
    } catch (cause: any) {
      return { ok: false, error: cause?.message || String(cause) };
    }

    if (!benchmark) {
      if (!prompt.trim()) return { ok: false, error: '请输入测试 Prompt' };
      return this.probeModel(this.runtime, model, undefined, undefined, prompt.trim());
    }

    const benchmarks = [];
    for (const profile of MODEL_BENCHMARKS) {
      const samples: ModelTestResult[] = [];
      for (let run = 0; run < 3; run++) {
        const sample = await this.probeModel(this.runtime, model, undefined, profile, undefined);
        samples.push(sample);
        if (!sample.ok) break;
      }
      const failed = samples.find(sample => !sample.ok);
      const completed = samples.filter(sample => sample.ok);
      const average = (field: 'ttft' | 'tpot' | 'inputTokens' | 'outputTokens') => {
        const values = completed.map(sample => sample[field]).filter((value): value is number => typeof value === 'number');
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
      };
      benchmarks.push({
        ok: !failed,
        ...profile,
        runs: samples.length,
        ttft: average('ttft'),
        tpot: average('tpot'),
        inputTokens: average('inputTokens') && Math.round(average('inputTokens')!),
        outputTokens: average('outputTokens') && Math.round(average('outputTokens')!),
        error: failed?.error,
      });
      if (failed) break;
    }
    const failed = benchmarks.find(result => !result.ok);
    return failed
      ? { ok: false, error: failed.error || '基准测试失败', benchmarks }
      : { ok: true, reply: 'Benchmark 完成', benchmarks };
  }
}
