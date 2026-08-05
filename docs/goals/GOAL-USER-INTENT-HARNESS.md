# Goal / Context Harness：Agent 触发、UserIntent 确认与稳定上下文

## 实现状态（2026-08-04 审计）

状态：确定性 Harness、确认门、Contract UI 与完成审计已实现。真实 Provider 下的自然语言
分类质量尚未形成可重复自动化证据；它属于模型行为验证，不改写为“代码未完成”。早期设计的
Canvas 结构化问卷已裁撤，澄清统一回到 Conversation + Composer，避免维护第二套答题协议。

## 合并后的单一合同与冲突裁决

本文件同时是 Goal、UserIntent 与其 Context 装配规则的唯一产品、设计和验收合同。
运行时稳定 Prompt 的唯一代码来源是 `src/harness/context/prompts.ts`；Intent 状态机、确认门
和完成审计的代码来源是 `src/harness/goal`。原 `CONTEXT-HARNESS.md` 的独立 Goal 已合并
到本文件，不再维护第二份授权链。

Skill 渐进披露、Workspace 级依赖环境和 Pi Tool 文件路径门禁不属于 Intent 状态机；其唯一
合同是 [GOAL-SKILL-FILE-HARNESS.md](./GOAL-SKILL-FILE-HARNESS.md)。本文件只保留固定工具集、
稳定 Context Prefix 和动态 Skill 状态进入追加区的交界规则。

合并时采用以下裁决：

- `/goal` 只是显式 Goal Intent 入口，不能直接创建 active Goal；旧文档中“目标命令进入
  正常发送流程”不得解释为绕过 Contract 确认。
- Session 创建时固定注册 Coding、Intent 与 Goal 工具。旧文档中的“三个 Goal tools”只
  描述早期 adapter，不再作为当前工具数量合同；运行中不得随任务增删工具定义。
- Prompt 负责稳定、跨任务的选择策略；澄清轮数、revision/hash、替换授权和完成审计由
  代码确定性强制，不能只靠 Prompt 约束。
- Context Harness 可以要求 Windows 原生任务优先选择 PowerShell，但子进程、UTF-8、历史
  输出迁移和 Canvas 渲染分别归 `core/pi` 与 `canvas`，不属于 Prompt 的执行能力。
- Provider cache 指标只来自 Pi SDK response metadata；前缀稳定仅证明应用未改变
  System/Tools，不承诺 Provider 一定命中缓存。
