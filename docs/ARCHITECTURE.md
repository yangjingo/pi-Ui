# Architecture

Pi UI 只有一条浏览器/服务端边界：React 经由 `/api/*` 访问 Node；Node 独占 Pi SDK 和本地
runtime 数据。共享消息与事件由 runtime-neutral Agent protocol 定义。

Node Server 与 CLI 都确定性限制为 loopback host（`127.0.0.1`、`localhost`、`::1`），浏览器
调用 `/api/*` 还必须通过同源 `Origin` 校验。当前产品没有远程认证边界，因此不得监听
`0.0.0.0`、局域网地址或公网地址。

发布层保持一个 npm 包：`dist/` 是浏览器静态产物，`dist-node/` 是 Node Core 与 CLI
产物，`bin/pi-ui.js` 是极薄的命令入口。组件边界用于隔离变化原因和依赖方向，不转化为
多个需要独立版本管理的 npm 包。

Workspace 的浏览器启动流程负责检查并决定是否继承已有 Pi。Core 不在服务启动时自动
接管配置或 Session，只提供安全的检查与执行网关；认证采用本地优先、全局回退。继续
历史 Session 时，Node 网关在 `.workspace/.agentcore/inherited-sessions/` 创建 fork，
并把原始 JSONL 保持为只读来源。

源码按五个变化原因组织：

- `core`：Agent loop、浏览器 Agent gateway、协议与 Node transport。
- `harness`：Context、File、Goal、Skill 的可替换约束与持久化机制。
- `ui`：CSS、主题、语言/格式化及无业务状态的 UI primitive。
- `canvas`：应用面板、文件/轨迹 renderer 和编辑展示。
- `workspace`：文件、模型、Skill、Session 及 Workspace 状态和操作。

Canvas 只消费 Workspace facade，不直接访问 Agent client。Workspace 只消费浏览器 Agent
gateway 和 browser-safe File Harness，不依赖 Canvas。Core/Pi 负责组合 Harness、模型配置
和 Pi SDK，并通过 Agent protocol 对外发事件。模型 UI 显示 Workspace 已选择继承的 Pi
配置与项目本地配置，不枚举未配置的 SDK 内置目录。

Session 的执行状态与浏览器导航状态严格分离：

- `core/pi` 通过 `Map<sessionId, SessionRuntime>` 持有独立的 Pi session、cwd、消息、
  UserIntent、Goal、Steer 队列和 File Harness；切换前台页面不会释放后台 Runtime。
- Session 命令和事件都显式携带 `sessionId`。工作区级 SSE 可以广播后台状态，但不能
  改变任一 Tab 的当前页面。
- 浏览器 Agent store 按 `sessionId` 聚合状态；`WorkspaceProvider` 只把
  `/sessions/:sessionId` 对应的记录投影为当前页面。
- Workspace 的 `activeTab/wsOpen` 与 Canvas 的临时全屏聚焦状态相互独立。打开文件或执行
  轨迹默认进入分屏；全屏只由用户显式触发，不持久化，`Esc` 仅退出全屏而不关闭预览。
- 浏览器 gateway 对原始 SSE subscriber 保持逐事件交付；`text_delta`、
  `thinking_delta` 与 `tool_update` 只在 React external store 提交层按 32ms 合并。
  `tool_end`、快照和其他边界事件会同步冲刷队列，保证最终状态和事件顺序不延迟。
- 永久删除只允许空闲 Session。Core 在校验目标是 `workspaceRoot` 的直属真实目录后删除
  持久目录并广播 `session_deleted`；继承 Session 只额外删除应用拥有的 fork，永不删除
  外部 Pi `sourcePath` 或 `sourceCwd`。

复杂任务使用两阶段授权：`harness/goal` 先把 Agent 提议持久化为 UserIntent/Goal
Contract，浏览器确认精确的 `intentId + revision + contractHash` 后，Core 才允许 Pi
调用 `create_goal`。`update_goal(complete)` 还会经过结构化 completion audit 拦截器；
它必须覆盖确认 Contract 中全部 `D/AC/C/N/V` 编号。
- 根路径 `/` 是未绑定 Session 的欢迎态。当前 Tab 的选择不写入服务端全局状态，也不
  接管其他 Tab。
- 断线重连按浏览器已知的 Session ID 分别获取权威快照，不存在服务端“当前 Session”
  回退路径。

