import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SkillEnvironment, SkillHarness } from '../../harness/skill';

export interface SkillEnvironmentContext {
  isActive(skillId: string): boolean;
  onEnvironment(environment: SkillEnvironment): void;
}

function result(environment: SkillEnvironment) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        skillId: environment.skillId,
        path: environment.path,
        digest: environment.digest,
        ready: environment.ready,
        fingerprintSources: environment.sources,
      }),
    }],
    details: { environment },
  };
}

/** Exposes the persistent, fingerprinted environment owned by Skill Harness. Dependency
 * installation still happens through ordinary session tools; the SDK tool only locates and
 * marks a successfully prepared environment for later turns. */
export function createSkillEnvironmentExtension(
  harness: SkillHarness,
  context: SkillEnvironmentContext,
): InlineExtension {
  return {
    name: 'skill-environment-harness',
    factory(pi) {
      pi.registerTool({
        name: 'skill_environment',
        label: 'Skill 环境',
        description: 'Get or mark the reusable workspace environment for the currently activated Skill. Never mark ready until dependency setup has completed successfully.',
        parameters: Type.Object({
          action: Type.Union([Type.Literal('status'), Type.Literal('mark_ready')]),
          skill_id: Type.String({ minLength: 1 }),
          digest: Type.Optional(Type.String({ minLength: 1 })),
        }),
        execute: async (_toolCallId, params: any) => {
          if (!context.isActive(params.skill_id)) throw new Error('只能访问本轮显式激活的 Skill 环境');
          const environment = params.action === 'mark_ready'
            ? harness.markEnvironmentReady(params.skill_id, String(params.digest || ''))
            : harness.environment(params.skill_id);
          context.onEnvironment(environment);
          return result(environment);
        },
      });
    },
  };
}
