# UX Goal：Agent Loop 的克制交互

> 状态：已实现并完成回归验证（2026-08-04 复核）。

> 产品边界更新（2026-08-04）：Pi UI 仅支持最小宽度 1280px 的桌面环境；手机、触屏、
> coarse pointer 与窄屏响应式交互已移出范围。下文涉及这些兼容路径的旧验收项以本边界为准。

## Goal Contract

让普通对话默认保留可扫描的 Trajectory，让用户直接理解 Agent 正在做什么；只有 Session 真正设置 Goal 后，Conversation 才省略执行轨迹并只承载最终结果。原始输入/输出与诊断信息仍逐层后置；进入 Canvas 时只保留一个视觉焦点，并以短暂、低打扰的 Loop Pet 缓解长时间等待。

完成时必须同时满足：

- 普通 Session 在回答中展示可点击的 Traj 摘要，但不展开原始 Tool 输入/输出，也不显示步骤或文件数量摘要。
- Goal Session 隐藏 Traj 摘要，只显示最终回答与明确挂载的 Artifact。
- Agent 回答保留头像或产品 Logo，作为归属、提示和品牌识别锚点。
- 回答操作和运行诊断按需出现，不与正文争夺注意力。
- Canvas 打开后成为主表面，对话收缩为窄边栏。
- Shell Canvas 只保留 Shell 类型、可选耗时、命令、输出和必要的异常提示。
- 长时间运行可以随机出现数秒的 Loop Pet，但不得遮挡、打断或要求用户响应。

## 已确认的产品决策

### 1. Conversation 使用普通 / Goal 双模式

- 普通 Session 默认按照真实 `Message.blocks` 顺序展示文本与 Traj 摘要；点击摘要在 Canvas 打开该步骤或 Artifact。
- Session 的 Core Goal 状态非空后切换到精简模式：隐藏 Traj，只投影最后一段结果与 `Message.artifacts`。已完成 Goal 仍保持精简模式。
- `/goal` 只存在于 Composer 草稿时不切换视图，避免编辑过程让历史 Traj 突然消失；以 Core 的真实 Goal 状态为唯一切换依据。
- 不使用 `N steps`、`N files` 或“查看过程”作为常驻摘要。
- Agent 运行时只显示一条会被原地更新的临时状态，例如 `Reading…` 或 `PowerShell…`；新状态替换旧状态，不累积历史。
- Agent 返回结果后，临时状态立即消失。
- 回答保留 20–24px 的 Agent 头像（可以使用产品 Logo）；不显示“已完成”等可由结果本身推断的状态。
- 提示性图标只表达需要用户注意的真实状态，例如运行、警告、错误或未读，不作为装饰。
- 普通模式的 Traj 只展示标题、短摘要和状态；原始命令、完整输出与 Diagnostics 仍只在 Canvas。UI 不从用户措辞或 Tool Call 猜测 Artifact。

Composer 的 `File` 按钮右侧提供克制的 Goal 入口。两个相邻控件必须来自同一语言层：中文显示 `文件 / 目标`，英文显示 `File / Goal`。点击目标入口后写入 `/goal ` 草稿并聚焦输入框，再次点击可撤销尚未发送的前缀；它不绕过 Intent Contract、用户确认或 active Goal replacement 保护。真实 Goal 存在时按钮使用 pressed 状态。

### 2. 回答操作渐进披露

- 回答静止时不展示复制、重新生成、创建 Skill 和运行详情按钮。
- 指针 Hover 或键盘 Focus 时出现一个 `···` 入口。
- `···` 菜单包含 `Copy`、`Regenerate`、`Create Skill` 和 `Run details`。
- `Run details` 不创建弹层或第二个详情面板；它直接打开 Canvas 的 Run overview。Run overview 提供完整 Trajectory 索引与折叠的 Diagnostics；选择某个步骤后，同一 Canvas 切换为该步骤的原始输入和输出，并提供返回 Run overview 的入口。
- Hover 行为必须提供等价的键盘 Focus 入口。