设计背景、取舍和全局架构图见
[`SESSION-BACKGROUND-FLOW-GOAL.md`](./goals/SESSION-BACKGROUND-FLOW-GOAL.md)。

主要依赖方向是 `canvas → workspace → core/agent`、`canvas → ui` 和
`core/pi → harness`。Core 模型目录的事实来源是
`.workspace/.agentcore/models.json`；Pi SDK、模型凭据与本地文件系统不得进入浏览器
bundle。

Context 的稳定前缀、Tool/Skill 插入顺序、UserIntent 授权链和 cache usage 指标统一由
[`GOAL-USER-INTENT-HARNESS.md`](./goals/GOAL-USER-INTENT-HARNESS.md) 定义。

## Goal、Slash、Skill 与 `@path`

Composer 的 Goal 按钮把 `/goal ` 写入草稿并进入普通发送入口，但 `/goal` 只代表显式
Goal Intent，不直接创建 active Goal，也不出现在普通 slash 建议列表。Core 必须先形成
UserIntent/Goal Contract，并在用户确认当前 `intentId + revision + contractHash` 后才允许
Agent 调用 `create_goal`。这条确认门覆盖旧 `SLASH-CONTEXT.md` 中可能被理解为“命令直接
创建 Goal”的表述。

Goal、UserIntent 与 Coding tools 在 Session 创建时固定注册，运行中不按任务增删。
`harness/goal` 负责 `/goal` 识别、Intent/Contract、Pi extension adapter、durable state
projection 与 completion audit；`pi-codex-goal` 负责 active Goal 的持久化、hidden
continuation、usage 和暂停/恢复边界。active Goal 使用模型支持的最高可用 Thinking。

默认 Goal 不设置 Token 预算；只有调用方明确传入正整数 `token_budget` 时才进入预算模式。
带预算 Goal 首次进入 `budgetLimited` 时，Harness 只生成一次
`goal-budget-report-<goalId>.md`，将报告写入当前 Session workspace，并通过可恢复的 session
custom entries 记录计数与生成状态。

Local Skills 出现在 Composer 的 slash 列表中。Skill Hub 的列表 API 只读取 `SKILL.md`
frontmatter、`.skillhub.json` 与文件数量；只有打开编辑器时才读取完整 package。用户显式输入
`/name` 时，Core 将其翻译为 Pi SDK 原生 `/skill:name`：`DefaultResourceLoader` 负责发现、
把 Skill 的完整路径写入 prompt，并在调用时按需展开 `SKILL.md`。Transcript 仍保留紧凑命令。
项目不再维护第二套 Skill body 注入协议。Skill Hub 只管理本地 Workspace Skills，不提供远程安装 endpoint。
Agent 回答菜单中的“生成 Skill”只向 Core 提交已完成 Turn 的索引。Harness 从 Trajectory
提炼可复用的 Tool 策略，并把该 Turn 明确引用的文本脚本复制到
`skill-drafts/<draft-id>/scripts/`；原始回答、Thinking、Tool output 和完整 Trajectory 不复制。
Core 先把候选 `SKILL.md` 与脚本写入当前 Session，不触碰 Skill Hub。

浏览器随后把 `@skill-drafts/<draft-id>/SKILL.md` 验证请求放入当前 Composer。只有该引用对应的
Agent 验证轮完成后，Conversation 才显示“贡献到 Skill Hub”。这个操作也不直接发布，而是
生成一条要求先与用户商讨并确认最终名称的 Composer 请求；名称确认后，Agent 更新
frontmatter，再调用 `skill_package`。受控安装会在缺少时补齐官方 `agents/openai.yaml`，成功
后才刷新 Skill Hub catalog。

自然语言安装也不开放浏览器远程安装 endpoint。用户明确提供 URL 或上传 ZIP 时，Agent 先把
源码下载/解包到当前 Session，确认具体目录直接包含 `SKILL.md`，再调用固定注册的
`skill_package` Tool。该 Tool 是唯一可以把已校验目录提交到 Workspace Skill root 的写入口；
普通 File/Shell Tool 仍不能写 Skill roots，且同名 Skill 默认拒绝覆盖。安装成功会发出
`skills_changed`，Skill Hub catalog 随即刷新。

