// Browser application facade only. Provider parsing, validation, credentials,
// persistence and SDK calls are all owned by Core.

import { agentClient } from '../../core/agent';
import type { CustomModelEntry, ModelOption, UpdateModelEntry } from '../../core/agent/protocol';

const MODEL_LIST_TTL_MS = 30_000;
let modelListCache: ModelOption[] | null = null;
let modelListLoadedAt = 0;
let modelListRequest: Promise<ModelOption[]> | null = null;

function invalidateModelList() {
  modelListCache = null;
  modelListLoadedAt = 0;
}

async function listModels(force = false): Promise<ModelOption[]> {
  const fresh = modelListCache && Date.now() - modelListLoadedAt < MODEL_LIST_TTL_MS;
  if (!force && fresh) return modelListCache!;
  if (modelListRequest) return modelListRequest;
  modelListRequest = agentClient.listModels().then(models => {
    modelListCache = models;
    modelListLoadedAt = Date.now();
    return models;
  }).finally(() => { modelListRequest = null; });
  return modelListRequest;
}

async function invalidateAfter<T>(request: Promise<T>, changed: (result: T) => boolean = () => true): Promise<T> {
  const result = await request;
  if (changed(result)) invalidateModelList();
  return result;
}

export const modelService = {
  listModels,
  prefetchModels: () => listModels(),
  getConfigFile: () => agentClient.getModelConfigFile(),
  saveConfigFile: (content: string) => invalidateAfter(agentClient.saveModelConfigFile(content), result => result.ok),
  parseConfigFile: (content: string) => agentClient.parseModelConfigFile(content),
  testCustom: (entry: CustomModelEntry, prompt: string) => agentClient.testCustomModel(entry, prompt),
  test: (providerId: string, modelId: string, benchmark = false, prompt = '') =>
    agentClient.testModel(providerId, modelId, benchmark, prompt),
  addCustom: (entry: CustomModelEntry) => invalidateAfter(agentClient.addCustomModel(entry), result => result.ok),
  update: (providerId: string, modelId: string, update: UpdateModelEntry) =>
    invalidateAfter(agentClient.updateModel(providerId, modelId, update), result => result.ok),
  removeCustom: (id: string) => invalidateAfter(agentClient.removeCustomModel(id), result => result.ok),
  setActive: (sessionId: string, providerId: string, modelId: string) => invalidateAfter(agentClient.setActiveModel(sessionId, providerId, modelId), result => result.ok),
  setCwd: (path: string) => invalidateAfter(agentClient.setCwd(path), result => result.ok),
  refreshHealth: () => agentClient.refreshHealth(),
};
