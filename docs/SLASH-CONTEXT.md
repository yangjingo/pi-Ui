# Slash command context

长程目标由输入框内的目标按钮创建、查看和管理。按钮会将目标命令写入正常发送流程；它不出现在
slash 建议列表中。Goal state is stored by the Pi `pi-codex-goal` extension, not in browser state.

Goal 有两层 Harness 协作：

- 本地 `harness/goal` 是 Core adapter，识别 `/goal`、装配 `pi-codex-goal` 扩展及三个
  Goal tools，并把 Pi session custom entries 投影成 browser-safe 状态。它要求所有
  `/goal` turn 在提交给 Pi 前请求 SDK 的最高 `max` Thinking；恢复仍为 `active` 的 Goal
  时也会在创建 session 前恢复该级别，因此隐藏续跑不会退回较低 Thinking 模式。SDK
  会按当前模型能力将 `max` 收敛到该模型实际支持的最高档。Pi-UI 默认不为 Goal 设置
  Token 预算：`/goal <objective>` 原生创建无预算 Goal，`create_goal` 省略可选的
  `token_budget` 时也会由 SDK 写入 `null`。只有调用方明确传入正整数时才启用预算。
- `pi-codex-goal` 是执行与持久化 Harness。它把目标、状态和 usage 写入 session branch，
  在 Agent idle 且 Goal 仍为 `active` 时排入隐藏 continuation；在 abort、provider error、
  context overflow 和显式 token budget 等边界上暂停、恢复或限流。

“完成”不是由 UI 或一条自然语言答复判定。模型必须在 completion audit 中把目标的每项要求
映射到文件、命令、测试或其他实际证据，之后显式调用 `update_goal({ status: "complete" })`。
只有这个状态转换会终止自动 continuation；不确定、仅部分完成、Token 消耗增加或停止工作都不能
标记完成。它提供的是可恢复的执行闭环和严格终止协议，而不是对外部系统结果的数学保证。

当调用方显式创建了带预算的 Goal，或恢复了旧版本中的带预算会话，并首次进入
`budgetLimited` 时，本地 Goal Harness 会生成一次
`goal-budget-report-<goalId>.md`。报告包含 Token 消耗与预算、使用率、完成的 Agent Loop
轮数、活跃执行时间、墙钟跨度、每轮平均消耗、模型、时间线、原始 Goal 和继续执行建议。
Loop 指标和“报告已生成”标记同样写入 Pi session branch，因此恢复、分支和重启不会把计数
退回零或为同一 Goal 重复生成报告。Core 将报告写入当前 session workspace，浏览器收到
`goal_report` 后在没有未保存 Canvas 编辑时自动打开；否则只加入 Canvas tab，避免覆盖编辑。
Pi-UI 的默认创建路径不会进入 `budgetLimited`，但显式预算和历史会话仍保持完整兼容。

Local Skills appear in the composer's slash list. A user-created Skill is stored under the current
workspace's `skills/<id>/` directory with `SKILL.md` as its entry file. When the user
explicitly writes or selects `/name`, Core's `SkillHarness` expands that local instruction right
before Pi receives the prompt; the transcript retains the compact slash command.

There is deliberately no remote Skill installation endpoint or UI. Skill Hub manages local
workspace Skills only.

For a completed Agent reply, the conversation action “生成 Skill” sends only that turn index to
Core. `SkillHarness` projects the associated user request, final response, and trajectory into a
local Skill package. The generated source material remains visible and editable under the Skill's
Files tab before it is reused.

`@path` remains independent of slash commands. Before sending a message, the workspace expands a
referenced workspace file into the model input while retaining the compact reference in the
conversation transcript.

The browser calls only `/api/*`. The Node runtime owns Pi sessions and the goal extension; no Pi
package is bundled into the browser.