### 3. 紧凑运行指标

回答获得 Hover 或 Focus 时，在底部显示一行弱化的核心指标：

```text
TTFT 1.2s · TPOT 24ms · TPS 41.7 · IN 18k · OUT 2.4k · CACHE 40%
```

- 六项核心指标为 `TTFT`、`TPOT`、`TPS`、`IN`、`OUT`、`CACHE`。
- `TPS` 保留一位小数。
- Token 数使用 `k` / `m` 简写；`CACHE` 不显示单轮 token 数，而显示当前 Session 截至该回答
  的累计命中比例：`ΣcacheRead / Σ(input + cacheRead + cacheWrite)`。
- 累计比例按 token 加权，不对各轮百分比做算术平均；历史回答显示截至自身的累计值。
- `TTFT` 与 `TPOT` 根据数值使用 `ms` / `s`。
- 缺失指标直接省略，不显示占位符。
- 精确值、总耗时和指标解释只在 `Run details` 的 Diagnostics 中展示。

### 4. Canvas 聚焦模式

- 打开 Canvas 后，对话收缩为约 44px 的窄边栏，Canvas 成为唯一内容焦点。
- 窄边栏只保留返回 Conversation、运行状态点和必要的未读提示。
- 窄边栏不展示迷你对话、输入栏、时间、Tool Call 或指标。
- `Esc` 返回 Conversation。
- Conversation 中的 Artifact 引用可以直接打开对应文件；`Run details` 打开 Canvas 的 Run overview。Canvas 不自行改变当前选择。

### 5. Shell Canvas 减法

Shell 步骤只保留：

```text
PowerShell                                      1.8s

> Get-ChildItem

output...
```

- 标题只使用实际执行环境 `PowerShell` 或 `Bash`。
- 删除 `Done`、`Command · PowerShell`、`Combined output · PowerShell`、`Type`、`Status` 等重复标签。
- 成功状态不额外显示；失败时标题可显示 `PowerShell · Failed` 或 `Bash · Failed`，并保留真实错误输出。
- 命令与输出保持明确分区，但不再为分区重复 Shell 名称。
- 历史输出的编码修复、尾部保留和不可恢复提示继续遵循 Context Harness 与现有 Shell 输出合同。

### 6. Loop Pet

Loop Pet 是等待期间短暂出现的随机惊喜，不是进度指示器，也不是需要完成的游戏。

初始参数：

- Agent 连续运行 45 秒后，随机等待 15–60 秒出现。
- 每次显示 4–7 秒，使用 2–3 帧极简 ASCII 动画。
- 每个 Agent Turn 最多出现一次，全局冷却时间为 10 分钟。
- 随机选择出现时机和 Pet 样式，但使用稳定位置，避免界面跳动。
- 不弹窗、不遮挡正文、不发声、不抢占输入焦点，也不提供必须点击的动作。
- Agent 完成、用户开始输入或页面失焦时立即消失；其他无关的指针移动或滚动不终止 Pet。
- `prefers-reduced-motion` 下只显示静态 ASCII，不播放帧动画。
- 10 分钟冷却从 Pet 首次显示的时刻开始计算。
- ASCII 帧由可取消计时器推进，不使用 CSS keyframes；出现和消失只使用不超过 300ms 的 `opacity` / `transform` transition。

调度状态机：

1. 冷却只存在于当前浏览器 Tab 的内存中，跨 Session 共用；刷新页面后重置，不写入 Session、localStorage 或服务端。
2. Turn 连续运行到 45 秒时检查冷却。仍在冷却则本 Turn 永久跳过，不在冷却结束后补调度。
3. 不在冷却时一次性抽取 15–60 秒延迟；到期且 Turn 仍在运行、页面仍可见、用户未开始输入时才显示。
4. Pet 出现前若 Agent 完成、用户开始输入或页面失焦，取消计时器，本 Turn 不暂停、不恢复、不重新抽取。
5. Pet 显示后按既定消失条件结束；同一 Turn 不再出现第二次。

