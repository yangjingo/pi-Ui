import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { ContextHarness } from '../../harness/context';

/** Thin Pi adapter. Cache policy and hashing stay in ContextHarness; only this Core/Pi file
 * knows about Pi's before_agent_start extension contract. */
export function createContextExtension(contextHarness: ContextHarness): InlineExtension {
  return {
    name: 'context-harness',
    factory(pi) {
      pi.on('before_agent_start', event => ({
        systemPrompt: contextHarness.stabilizeSystemPrompt(event.systemPrompt),
      }));
    },
  };
}
