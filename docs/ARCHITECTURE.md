# Architecture

Pi UI 只有一条浏览器/服务端边界：React 经由 `/api/*` 访问 Node；Node 独占 Pi SDK 和本地
runtime 数据。共享消息与事件由 runtime-neutral Agent protocol 定义。

源码按五个变化原因组织：

- `core`：Agent loop、浏览器 Agent gateway、协议与 Node transport。
- `harness`：Context、File、Goal、Skill 的可替换约束与持久化机制。
- `ui`：CSS、主题、语言/格式化及无业务状态的 UI primitive。
- `canvas`：应用面板、文件/轨迹 renderer 和编辑展示。
- `workspace`：文件、模型、Skill、Session 及 Workspace 状态和操作。

Canvas 只消费 Workspace facade，不直接访问 Agent client。Workspace 只消费浏览器 Agent
gateway 和 browser-safe File Harness，不依赖 Canvas。Core/Pi 负责组合 Harness、模型配置
和 Pi SDK，并通过 Agent protocol 对外发事件。模型 UI 只显示 Core `models.json` 中显式
声明的内容，不枚举 SDK 内置目录。

主要依赖方向是 `canvas → workspace → core/agent`、`canvas → ui` 和
`core/pi → harness`。Core 模型目录的事实来源是
`.workspace/.agentcore/models.json`；Pi SDK、模型凭据与本地文件系统不得进入浏览器
bundle。

Context 的稳定前缀、Tool/Skill 插入顺序和 cache usage 指标见
[`CONTEXT-HARNESS.md`](./CONTEXT-HARNESS.md)。

目录协议明确区分两层含义：

- `workspaceRoot` 是持久化的 Workspace 根目录，默认以 `.workspace` 结尾；模型配置 UI
  使用这个值，并展示 `.agentcore/models.json` 与受保护的 `.agentcore/auth.json`。
- `cwd` 是当前 Agent 会话目录，即 `workspaceRoot/<sessionId>`；Files、Traj、消息和
  Canvas 会话状态继续按这个目录隔离。

Core 只向浏览器返回 `auth.json` 的安全路径元数据，凭据内容始终留在服务端。

详细边界、依赖矩阵、迁移表和验证方法见
[`SOURCE-MODULE-DESIGN.md`](./SOURCE-MODULE-DESIGN.md)。边界规则由
`tests/core/source-boundaries.test.ts` 直接验证，`pnpm test:boundaries` 是测试入口；
`pnpm check:boundaries` 作为兼容别名，仍是 `typecheck` 与 `build` 的前置检查。
