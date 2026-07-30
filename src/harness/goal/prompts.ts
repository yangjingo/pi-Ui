/** Prompt and label constants for the Goal harness. */

/** Operation labels shown in the trajectory when a Goal tool runs. */
export const GOAL_LABEL_CURRENT = '当前 Goal';
export const GOAL_LABEL_CREATED = '已创建 Goal';
export const GOAL_LABEL_UPDATED = '已更新 Goal';

/** Tracked / not-tracked labels for the trajectory. */
export const GOAL_LABEL_NO_GOAL = '当前未设置 Goal';

/* ── Budget-exhaustion report ─────────────────────────────────────────── */

export const GOAL_REPORT_TITLE = '# Goal 预算终止报告';
export const GOAL_REPORT_INTRO = '> Token 预算已用尽。此 Goal 保持 `budgetLimited`，没有被错误标记为完成。';
export const GOAL_REPORT_SECTION_EXECUTION = '## 执行结论';
export const GOAL_REPORT_EXECUTION_HINT = '**预算耗尽 · 目标尚未完成**';
export const GOAL_REPORT_SECTION_GOAL = '## Goal';
export const GOAL_REPORT_SECTION_TIMELINE = '## 时间线';
export const GOAL_REPORT_SECTION_CAUSE = '## 终止原因';
export const GOAL_REPORT_CAUSE_HARNESS = 'Harness 已停止自动 continuation；现有结果只能视为阶段性进度，不能视为完成证据。';
export const GOAL_REPORT_SECTION_NEXT = '## 后续建议';
export const GOAL_REPORT_NEXT_STEPS = [
  '- 检查当前工作区产物与最后一轮 Agent 轨迹，确认哪些要求仍未满足。',
  '- 如需继续，使用 `/goal <objective>` 明确替换当前 Goal；默认不设置预算。',
  '- 仅在所有要求都有实际证据后，才允许通过 `update_goal` 标记完成。',
];