Skill 依赖环境归 Workspace 而非 Session 所有，位于
`.agentcore/skill-envs/<skill-id>/<fingerprint>/`。fingerprint 由运行平台、`SKILL.md` 与 Skill
内的依赖清单、锁文件共同决定；已标记 ready 的环境在后续 Session 中直接复用，Skill 或清单变化则自然进入新目录。
Skill package 本身只读，任务产物仍写入当前 Session。
完整的冲突裁决、权限矩阵、环境生命周期与验收记录见
[Skill/File Harness Goal](./goals/GOAL-SKILL-FILE-HARNESS.md)。

`@path` 与 slash command 相互独立。发送前 Workspace 将被引用文件展开到模型输入，同时在
Conversation Transcript 中保留紧凑引用。浏览器始终只调用 `/api/*`；Pi Session、Goal
extension 与文件读取都归 Node Core。

## Model configuration

模型配置由 Node Core 负责，Canvas 只持有表单草稿、校验反馈和未保存状态，Workspace 将
操作转发给 `/api/models/*`。Core 解析、校验和持久化配置与凭据，刷新 Pi SDK runtime，
并只向浏览器返回脱敏结果；Pi SDK 只能在 `src/core/pi` 中使用。

可见目录采用“显式本地配置 + 显式继承”的统一规则：

- 用户通过 UI 添加或在 `.workspace/.agentcore/models.json` 中声明的 Provider/模型可见。
- Workspace 启动时可以由用户明确选择继承已有 Pi 配置；确认继承后，Core 将安全投影纳入
  当前 Workspace 的模型目录。服务启动本身不得自动接管全局配置。
- 未被本地声明或继承的 Pi SDK 内置 Provider/模型不得枚举、预加载或展示。“SDK 支持”
  不等于“UI 自动展示”。

相关文件：

- `.workspace/.agentcore/models.json`：Provider 与模型定义。
- `.workspace/.agentcore/auth.json`：Core 私有凭据；API Key 不通过列表或配置读取接口返回。
- `.workspace/.agentcore/active-model.json`：当前激活模型。

保存表单时，空 API Key 表示保留已有凭据，新值由 Core 写入 `auth.json`。旧
`.workspace/settings.json` 可以在首次启动时迁移，但不由迁移流程自动删除。

目录协议明确区分两层含义：

- `workspaceRoot` 是持久化的 Workspace 根目录，默认以 `.workspace` 结尾；模型配置 UI
  使用这个值，并展示 `.agentcore/models.json` 与受保护的 `.agentcore/auth.json`。
- `cwd` 是目标 Agent Session 的目录，即 `workspaceRoot/<sessionId>`；Files、Traj、消息和
  Canvas 会话状态继续按这个目录隔离。

Core 只向浏览器返回 `auth.json` 的安全路径元数据，凭据内容始终留在服务端。

下方 Source module contract 是模块边界、依赖矩阵、公开入口与验证方法的唯一架构来源。
边界规则由 `tests/core/source-boundaries.test.ts` 直接验证，`pnpm test:boundaries` 是测试
入口；`pnpm check:boundaries` 作为兼容别名，仍是 `typecheck` 与 `build` 的前置检查。


## Source module contract

### 1. Decision

`src/` 只保留五个业务模块目录：

```text
src/
├─ core/       # Agent loop、浏览器 Agent gateway、Node/Pi runtime 与传输
├─ harness/    # 可独立复用和测试的约束层
├─ ui/         # CSS、主题、语言/格式化与无业务状态的 UI primitive
├─ canvas/     # 页面壳、面板和文件/轨迹渲染组件
├─ workspace/  # 文件、模型、Skill、Session 与 Workspace 状态/操作
├─ app.tsx     # 五模块的组合根
└─ main.tsx    # 浏览器启动入口
```

不再保留 `conversation/`、`models/`、`sessions/`、`skill/` 等顶层功能目录。它们分别成为 Canvas 面板或 Workspace 业务子模块。

这次整合改变的是所有权和依赖方向，不改变用户可见功能、HTTP API 或 Agent 协议。

### 2. Why

当前目录按功能页面拆分，但真实依赖并不按页面分离：

- `canvas/` 同时拥有面板、文件树、文件导入、全局 Workspace 状态、Session 操作和消息发送。
- `conversation/` 既渲染对话，又直接调用 Agent client、文件导入和 Skill store。
- `models/`、`sessions/`、`skill/` 都是独立顶层目录，但它们共享同一 Workspace 生命周期和同一组 Canvas 面板原语。
- 边界检查因此需要维护大量“页面 feature”，却不能表达“展示层不能直接做 Workspace I/O”这一条真正重要的规则。