这些时间参数是实现与可用性测试的初始值，可以在不改变上述交互合同的前提下微调。

## 信息层级

```text
Conversation
├─ 普通 Session：问题 + 回答 + Traj 摘要 + 头像 + Message.artifacts
├─ Goal Session：问题 + 最终回答 + 头像 + Message.artifacts
├─ Hover / Focus：紧凑指标 + ···
└─ Run details → Canvas / Run overview

Composer
└─ File + Goal

Canvas
├─ Run overview
│  ├─ Trajectory 索引
│  ├─ Tool Call 摘要
│  └─ Diagnostics
├─ 当前文件或步骤详情
└─ Conversation 收缩为窄边栏
```

同一份执行信息按深度分层：普通 Conversation 可以展示过程摘要，Goal Conversation 只展示结果；完整过程索引属于 Run details，原始命令与输出属于 Canvas。

## Accessibility 与 Motion

- `···`、返回 Conversation 和所有状态入口必须具有符合当前界面语言的明确 `aria-label`。
- 菜单可以通过键盘打开、导航和关闭，`Esc` 优先关闭当前浮层，再返回 Conversation。
- 紧凑指标不能成为理解回答的必要条件。
- Loop Pet 使用 `aria-hidden="true"`；执行状态继续由独立的 `role="status"` 文本表达。
- 所有出现与消失过渡只使用 `opacity` / `transform`，并可被 Agent 完成或用户输入立即中断。
- 300ms 上限只约束有限的交互 transition。Agent 头像呼吸和运行中 Tool 图标属于真实异步状态指示，可使用 900–1800ms 的 transform/opacity 循环；状态结束立即取消，`prefers-reduced-motion` 下静止。不得以此例外恢复重复的 running 文案或装饰循环。

## 验收标准

1. 普通 Session 默认展示可点击 Traj 摘要；Core Goal 状态非空后隐藏 Traj。两种模式都不在 Conversation 展开原始 Tool 输入/输出，也不显示步骤/文件数量摘要；Goal 按钮紧邻 `File` 按钮。
2. 回答头像保留，“已完成”等重复状态删除。
3. Copy、Regenerate、Create Skill 和 Run details 只通过 `···` 菜单进入；桌面指针在 Hover/Focus 时显示入口。
4. Hover/Focus 指标按 `TTFT · TPOT · TPS · IN · OUT · CACHE` 顺序紧凑展示；`CACHE` 为当前 Session 截至该回答的加权累计命中比例，空值省略，单轮精确值可在 Diagnostics 查看。
5. Agent 运行状态始终只有一条且原地更新，完成后不残留。
6. Canvas 打开后 Conversation 收缩为窄边栏；`Esc` 可以返回完整 Conversation。
7. Shell Canvas 不再显示重复的 Command、Combined output、Done、Type 或 Status 标签。
8. Loop Pet 只在长时间运行中短暂出现，每 Turn 最多一次，不遮挡内容、不抢焦点、不发声。
9. Hover、键盘 Focus、页面失焦和 `prefers-reduced-motion` 均有桌面回归覆盖。

## 验证

- UI 模块测试：指标格式化、空值省略、菜单 Focus 与 Loop Pet 调度。
- Canvas 测试：聚焦窄边栏、Shell 信息层级、成功与失败输出。
- E2E：普通/Goal Traj 切换、Goal 按钮位置与草稿行为、运行状态替换、Run details、长运行 Loop Pet 与 reduced-motion。
- `pnpm typecheck`
- `pnpm test:modules`
- `pnpm test:canvas`
- `pnpm test:e2e`
- `pnpm build`

## 实施结果（2026-07-31）

本 Goal 的九项验收标准已经全部落地：

