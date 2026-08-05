import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { SharedSkill, SkillHarness } from '../../harness/skill';

export interface SkillPackageContext {
  sessionRoot(): string;
  onInstalled(skill: SharedSkill): void;
}

/** Controlled bridge for explicit natural-language installs. Network and archive handling happen
 * in the writable Session; this tool alone commits a validated package to the read-only Skill Hub. */
export function createSkillPackageExtension(
  harness: SkillHarness,
  context: SkillPackageContext,
): InlineExtension {
  return {
    name: 'skill-package-harness',
    factory(pi) {
      pi.registerTool({
        name: 'skill_package',
        label: '安装 Skill',
        description: 'Install a Skill the user explicitly requested from a staged Session directory. For a URL, download or clone it under the current Session first. For an uploaded ZIP, extract it under the current Session first. Pass the exact directory that directly contains SKILL.md. Never replace an existing Skill unless the user explicitly requested replacement.',
        parameters: Type.Object({
          source_directory: Type.String({ minLength: 1 }),
          replace: Type.Optional(Type.Boolean()),
        }),
        execute: async (_toolCallId, params: any) => {
          const result = harness.installFromDirectory({
            sessionRoot: context.sessionRoot(),
            sourceDirectory: String(params.source_directory || ''),
            replace: params.replace === true,
          });
          if (!result.ok || !result.skill) throw new Error(result.error || 'Skill 安装失败');
          context.onInstalled(result.skill);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                installed: true,
                id: result.skill.id,
                name: result.skill.name,
                command: `/${result.skill.name}`,
                skillHubPath: result.skill.rootPath,
              }),
            }],
            details: { skill: result.skill },
          };
        },
      });
    },
  };
}