五模块结构以变化原因划分代码：Agent loop、可复用约束、视觉语言、面板展示、工作区业务各自只有一个所有者。

### 3. Module boundaries

#### 3.1 `core`

职责：

- 定义运行时中立的 Agent 消息、事件、文件、模型与 Session 协议。
- 在浏览器端维护 Agent SSE 状态并提供 `/api/*` client；高频流事件在 external store
  提交层按短帧合并，原始事件订阅与协议语义保持不变。
- 在 Node 端运行 Pi Agent loop、模型 runtime、HTTP/SSE transport 和 server/plugin。
- 解析、校验和持久化 `.workspace/.agentcore/models.json`，隔离模型凭据，并刷新 Pi SDK runtime。
- 将文件、Goal、Skill 的具体约束委托给 Harness。

允许：

- `core/pi` 依赖 `core/agent/protocol` 和 `harness/*`。
- `core/agent` 内部 client 依赖自己的 protocol、reducer 和 request helper。

禁止：

- 导入 React、Canvas、Workspace 或 UI。
- 在 `core/pi` 重复实现 Harness 已拥有的路径、文件大小、Goal 或 Skill 约束。
- 将 Pi SDK import 暴露给浏览器入口。

公共入口：

- `core/agent/index.ts`：浏览器 Agent gateway。
- `core/agent/protocol.ts`：Node-safe、类型与协议专用入口。
- `core/pi/*`：仅由 Node server、Vite plugin 和 Core 内部使用，不提供浏览器入口。

#### 3.2 `harness`

职责：

- `harness/context`：稳定 System/Tool 前缀、动态 user turn 组装、确定性指纹、cache usage
  projection，以及 Agent 的 Shell 选择规则；Windows 原生任务优先 PowerShell，明确依赖
  POSIX 语义时才使用 Bash。
- `harness/file`：安全路径、文本/二进制边界、Office 预览、文件扫描与 mutation；将本轮生成文件投影成 Canvas Artifact，并清除重复的路径/打开说明。Pi `tool_call` 适配器把 read/write/edit/find/grep/ls 和 shell 的显式路径限制在当前 Session、只读 Skill roots 与本轮 Skill 环境内；这是应用层能力门禁，不是 WSL、容器或 OS shell sandbox。
- `harness/goal`：UserIntent/Goal Contract 状态机、三轮澄清与确认门、Goal 命令识别、扩展装配、durable state projection、完成审计，以及跨 continuation 的 Agent Loop、Thinking 与 Tool 调用计数。
- `core/pi/shell-output.ts`：历史/实时 Shell 类型识别、终端控制字符清理、编码损失标记和旧 Traj 回填。它是持久化投影适配，不是独立 Harness。
- `harness/skill`：本地 Skill 校验、元数据目录、Pi 原生命令解析、环境指纹/复用和 turn-to-Skill projection；Skill 发现与渐进披露由 Pi SDK 实现。

允许：

- 依赖 Node 标准库。
- 类型级依赖 `core/agent/protocol`。

禁止：

- 依赖 React、UI、Canvas、Workspace 或 Pi SDK。
- 访问浏览器状态。
- 通过网络直接调用 `/api/*`。

Harness 必须可以脱离页面运行，并由 `tests/harness/` 直接测试。

Harness 的合法入口是显式的子模块入口，而不是一个混合的顶层 barrel：

- `harness/file/index.ts`：browser-safe Office/文件类型规则；不得导入 Node 标准库或 `runtime.ts`。
- `harness/file/runtime.ts`：Node-only 文件 mutation；只允许 `core/pi` 和 runtime 测试导入。
- `harness/context/index.ts`：Node-only Context Harness；不得依赖 Pi SDK。
- `harness/goal/index.ts`：Node-only Goal Harness。
- `core/pi/shell-output.ts`：Core 私有的 Shell 输出兼容与历史迁移，不向浏览器导出。
- `harness/skill/index.ts`：Node-only Skill Harness。

边界检查必须拒绝 Workspace 导入任何 Node-only Harness 入口；Vite production build 进一步证明 browser-safe 入口没有传递引入 Node runtime。

#### 3.3 `ui`

职责：

