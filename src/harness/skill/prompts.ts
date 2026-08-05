/** Session draft scaffold. Final naming and Skill Hub metadata happen only after validation. */
export const SKILL_DRAFT_MD_TEMPLATE = `---
name: {{id}}
description: {{desc}}
---

# Objective

{{task}}

# Reusable workflow

{{tools}}
{{scripts}}

# Validate before publishing

- 在当前 Session 中通过 @ 引用本文件，执行一次有代表性的真实任务。
- 根据验证结果直接修改本草稿及其 scripts；不要把原始 Tool 输出写进 Skill。
- 验证通过前不要贡献到 Skill Hub，也不要确定最终名称。`;
