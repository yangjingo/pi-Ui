import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { WorkspaceAccessPolicy } from '../../harness/file/runtime';

/** Pi adapter for the File Harness policy. It constrains built-in and custom shell tools
 * without pretending to be a hostile-process or operating-system sandbox. */
export function createWorkspaceAccessExtension(policy: WorkspaceAccessPolicy): InlineExtension {
  return {
    name: 'workspace-access-harness',
    factory(pi) {
      pi.on('tool_call', event => {
        const decision = policy.guardTool(event.toolName, event.input);
        if (!decision.ok) return { block: true, reason: decision.reason || '工作区访问被拒绝' };
        if (decision.input) Object.assign(event.input, decision.input);
        return undefined;
      });
    },
  };
}