- 全局 CSS、设计 token、主题和 reduced-motion 规则。
- 图标、Markdown 基础渲染和无业务状态的 primitive。
- typed locale catalog、未知值文本化以及时间/token 格式化；默认 locale 是英文，中文是
  完整可选 locale。
- Mermaid 等仅服务展示的共享 runtime。

允许：

- 类型级依赖 `core/agent/protocol`，用于把协议枚举映射成图标或展示标签。
- 依赖纯前端第三方渲染库。

禁止：

- 调用 `/api/*` 或 Agent client。
- 持有 Session、Workspace、模型或 Skill 状态。
- 导入 Canvas、Workspace、Harness 或 `core/pi`。

全局样式从 `ui/styles.css` 唯一加载；`main.tsx` 可以直接导入这一专用入口，业务模块不得创建第二个全局样式入口。

#### 3.4 `canvas`

职责：

- 组合页面壳、顶部栏、对话面板、Workspace/Files/Canvas 面板和配置 workbench。
- 渲染 Markdown、HTML、代码、表格、图片、PDF、Mermaid、Excalidraw 与执行轨迹。
- 管理纯展示交互，例如面板宽度、tab 键盘导航、popover 焦点和预览模式。
- 接收 Workspace 提供的状态和 action，并将其转换成可访问的 UI。

允许：

- 依赖 `workspace` 的公开入口获取业务状态和 action。
- 依赖 `ui` 的公开入口。
- 类型级依赖 `core/agent/protocol`。

禁止：

- 直接导入 Agent client 或调用 `/api/*`。
- 直接导入 server-only Harness。
- 持久化文件、模型、Skill 或 Session。
- 被 Workspace 反向依赖。

Canvas 中的组件可以有本地展示状态，但不能成为业务数据的唯一事实来源。

#### 3.5 `workspace`

职责：

- 将 Core 的 Agent 状态转换为浏览器可消费的 Workspace state。
- 管理 Files/Canvas tab、编辑 buffer、未保存保护、持久化视图状态和 pending Agent changes。
- 文件上传、Office 导入、下载 URL、保存、重命名与删除。
- 将模型列表、配置编辑、模型测试、激活模型和 cwd 操作转发给 Core。
- Skill 列表、保存、删除、slash command 和 turn-to-Skill。
- Session 列表、切换、新建、重命名、删除请求、浏览器缓存清理和搜索状态；物理目录删除及
  路径安全校验始终由 Core 执行。
- 为 Canvas 暴露稳定的 React context、hooks、services 和类型。

允许：

- 依赖 `core/agent` 浏览器入口。
- 依赖 `harness/file` 的浏览器安全规则。
- 使用 React 管理浏览器应用状态。

禁止：

- 导入 Canvas 或具体面板组件。
- 依赖 `core/pi`、`harness/context`、`harness/file/runtime`、`harness/goal` 或 `harness/skill`。
- 自己实现服务端文件路径或安全约束。
- 输出带具体 DOM 结构的组件。

Workspace 是 Canvas 与 Core 之间唯一的浏览器业务层。

模型目录是一个刻意收紧的例外：Workspace 不读取凭据或直接解析 Pi 的服务端文件，也不
枚举 Pi SDK 的全部内置 Provider。Workspace 拥有继承的启动决策，通过浏览器 Agent
gateway 请求安全元数据并明确提交是否继承；Core 只执行受保护的文件读取和 Session fork。

### 4. Dependency direction

`→` 表示可以依赖：

```text
app ──→ canvas → workspace → core/agent
 └──────────────→ workspace
        │             │
        ↓             └──→ harness/file/index.ts (browser-safe)
        ui

core/pi → core/agent/protocol
   └────→ harness/{context,file,goal,skill}

harness/* → core/agent/protocol (types and pure protocol helpers only)
ui        → core/agent/protocol (type-only)
```

依赖矩阵：

| From \ To | core/agent | core/pi | harness | ui | canvas | workspace |
|---|---:|---:|---:|---:|---:|---:|
| core/agent | internal | no | no | no | no | no |
| core/pi | protocol only | internal | yes | no | no | no |
| harness | protocol types/pure helpers | no | internal | no | no | no |
| ui | protocol types | no | no | internal | no | no |
| canvas | protocol types | no | no | yes | internal | yes |
| workspace | yes | no | file public entry only | no | no | internal |

跨模块 import 必须通过目标模块的 `index.ts`。显式专用入口只有
`core/agent/protocol.ts` 和上文列出的 Harness 子模块入口；除此之外不允许 deep import。