- 旧 Context 文案中的“Skill 与 Session 互不可见”和“所有 Skill 相对路径都相对 Session”
  已废止：只读引用相对 Pi SDK 披露的 Skill root，任务输出相对当前 Session；完整裁决见
  [Skill/File Harness Goal](./GOAL-SKILL-FILE-HARNESS.md#冲突裁决)。

> 2026-08-01 最新产品决策覆盖早期“移除 Goal 按钮”的约束：目标入口恢复到 Composer `File` 按钮右侧；中文显示“目标”，英文显示 “Goal”，仍只发起受 Contract 确认保护的 Intent。

- Composer 的 Goal 按钮已恢复到 `File` 按钮右侧，用于显式写入或撤销 `/goal ` 草稿；简单消息仍直接进入普通 Agent Turn。
- `propose_goal_contract`、`request_intent_clarification` 和
  `submit_goal_completion_audit` 与现有 Goal Tools 在 Session 创建时固定注册。
- Intent Draft、revision/hash、最多三轮澄清、取消、active Goal 冲突和显式替换均由
  `harness/goal` 的 append-only custom entries 持久化。
- Conversation 上方提供精简 Contract 卡：确认、修改、取消、替换提示和错误状态；桌面缩放
  与可变高度由现有布局处理，不承诺手机或窄屏交互。
- 确认 API 绑定 `intentId + revision + contractHash`；Core 先持久化确认，再发起创建
  Goal 的 Agent Turn。`create_goal` 的工具拦截器拒绝未确认、objective 不一致或未授权
  replacement 的调用。
- 确认 Contract 确定性投影为完整编号 Goal objective；创建后自动关联
  `linkedGoalId`。
- `submit_goal_completion_audit` 持久化 D/AC/C/N/V 的证据映射；
  `update_goal(status=complete)` 在 Pi `tool_call` 阶段被硬拦截，缺项、重复、未验证或
  无证据均不能进入 complete。

已加入 Harness、Core、Workspace 与 E2E 回归；历史验证快照记录在本文件末尾，当前统一基线
见 [Goals 审计索引](./README.md)。

### 已决策与后续 fix（2026-07-31）

1. **分类取向**：漏触发复杂任务预检的代价高于误触发。当前仍采用“稳定 Prompt policy + Agent 判断”，暂不增加确定性分类层；Agent 在简单任务与复杂任务之间不确定、且存在高复杂度信号时，应偏向进入预检。Harness 启发式分类器继续只作为可测试 policy 基线。
2. **澄清入口（2026-08-04 裁决）**：不增加 Canvas 结构化问卷。问题在 Contract 卡展示，
   用户通过 Composer 回答；`修改` 同样回到对话。
3. **完成证据**：暂不要求 evidence ref 绑定不可变 Tool Call ID。现有结构审计已经强制覆盖全部 D/AC/C/N/V、verified 状态和非空证据引用，当前复杂度足够。进一步绑定会同时增加 Tool 结果持久化、compaction/recovery 映射、外部证据建模和协议兼容成本，收益暂不足以覆盖这些复杂度。
4. **历史 Goal**：不迁移没有 Contract Hash 的历史 Session/Goal，允许用户永久删除它们。Core 删除 API 已实现活动运行保护、直属目录与 realpath 边界校验，并物理删除本应用拥有的 Session 目录；继承 Pi Session 时只删除应用内 fork，不触碰外部 `sourcePath/sourceCwd`。Workspace 使用明确的永久删除二次确认并在成功后清理浏览器 Session 状态。

## Product contract

让 Goal 能力在每个 Agent Session 中默认可用，同时允许用户通过 Composer 中紧邻 `File` 的 Goal 按钮显式发起；简单任务仍不进入长程执行。Agent 也可以为复杂任务主动进入 UserIntent 预检，在最多三轮内形成可确认的 Goal Contract；只有用户确认后才创建 active Goal，并继续使用可恢复执行、自动 continuation 和证据化完成审计。

完成时必须同时满足：

- Composer 的 Goal 按钮紧邻 `File` 按钮；只负责形成 `/goal ` 草稿，不直接创建 Goal。
- Goal Tools 在 Session 创建时固定注册，保持默认可用。
- 简单任务不创建 Goal，也不显示 Goal Contract。
- 复杂任务由 Agent 主动触发 UserIntent 预检。
- 澄清最多三轮；信息已足够时可以零轮或一轮完成。
- 用户确认 Goal Contract 前不得创建 active Goal。
- Goal active 后继续使用 durable state、后台 continuation、最高可用 Thinking 和完成审计。
- 完成状态只有证据覆盖全部 Goal 要求后才能写入。

## 核心语义

“Goal 默认”指：

- Goal 能力和工具默认存在。
- Agent 有权为符合条件的复杂任务提议 Goal。
- 用户可以从 Composer 显式发起 Goal Intent。

“Goal 默认”不指：

- 每条消息自动创建 Goal。
- 每个简单任务都要求确认卡。
- 用户不知情时在后台开启无限 continuation。

## 任务分类

### 不触发 Goal 的简单任务

包括但不限于：

- 普通知识问答。
- 解释一段代码或一个错误。
- 翻译、改写和摘要。
- 只读查看文件或状态。
- 单一、低风险、可在一个普通 Turn 内完成的小修改。
- 用户只要求分析或诊断，没有授权实施。

这些任务直接执行，不展示 Goal UI，不调用 `create_goal`。

### 必须进入预检的复杂任务

Agent 一旦把任务判断为复杂任务，就必须进入 UserIntent 预检；不能直接创建 Goal 或绕过 Contract 确认。复杂度判断仍由模型依据以下高信号完成：

- 有多个相互依赖的执行阶段。
- 要求多个文件、多个页面或多种交付物。
- 要求实现、测试、构建、截图、部署等多种证据。
- 明确使用“完整、全部、持续、直到完成、不要停”等长程语义。
- 预计需要多个 Agent Loop 或隐藏 continuation。
- 需要等待、监控或跨时间恢复。
- 错误完成会造成明显返工、外部影响或难以恢复的变化。
- 需求存在会改变交付结果的关键歧义。

单一关键词不能成为唯一判定依据。Agent 必须结合任务结构、权限和交付复杂度判断。

用户用自然语言明确要求“建立/跟踪为目标”时，视为强复杂信号，即使操作本身较小也进入预检和 Contract 确认；它可以覆盖默认的简单任务分类，但不能跳过确认门。

## 状态模型

UserIntent 与 active Goal 是两个阶段，不能复用一个状态字段：

```text
none
  ├→ direct_task
  └→ clarifying
       ├→ blocked
       └→ awaiting_confirmation
            ├→ dismissed
            ├→ clarifying（用户要求修改）
            └→ confirmed
                 → active Goal（由 LongRunningGoal 表示）
```

active Goal 之后的 `active / paused / budgetLimited / complete` 与 completion audit 继续由 `LongRunningGoal` 和现有 Goal Runtime 表示，不属于 `IntentDraft.status`。

建议新增 durable `IntentDraft`：

```ts
interface IntentDraft {
  intentId: string;
  sessionId: string;
  sourceTurnId: string;
  status:
    | 'clarifying'
    | 'awaitingConfirmation'
    | 'confirmed'
    | 'dismissed'
    | 'blocked';
  clarificationRound: number;
  objective: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  constraints: string[];
  nonGoals: string[];
  verificationPlan: string[];
  assumptions: string[];
  openQuestions: IntentQuestion[];
  revision: number;
  contractHash?: string;
  linkedGoalId?: string;
  createdAt: number;
  updatedAt: number;
}
```

`LongRunningGoal` 继续表示执行状态，不承载未确认的草稿。`assessing` 和 `direct_task` 都是
模型/分类过程中的瞬时结果，不是 durable `IntentDraft.status`；只有需要澄清或确认时才创建
草稿。源码类型中仍存在的 `assessing` 与 `confirmationError` 是未被运行时代码消费的遗留
字段，应在后续协议清理中删除，不应据此扩展 UI 状态机。

## 最多三轮澄清

三轮是最大值，不是必须次数：

- 信息完整：零轮澄清，直接生成 Goal Contract。
- 少量关键缺口：一轮集中提问。
- 回答引出新决策：最多继续两轮。
- 第三轮后仍有阻塞信息：展示剩余缺口和可采用的假设，等待用户明确决定；不得假装已补全。

一轮澄清定义为“一次 Agent 集中问题批次 + 紧随其后的一次用户回答”。Harness 在问题
批次持久化时立即预占并递增轮次，用户回答完成该轮；仅展示 Contract 不计轮次。用户要求
修改 Contract 也不自动计轮次，只有 Agent 再次提出新的阻塞问题时才尝试进入下一轮。
三批问题后 Agent 不得再主动提出新一批问题；当前实现通过拒绝第四次请求并转为
`blocked` 执行该上限。

统一流程是先根据已知信息和明确 assumptions 生成结构完整的 provisional Contract，
再基于其 `intentId` 进行零至三轮澄清。每轮回答生成新 revision，只有最终 revision
能够被用户确认；不新增独立的 `begin_intent` 工具或 pre-contract 状态。

blocked 后用户可以主动补充缺失信息或接受明确列出的假设。Harness 使用这份新信息重新计算 Contract；这属于用户解除阻塞，不增加第四轮 Agent 追问。如果仍不足，保持 blocked。

每轮要求：

- 优先询问会改变交付物、验收标准、权限或不可逆操作的问题。
- 合并相关问题，避免逐字段盘问。
- 不询问可以从仓库、文档或只读检查中确定的事实。
- 不重复已经回答的问题。
- 解释关键取舍时给出推荐，但不替用户决定高风险事项。
- 一轮问题数量保持克制；问题集中展示，但回答继续使用普通 Composer。

`clarificationRound` 必须由代码递增和限制，不能只在 Prompt 中要求“不要超过三轮”。

## Goal Contract

确认卡至少包含：

- 最终目标。
- 交付物及格式。
- 验收标准。
- 必须遵守的约束。
- 明确不做的内容。
- 验证计划。
- Agent 将采用的假设。
- Demo、模板或结果预览（适用时）。

交互：

- `确认并开始`：持久化确认事件，Agent 调用 `create_goal`。
- `修改`：返回对话或 Canvas 表单，生成 revision + 1。
- `取消`：Intent Draft 标记 dismissed，不创建 Goal。

复杂但信息完整的任务也必须展示精简 Goal Contract，得到确认后再开始 active Goal。这是已经锁定的确认门。

确认后的 Contract 视为当前 Goal 的不可变版本。用户改变目标时创建新的 revision，并明确替换或结束当前 Goal，禁止静默改写 active Goal objective。

### active Goal 与新任务

同一 Session 只允许一个 non-complete Goal。收到新任务时：

1. Agent 先判断它是否属于当前 Goal。
2. 属于当前 Goal：作为 steer/补充要求处理，并在必要时为当前 Contract 创建 revision；不创建第二个 Goal。
3. 与当前 Goal 无关且用户未要求替换：Intent Draft 进入 blocked，原因记为 `activeGoalConflict`，提示用户继续当前 Goal、等待其完成或明确替换。
4. 用户明确选择替换：新 Contract 必须列出将被替换的 `goalId/objective`，确认按钮文案使用“确认并替换当前目标”。
5. 用户确认后，Agent 调用 `create_goal` 并传入 `replace_existing: true`。
6. Harness 持久化 replacement custom entry，记录旧 Goal ID、新 Intent ID、Contract revision/hash、用户确认和最终新 Goal ID。

替换不新增一套 `cancelled/superseded` active 状态；现有 Goal extension 的 replacement entry 是运行时事实来源，旧 Goal 的历史仍保留在 session branch。没有明确替换确认时，系统不得设置 `replace_existing: true`。

### 确认幂等性

- 每次 Contract revision 生成 canonical serialization 和 SHA-256 `contractHash`。
- 确认请求必须携带 `intentId + revision + contractHash`。
- Core 只接受当前 awaitingConfirmation revision；旧 Tab、旧 revision 和 hash 不匹配返回 stale-contract。
- 相同确认请求重复提交返回同一确认结果，不重复创建 Goal。
- 确认事件先持久化为 session custom entry，再进入 Agent turn。
- `create_goal` 失败时 Intent 保持 confirmed，并允许从同一 Contract 幂等重试；错误通过正常
  Turn/Tool 结果呈现，不新增一套未消费的 Intent 错误字段。
- 已存在与该 Intent 关联的 active Goal 时，重试返回已有 `linkedGoalId`，不得创建第二个 Goal。
- Session 切换、断线重连和多 Tab 都从服务端确认状态恢复，不依赖单个浏览器按钮状态。

## 澄清交互

`openQuestions` 只在 Contract 卡中作为可扫描的问题列表展示。用户通过正常 Composer 回答，
回答作为普通 user turn 进入 Session；Agent 随后提出新的 Contract revision。项目不实现
schema-driven Canvas 问卷、独立 answer endpoint、表单校验或另一套持久化协议。这些能力会
重复 Conversation，且在当前 Goal 中没有独立收益，属于已裁撤的 overdesign。

## Agent 提议与用户授权

当前 `pi-codex-goal` 的 Tool guidance 要求“用户显式请求才创建 Goal”。本设计与它保持一致：

- Agent 可以主动进入 UserIntent 预检并提出 Contract。
- Agent 不能在用户确认前调用 `create_goal`。
- 绑定 revision/hash 的用户确认事件构成显式授权。
- active Goal 存在时，新任务不能静默替换它。
- 简单任务不能因为工具可用就创建 Goal。

不需要 fork `pi-codex-goal`，也不新增与上游相反的 creation policy。Intent Policy 必须明确区分“Agent 可以提议 Goal”和“只有用户可以授权创建 Goal”。

## 与现有 Goal Runtime 的关系

确认后创建 active Goal，继续复用现有能力：

- Pi session custom entries 持久化。
- `get_goal`、`create_goal`、`update_goal`。
- active Goal 恢复最高可用 Thinking。
- Agent idle 时自动 continuation。
- provider error、context overflow、budgetLimited 的恢复边界。
- 跨 continuation 的 Agent Loop、Thinking 和 Tool 调用计数。
- completion audit 和 Goal 报告。

本 Goal 不重写成熟的 continuation 和 usage accounting；新增重点是 active Goal 之前的 UserIntent 与确认门。

## Context assembly and stable prefix

Context 分为 Session 生命周期内稳定的前缀与只在尾部变化的追加区：

```text
稳定区
  Pi base system prompt
  + Context Harness 静态策略
  + 固定顺序的 Coding / Intent / Goal tool definitions
  + 相对 Workspace 语义

追加区
  历史 user / assistant / toolResult
  + 当前显式激活的 SKILL.md
  + Intent Draft / 澄清回答
  + Goal Contract 确认
  + 当前 user request
```

稳定 Prompt 只有四个区块：

```text
<context_harness>...</context_harness>
<intent_policy>...</intent_policy>
<workspace_policy>...</workspace_policy>
<completion_policy>...</completion_policy>
```

必须满足：

- `CONTEXT_PROMPT_VERSION` 参与静态指纹；Tool 数组保持明确的语义顺序，Schema 对象 key
  才做 canonical sort。
- Session ID、绝对路径、时间、模型名、当前 Goal、Intent revision 与 UI 状态不得进入
  稳定 Prompt，也不得动态增删 Tool。
- Pi 物理 CWD 在 Prompt 中归一为相对 Workspace 语义；工具仍在真实 Session CWD 执行。
- Skill 指令、Intent 回答和 Goal 状态只进入 append-only 动态上下文。
- Provider cache breakpoint 由 Pi SDK capability 处理，本项目不手写私有
  `cache_control`。
- 新增 Prompt 规则前必须先说明为什么不能由代码、Schema、状态机或测试确定性执行。

## Shell、历史输出与可观测性

Agent 的 Shell 选择规则只存在于稳定 `<workspace_policy>`：Windows 文件、进程、服务和
普通项目命令优先使用原生 PowerShell；只有明确依赖 POSIX quoting、pipeline、GNU 工具
或 Bash 语法时才使用 Bash。`powershell` 与 `bash` 的名称必须反映真实语义，并在 Session
创建时固定注册。Agent 不应通过 Bash/WSL 再启动 Windows PowerShell。

执行与展示按所有权分离：

- `core/pi/powershell-tool.ts` 负责原生 PowerShell 的 UTF-8 输入与文本流适配。
- Pi SDK `bash` 提供实际 Bash 环境；本 Goal 不承诺各机器的 Bash 来源与能力完全一致。
- `core/pi/shell-output.ts` 负责实时/历史输出规范化、shell 分类、encoding loss 标记和旧
  Traj 回填。
- `canvas/renderers/step-result.tsx` 忠实显示命令、合并输出与不可恢复的损失提示。

历史 Session 只允许按 `toolCallId` 从匹配的 Pi JSONL 回填更丰富的 ToolResult，不按显示
顺序猜测，也不重放命令。当前 UI 投影最多保留结果尾部 4 KiB；只有源结果的可读字符分数
更高时才替换旧摘要。`U+FFFD` 可以标记为 `lossy`，普通 `?` 不能被可靠地猜回原文。
Shell 类型优先采用源 metadata，缺失时才检查命令实际调用；`where powershell` 不能误判为
PowerShell 调用。

每个完成的 Agent turn 从 Pi SDK response metadata 聚合 `input`、`output`、
`totalTokens`、`cacheRead`、`cacheWrite` 与 `cacheWrite1h`，并记录 `contextPrefix` 和
`contextPrefixStable`。`cacheHitRate` 固定为
`cacheRead / (input + cacheRead + cacheWrite)`，分母为零时为零。不得用文本长度估算 usage，
也不得把认证信息、完整 Provider 请求或真实 secret 写入 Prompt、SSE、日志或测试快照。
协议中的 `TurnStats.cacheHitRate` 仍表示单轮精确值；Conversation 的紧凑 `CACHE` 投影使用同一
公式对当前 Session 截至该回答的所有完成 Turn 做加权累计，不对各轮百分比做算术平均。

### Contract 到 Goal objective 的投影

`create_goal.objective` 不得只使用一句摘要。Harness 将确认 Contract 确定性序列化为：

```text
Objective
Deliverables (D-1...)
Acceptance Criteria (AC-1...)
Constraints (C-1...)
Non-goals (N-1...)
Verification Plan (V-1...)
Confirmed Assumptions (A-1...)
Intent ID / Revision / Contract Hash
```

完整 Contract 同时保存在 Intent custom entry。Goal objective 的编号必须与 Contract 一致，以便 completion audit 映射；序列化不包含时间戳、UI 状态或绝对路径。

## 输入栏与状态展示

提供：

- `goal-toggle` 位于 `File` 按钮右侧；点击写入 `/goal ` 并聚焦输入框。
- 尚未发送时再次点击移除 `/goal` 前缀，不清除用户已经输入的任务正文。
- 按钮的 pressed 状态表示当前草稿是 Goal，或 Session 已存在真实 Goal。
- 按钮不直接调用 Goal Tool，不绕过 Intent Contract、确认门或 replacement 授权。

继续保留：

- active Goal 的克制状态展示。
- 暂停、预算边界和错误反馈。
- Goal Tool 在 Trajectory/Canvas 中的语义化结果。

Goal 按钮是显式 Intent 入口，不是直接的运行状态开关；只有 Core 真正创建 Goal 后，Session 才进入 Goal 状态。`/goal` 不加入普通 Skill slash 建议，其语义必须继续服从 confirmation policy。

## 完成审计

Agent 调用 `update_goal({ status: "complete" })` 前必须：

1. 将 Goal Contract 中每个交付物映射到实际产物。
2. 将每条验收标准映射到文件、命令、测试、截图、日志或外部状态。
3. 检查验证方法是否真实覆盖要求，而不是把“测试通过”当成万能代理。
4. 标出缺失、未验证或采用假设的要求。
5. 存在任何未完成或不确定项时继续工作或请求决策。
6. 只有审计无缺口时调用完成工具。

UI 自然语言“看起来完成”、Token 接近预算、Agent 停止工作或部分测试通过都不能写入 complete。

为提供确定性结构门，Goal Harness 需要持久化 `GoalCompletionAudit`：

```ts
interface GoalCompletionAudit {
  goalId: string;
  contractHash: string;
  requirements: Array<{
    criterionId: string;
    status: 'verified' | 'missing' | 'unverified';
    evidence: Array<{ kind: string; ref: string }>;
  }>;
}
```

Harness 在接受 complete 转换前至少确定性检查：

- audit 绑定当前 `goalId` 与 `contractHash`。
- 每个 `D-*`、`AC-*`、`C-*`、`N-*` 和 `V-*` ID 恰好出现一次。
- 每项状态都是 verified。
- 每项至少包含一个非空 evidence reference。

其中：

- `D-*`：证明交付物存在并符合格式。
- `AC-*`：证明验收条件成立。
- `C-*`：证明强制约束被遵守。
- `N-*`：证明没有越过明确非目标；证据可以是 diff、文件清单、命令范围或审计说明。
- `V-*`：证明约定的验证步骤已实际执行并记录结果。
- `A-*` 是用户确认的前提数据，不作为独立完成要求；若执行中发现假设失效，Goal 必须暂停或回到用户决策，不能继续沿用。

代码只能保证映射完整和证据引用存在，不能保证自然语言证据在现实世界中绝对真实；真实性仍由工具结果、测试和模型审计共同承担。若现有 `pi-codex-goal` 无 completion guard 接口，应以最小上游扩展/adapter 增加结构门，不通过相反 Prompt 假装已经强制。

## 模块所有权

- `harness/goal`：Intent Draft 状态机、澄清轮次、Contract projection、Goal policy 和现有 Goal adapter。
- `harness/context`：稳定四区块 Prompt、动态 user turn 组装、工具顺序/指纹、Shell 选择策略和 usage projection。
- `core/pi`：固定工具装配、Pi extension、Session custom entries 和 continuation。
- `core/agent/protocol`：browser-safe Intent/Contract/Goal 事件与类型。
- `workspace`：按 Session 聚合 Intent 状态、提交回答和确认 action。
- `canvas`：Goal Contract、澄清问题列表和状态的可访问渲染。
- `ui`：表单、确认卡和状态 primitive。

Canvas 不得直接调用 Goal 工具；用户确认通过 Workspace/Core 进入 Harness，再由 Agent 在普通工具流程中创建 Goal。

## 验收标准

1. Composer 的 Goal 按钮紧邻 `File` 按钮；写入/撤销 `/goal ` 草稿，但不会绕过 Contract 确认创建 Goal。
2. 每个 Session 从创建开始就拥有固定 Goal/UserIntent Tool definitions。
3. 普通问答和单步小任务不会创建 Goal，也不会出现确认卡。
4. 复杂任务会生成包含交付物、验收标准、约束和验证计划的 Goal Contract。
5. 信息不足时 Agent 最多澄清三轮；信息足够时可以提前结束。
6. 第三轮后仍有缺口时状态为 blocked，不自动猜测并执行；只接受用户主动补充或确认假设来解除阻塞。
7. 用户确认前，session branch 中不存在 active Goal 创建事件。
8. 用户确认后，Goal objective 与确认的 Contract 内容一致。
9. Contract 修改产生 revision，不静默更改 active Goal。
10. active Goal 的自动 continuation、恢复、usage、最高 Thinking 和 completion audit 不退化。
11. Goal 创建授权在上游扩展、Tool guidance 和 Context Prompt 中不存在冲突：Agent 提议，用户确认，Agent 创建。
12. 多 Tab/多 Session 的 Intent Draft 和 Goal 状态互不污染。
13. 确认请求按 intent/revision/hash 幂等；旧 Tab 和重复点击不会创建第二个 Goal。
14. Goal objective 包含完整编号 Contract；完成前存在覆盖全部 D/AC/C/N/V 编号的结构化 audit。
15. active Goal 存在时，无关新任务保持 blocked；只有“确认并替换当前目标”才能触发 `replace_existing: true`，且 replacement entry 可恢复、可审计。
16. System Prompt 与固定工具集合在 Session 生命周期内保持稳定；动态 Skill、Intent 与 Goal 状态只进入追加区。
17. Windows 原生任务优先 PowerShell，明确 POSIX 任务仍使用真实 Bash；历史输出回填不重放命令且最多投影 4 KiB。
18. usage/cache 指标只来自 SDK metadata，Context Prefix 指纹不包含 Session 动态状态或凭据。

## 验证

- Harness 测试：分类 policy、三轮上限、状态转换、revision、确认门。
- Core 测试：固定工具、Session custom entries、恢复和 active Goal 创建时机。
- Workspace 测试：按 Session 投影 Intent 状态和确认 action。
- Canvas 测试：Contract、修改、确认、取消和键盘交互。
- E2E：
  - 当前覆盖 Contract 展示、修改、确认、取消，以及 Goal/Trajectory 的跨模块投影。
  - 三轮上限、active Goal 冲突/替换、幂等与 completion audit 由 Harness/Core 确定性测试覆盖，
    不再冒充已存在的真实模型 E2E。
  - 简单/复杂自然语言分类与多轮澄清仍需有可用 Provider 时执行人工或可控模型验证。
- `pnpm typecheck`
- `pnpm test:modules`
- `pnpm test:canvas`
- `pnpm test:e2e`
- `pnpm build`

## 历史验证记录（2026-07-31）

- `pnpm typecheck`：通过。
- `pnpm test:modules`：73 项通过（采用原 Context Harness 合同中的较新合并记录）。
- `pnpm test:canvas`：17 项通过。
- `pnpm test:e2e`：32 项通过。
- `pnpm build`：浏览器与 Node Core 生产构建通过；仅保留既有 Mermaid 大 chunk 提示。

2026-08-04 全仓审计的统一验证结果与证据边界见 [Goals 审计索引](./README.md)；上面的数量
是当次历史快照，不表示当前测试总数。

## 非目标

- 为每条消息创建 Goal。
- 取消用户确认门。
- 用前端按钮代替 Agent 的意图判断。
- 保证模型对所有自然语言任务分类绝对正确。
- 在本 Goal 中重写完整的 `pi-codex-goal` continuation runtime。
- 多人协作审批、组织级工作流或外部项目管理系统同步。
- 手写 Provider 私有 cache breakpoint，或承诺所有 Provider 相同的缓存 TTL 与命中率。
- 从已经损失的 `?` / `U+FFFD` 猜测原始文本，或重放历史 Tool call 重建输出。