1. 普通 Session 默认按 `Message.blocks` 渲染可点击 Traj 摘要；真实 Goal 存在时隐藏全部 Traj，只投影最后结果和 Core 明确挂载的 `Message.artifacts`。Composer 的 `Goal` 按钮紧邻 `File` 按钮，负责写入或撤销 `/goal ` 草稿，不绕过 Contract。
2. Agent 回答保留 22px Pi 头像；运行时只保留一条原地更新的状态，完成后状态消失，不额外显示 `Done` / “已完成”状态。
3. Copy、Regenerate、Create Skill 与 Run details 收进同一个 `···` 菜单。桌面指针通过 Hover/Focus 披露；键盘可以打开、逐项聚焦并用 `Esc` 关闭。
4. 回答指标固定投影为 `TTFT · TPOT · TPS · IN · OUT · CACHE`，按 `ms/s` 与 `k/m` 压缩；`CACHE` 按当前 Session 的完成 Turn 加权累积并显示百分比，精确单轮 Token、TPS、耗时、Cache 和 Context 进入折叠 Diagnostics。
5. Run details 直接打开 Canvas Run overview；这里保留完整 Trajectory 索引和 Diagnostics，选择步骤后在同一 Canvas 显示原始输入/输出，`Run overview` 返回键恢复索引。
6. Canvas 聚焦模式将 Conversation 收缩为 44px rail；rail 只保留 Pi 标识、返回入口和运行/未读点，`Esc` 返回完整 Conversation。
7. Shell Canvas 只显示 `PowerShell` / `Bash`、可选时间、`>` 命令和输出；成功不显示状态，失败显示 `· Failed`，编码损失提示与真实输出仍保留。
8. Loop Pet 使用当前 Tab 内存冷却和可取消计时器：45 秒阈值、15–60 秒随机延迟、4–7 秒展示、每 Turn 一次、10 分钟跨 Session 冷却；完成、输入、页面失焦均永久取消本 Turn 调度。
9. Loop Pet 仅使用 2–3 帧 ASCII，`aria-hidden`、无声音、无焦点、无遮罩；reduced-motion 下固定单帧，CSS 只使用 180ms opacity/transform transition。
10. Agent Flow 的 Thinking 默认折叠；折叠时不挂载正文，用户主动展开后才显示并随流更新。普通 Tool 行继续打开 Traj Canvas。
11. Composer 的文件入口显示 `File`（中文“文件”），所有普通文件导入入口复用同一个文件图标；目录选择保留文件夹图标。
12. 最终回答、产物入口与 Traj Canvas 共用同一个 920px 阅读宽度 token。

实现边界保持在 `ui` 的指标/调度纯函数、`canvas` 的投影与交互，以及 `core` 的 Tool 失败语义；没有把 Pi SDK 或服务端凭据引入浏览器模块。

历史验证快照（2026-07-31）：

- `pnpm typecheck`：通过。
- `pnpm test:modules`：73/73 通过。
- `pnpm test:canvas`：17/17 通过。
- `pnpm test:e2e`：桌面交互回归通过。
- `pnpm build`：生产 UI 与 CLI bundle 构建通过。
- 当次 Playwright CLI 曾人工检查默认灰黑页、回答 Hover/Menu 和 Canvas Run overview。端口、
  API Key 与当前模型 readiness 属于本地运行配置，不是本 Goal 的持久完成条件。

2026-08-04 全仓审计的当前命令结果见 [Goals 审计索引](./README.md)。

## 后续闭环（2026-08-01）

- 原“完整英文 locale 迁移”遗留已在 [UI-DARK-THEME-CONSISTENCY.md](./UI-DARK-THEME-CONSISTENCY.md) 中闭环：Session、Files、Model、Skill、Canvas 与空状态均改用 typed copy catalog；主题和语言由启动配置选择。历史会话内容、文件内容与 Tool 原始输出保持原文，不属于界面文案翻译范围。

## 非目标

- 在 Conversation 中复刻完整执行日志。
- 把 Loop Pet 作为准确进度、运行健康或完成时间的表达。
- 增加声音、积分、排行榜或需要用户完成的小游戏。
- 为指标建立新的计费或采集系统；只展示 Core 已有的可靠数据。
- 在本 Goal 中重做 Model、Session 或 Files 的业务流程。