### 5. Target source tree

```text
src/
├─ core/
│  ├─ agent/
│  ├─ pi/
│  └─ tsconfig.json
├─ harness/
│  ├─ context/
│  ├─ file/
│  ├─ goal/
│  └─ skill/
├─ ui/
│  ├─ icons.tsx
│  ├─ markdown/
│  ├─ language/       # typed catalog、locale registry 与纯展示格式化
│  ├─ theme.ts       # 主题注册表；组件仅消费语义 token
│  ├─ styles.css
│  └─ index.ts
├─ canvas/
│  ├─ components/
│  ├─ hooks/
│  ├─ panels/
│  ├─ renderers/
│  └─ index.ts
├─ workspace/
│  ├─ files/
│  ├─ models/
│  ├─ skills/
│  ├─ state/
│  └─ index.ts
├─ app.tsx
└─ main.tsx
```

除第 3、4 节列出的协议、Harness 和全局 CSS 专用入口外，内部子目录不是跨模块 API。调用方只识别五个模块及它们的公开入口。

根文件规则：

- `main.tsx` 只导入 `app.tsx` 与 `ui/styles.css`。
- `app.tsx` 通过 `canvas/index.ts` 和 `workspace/index.ts` 组合应用，并可直接消费 `ui/index.ts` 的根级加载文案。
- 根文件不得 deep import 五个模块的内部实现。

### 6. Completed migration map

本节是五模块整合的已完成迁移记录，不是仍待执行的第二套目标结构；当前所有权以第 1、3、
5 节为准。

| Current owner | Target owner | Notes |
|---|---|---|
| `canvas/state/*` | `workspace/state/*` | Workspace 状态、编辑事务、持久化 |
| `canvas/files/*` | `workspace/files/*` | 文件树数据模型、查询和路径操作；不包含 React DOM |
| `canvas/hooks/use-file-import.ts` | `workspace/files/use-file-import.ts` | 文件/Office 导入业务 |
| `canvas/hooks/use-workspace-width.ts` | `canvas/hooks/use-workspace-width.ts` | 纯面板布局，保留 |
| `conversation/conversation.tsx` | `canvas/panels/conversation-panel.tsx` | 只保留视图；I/O 改走 Workspace |
| `models/model-workbench.tsx` | `canvas/panels/model-panel.tsx` | 模型 I/O 通过 `workspace/models` service |
| `sessions/sessions-view.tsx` | `canvas/panels/session-panel.tsx` | Session action 来自 Workspace |
| `skill/components/skill-hub.tsx` | `canvas/panels/skill-panel.tsx` | Skill 数据与 mutation 来自 Workspace |
| `skill/model.ts`, `skill/store.ts` | `workspace/skills/*` | Skill 业务模型和 store |
| `canvas/components/workspace.tsx` | `canvas/panels/workspace-panel.tsx` | 右侧工作区面板 |
| `canvas/components/workspace-files-panel.tsx` | `canvas/panels/files-panel.tsx` | Files 面板 |
| `canvas/components/config-workbench.tsx` | `canvas/panels/config-workbench.tsx` | 配置面板壳 |
| `canvas/components/top-bar.tsx` | `canvas/panels/top-bar.tsx` | 页面导航面板 |
| `styles.css` | `ui/styles.css` | 唯一全局主题入口 |
| `ui/render.ts` | `ui/language/format.ts` + `ui/markdown/render.ts` | 展示格式与 Markdown 职责分离 |

旧目录采用闭包迁移规则：

- `conversation/`：所有 React/DOM 文件进入 `canvas/panels`；所有文件、Skill、Agent mutation 改由 Workspace facade 提供。
- `models/`：所有 React/DOM 文件进入 `canvas/panels`；解析、校验和 Core 调用进入 `workspace/models`。
- `sessions/`：所有 React/DOM 文件进入 `canvas/panels`；列表、搜索和 mutation 进入 Workspace state/actions。
- `skill/`：所有 React/DOM 文件进入 `canvas/panels`；类型、store、命令和 mutation 进入 `workspace/skills`。

迁移完成后必须删除 `conversation/`、`models/`、`sessions/`、`skill/` 目录及其旧 `index.ts`，不得保留兼容 re-export。

### 7. Public APIs

#### `workspace/index.ts`

允许导出的业务 facade：

