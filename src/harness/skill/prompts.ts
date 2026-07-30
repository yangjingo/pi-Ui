/** Prompt constants for the Skill harness. These are template strings injected into the
 *  user prompt when a Skill is activated, and the SKILL.md scaffold used when generating a
 *  Skill from a completed Agent turn. */

/** Injected before every activated Skill body to enforce session–Skill isolation.
 *  Uses XML tags for structured model attention; negative constraints are stated
 *  explicitly as prohibitions rather than passive descriptions. */
export const SKILL_ISOLATION_PROMPT = `<skill_isolation_rules>
- Skill 目录及其全部文件为只读参考材料。严禁对 Skill 目录执行任何 write / edit / bash 写入操作。
- "."（当前工作目录）始终为当前 session 的独立工作区，与 Skill 目录完全隔离，互不可见。
- SKILL.md 中出现的所有相对路径（如 "./output/"、"config.yml"）均相对于 session 工作区解析，而非 Skill 目录。
- 所有中间产物与最终输出必须写入 session 工作区。若 SKILL.md 指明了输出路径，将其解析为 session 工作区下的子路径。
</skill_isolation_rules>`;

/** Wraps the Skill body and isolation block in an activated-skill XML tag. */
export const SKILL_ACTIVATION_TEMPLATE = `<activated_skill name="{{name}}">
<skill_isolation>
${SKILL_ISOLATION_PROMPT}
</skill_isolation>

{{body}}{{references}}
</activated_skill>`;

/** Prefix for the supporting-file list shown inside the activated Skill block. */
export const SKILL_REFERENCES_PREFIX = '参考文件（只读，不可修改）：';

/** Default task label when the user prompt is empty. */
export const SKILL_CREATE_DEFAULT_TASK = '将当前 Agent 工作流沉淀为可复用 Skill';

/** Fallback name for a Skill generated from a turn. */
export const SKILL_CREATE_FALLBACK_NAME = '复用的工作流';

/** Default description for a Skill generated from a turn. */
export const SKILL_CREATE_DEFAULT_DESC = '由一轮 Agent 对话自动生成的本地工作流，封装了该轮次的执行策略与关键步骤';

/** SKILL.md scaffold used by createFromTurn(). */
export const SKILL_CREATE_MD_TEMPLATE = `---
name: {{name}}
description: {{desc}}
---

# 适用场景

{{task}}

# 执行方式

1. 确认用户的目标、约束与当前工作区已有产物。
2. 参考 references/ 中的来源轨迹，按需复用有效的工具链与检查步骤。
3. 所有产物写入当前 session 工作区（"."），禁止写入 Skill 自身目录。
4. 交付前明确说明完成内容、验证结果与仍需用户决策的事项。

# 来源材料

本 Skill 由一轮已完成的 Agent 对话生成。需要具体结论、措辞或操作细节时，读取以下只读参考文件：

- \`references/source-turn.md\`：用户原始请求与 Agent 最终答复
- \`references/trajectory.md\`：本轮完整执行轨迹`;
