// Browser application facade only. Provider parsing, validation, credentials,
// persistence and SDK calls are all owned by Core.

import { agentClient } from '../../core/agent';
import type { CustomModelEntry, UpdateModelEntry } from '../../core/agent/protocol';

export const modelService = {
  listModels: () => agentClient.listModels(),
  getConfigFile: () => agentClient.getModelConfigFile(),
  saveConfigFile: (content: string) => agentClient.saveModelConfigFile(content),
  parseConfigFile: (content: string) => agentClient.parseModelConfigFile(content),
  testCustom: (entry: CustomModelEntry, prompt: string) => agentClient.testCustomModel(entry, prompt),
  test: (providerId: string, modelId: string, benchmark = false, prompt = '') =>
    agentClient.testModel(providerId, modelId, benchmark, prompt),
  addCustom: (entry: CustomModelEntry) => agentClient.addCustomModel(entry),
  update: (providerId: string, modelId: string, update: UpdateModelEntry) =>
    agentClient.updateModel(providerId, modelId, update),
  removeCustom: (id: string) => agentClient.removeCustomModel(id),
  setActive: (sessionId: string, providerId: string, modelId: string) => agentClient.setActiveModel(sessionId, providerId, modelId),
  setCwd: (path: string) => agentClient.setCwd(path),
  refreshHealth: () => agentClient.refreshHealth(),
};