- `WorkspaceProvider`、`useWorkspace`、`WorkspaceCtx`、`View`。
- `WorkspaceCtx` 中的 Session 列表、搜索、新建、切换、重命名和删除 action。
- 文件树数据查询、路径 helper、Office/文件类型规则、上传/导入、保存、重命名和删除 facade。
- Skill 类型、只读 store hook、slash command、保存/删除和 turn-to-Skill action。
- 模型列表、配置文件、模型测试、激活、cwd 和自定义模型 mutation service。

不得导出内部 persistence key、mutable ref、Core client 实例或 React DOM 面板。新增公开符号必须属于上述 facade 类别，并由边界测试覆盖；`index.ts` 不是任意内部 helper 的逃生口。

#### `canvas/index.ts`

只导出 App 组合所需的面板：

- `ConversationPanel`
- `WorkspacePanel`
- `ModelPanel`
- `SessionPanel`
- `SkillPanel`
- `TopBar`

Canvas 内部 renderer、React file tree 和 config workbench 不作为 Workspace API。

#### `ui/index.ts`

只导出共享 primitive、图标、Markdown 组件、格式化和渲染 helper。

### 8. Enforced invariants

`tests/core/source-boundaries.test.ts`（由 `pnpm test:boundaries` 或兼容命令
`pnpm check:boundaries` 调用）必须验证：

1. `src/` 只存在 `core`、`harness`、`ui`、`canvas`、`workspace` 五个模块目录。
2. 所有 `.ts/.tsx` 文件使用 lowercase kebab-case，`index.ts` 例外仍符合规则。
3. 跨模块 import 使用公开入口。
4. Canvas 不能导入 Core client、Pi 或 Harness。
5. Workspace 不能导入 Canvas、Pi 或 server-only Harness。
6. UI 不能导入 Workspace、Canvas、Pi 或 Harness。
7. Harness 不能导入 UI、Canvas、Workspace 或 Pi。
8. `core/agent` 不能导入其他业务模块。
9. Pi SDK package import 只能出现在 `core/pi`。
10. 浏览器模块不能深层导入 `core/agent`；协议类型除外。
11. `conversation/`、`models/`、`sessions/`、`skill/` 旧顶层目录和兼容入口不存在。
12. `harness/file/index.ts` 的传递依赖不包含 Node 标准库或 `harness/file/runtime.ts`。
13. Canvas 和 UI 对 `core/agent/protocol.ts` 的依赖必须使用 `import type`；Harness
    还可以使用 `fileTypeOf` 这类无 Node、Pi、React 依赖的纯协议 helper。
14. `main.tsx` 和 `app.tsx` 只使用第 5 节定义的根文件入口。
15. TypeScript 的 unused locals/parameters 检查保持开启，避免失效状态和导入长期残留。

### 9. Testing and proof

目录迁移完成后按以下顺序验证：

1. `pnpm test:boundaries`：证明五模块目录和依赖矩阵。
2. `pnpm typecheck`：证明浏览器、Core 和测试路径全部更新。
3. `pnpm test:modules`：运行镜像 `core/harness/ui/workspace` 边界的模块测试。
4. `pnpm test:canvas`：证明 Canvas 面板、文件预览、编辑保存和导入行为未变。
5. `pnpm test:e2e`：证明对话、模型、Session 和 Skill 的跨模块工作流未变。
6. `pnpm build`：证明浏览器 bundle 不含非法 Node/Pi 边界。

测试目录与源码采用相同的所有权：

```text
tests/
├─ core/
├─ harness/
├─ ui/
├─ canvas/
├─ workspace/
├─ e2e/       # 跨模块用户流程
└─ fixtures/  # 共享测试设施
```

边界测试同时检查源码和测试目录，拒绝额外业务测试模块、大小写混用
以及不符合源码依赖方向的测试导入。

模块测试可以访问所属模块的内部实现；跨模块引用仍必须遵守源码公开入口和依赖方向。

### 10. Non-goals

以下条目只限定第 6 节所记录的“五模块目录迁移”，不是当前产品架构的永久禁令。迁移完成后
新增的 Intent、Skill detail API 与 File archive API 分别由对应 Goal 合同授权。

- 不修改 `/api/*` 路径或 payload。
- 不更换状态管理库。
- 不改变视觉设计或交互文案。
- 不在本次整合中拆分 PiRuntime 的行为。
- 不引入新的模型、文件或 Skill 功能。
