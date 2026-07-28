// Browser-owned Pi inheritance workflow. Core exposes only safe inspection and
// execution primitives; Workspace decides whether and when to apply them.

import {
  agentClient,
  type AgentClient,
  type PiInheritancePreview,
  type RuntimeBootstrapResult,
} from '../../core/agent';

export type PiInheritanceGateway = Pick<
  AgentClient,
  'inspectPiInheritance' | 'bootstrapRuntime'
>;

export function createPiInheritanceService(gateway: PiInheritanceGateway) {
  let bootstrapPromise: Promise<RuntimeBootstrapResult> | null = null;
  return {
    inspect(): Promise<PiInheritancePreview> {
      return gateway.inspectPiInheritance();
    },
    bootstrap(): Promise<RuntimeBootstrapResult> {
      if (bootstrapPromise) return bootstrapPromise;
      bootstrapPromise = gateway.inspectPiInheritance()
        .then(preview => gateway.bootstrapRuntime(preview.available))
        .finally(() => {
          bootstrapPromise = null;
        });
      return bootstrapPromise;
    },
  };
}

export const piInheritanceService = createPiInheritanceService(agentClient);
