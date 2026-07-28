# Source Module Design

## 1. Decision

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

## 2. Why

当前目录按功能页面拆分，但真实依赖并不按页面分离：

- `canvas/` 同时拥有面板、文件树、文件导入、全局 Workspace 状态、Session 操作和消息发送。
- `conversation/` 既渲染对话，又直接调用 Agent client、文件导入和 Skill store。
- `models/`、`sessions/`、`skill/` 都是独立顶层目录，但它们共享同一 Workspace 生命周期和同一组 Canvas 面板原语。
- 边界检查因此需要维护大量“页面 feature”，却不能表达“展示层不能直接做 Workspace I/O”这一条真正重要的规则。

五模块结构以变化原因划分代码：Agent loop、可复用约束、视觉语言、面板展示、工作区业务各自只有一个所有者。

## 3. Module boundaries

### 3.1 `core`

职责：

- 定义运行时中立的 Agent 消息、事件、文件、模型与 Session 协议。
- 在浏览器端维护 Agent SSE 状态并提供 `/api/*` client。
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

### 3.2 `harness`

职责：

- `harness/context`：稳定 System/Tool 前缀、动态 user turn 组装、确定性指纹和 cache usage projection。
- `harness/file`：安全路径、文本/二进制边界、Office 预览、文件扫描与 mutation；将本轮生成文件投影成 Canvas Artifact，并清除重复的路径/打开说明。
- `harness/goal`：Goal 命令识别、扩展装配、durable state projection、Goal Tool 的语义化 Traj 输入/输出，以及跨 continuation 的 Agent Loop、Thinking 与 Tool 调用计数。
- `harness/skill`：本地 Skill 校验、持久化、显式调用注入和 turn-to-Skill projection。

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
- `harness/skill/index.ts`：Node-only Skill Harness。

边界检查必须拒绝 Workspace 导入任何 Node-only Harness 入口；Vite production build 进一步证明 browser-safe 入口没有传递引入 Node runtime。

### 3.3 `ui`

职责：

- 全局 CSS、设计 token、主题和 reduced-motion 规则。
- 图标、Markdown 基础渲染和无业务状态的 primitive。
- 中文界面文本的基础规范、未知值文本化以及时间/token 格式化。
- Mermaid 等仅服务展示的共享 runtime。

允许：

- 类型级依赖 `core/agent/protocol`，用于把协议枚举映射成图标或展示标签。
- 依赖纯前端第三方渲染库。

禁止：

- 调用 `/api/*` 或 Agent client。
- 持有 Session、Workspace、模型或 Skill 状态。
- 导入 Canvas、Workspace、Harness 或 `core/pi`。

全局样式从 `ui/styles.css` 唯一加载；`main.tsx` 可以直接导入这一专用入口，业务模块不得创建第二个全局样式入口。

### 3.4 `canvas`

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

### 3.5 `workspace`

职责：

- 将 Core 的 Agent 状态转换为浏览器可消费的 Workspace state。
- 管理 Files/Canvas tab、编辑 buffer、未保存保护、持久化视图状态和 pending Agent changes。
- 文件上传、Office 导入、下载 URL、保存、重命名与删除。
- 将模型列表、配置编辑、模型测试、激活模型和 cwd 操作转发给 Core。
- Skill 列表、保存、删除、slash command 和 turn-to-Skill。
- Session 列表、切换、新建、重命名、删除和搜索状态。
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

## 4. Dependency direction

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

## 5. Target source tree

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
│  ├─ language/
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
- `app.tsx` 只通过 `canvas/index.ts` 和 `workspace/index.ts` 组合应用。
- 根文件不得 deep import 五个模块的内部实现。

## 6. Migration map

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

## 7. Public APIs

### `workspace/index.ts`

允许导出的业务 facade：

- `WorkspaceProvider`、`useWorkspace`、`WorkspaceCtx`、`View`。
- `WorkspaceCtx` 中的 Session 列表、搜索、新建、切换、重命名和删除 action。
- 文件树数据查询、路径 helper、Office/文件类型规则、上传/导入、保存、重命名和删除 facade。
- Skill 类型、只读 store hook、slash command、保存/删除和 turn-to-Skill action。
- 模型列表、配置文件、模型测试、激活、cwd 和自定义模型 mutation service。

不得导出内部 persistence key、mutable ref、Core client 实例或 React DOM 面板。新增公开符号必须属于上述 facade 类别，并由边界测试覆盖；`index.ts` 不是任意内部 helper 的逃生口。

### `canvas/index.ts`

只导出 App 组合所需的面板：

- `ConversationPanel`
- `WorkspacePanel`
- `ModelPanel`
- `SessionPanel`
- `SkillPanel`
- `TopBar`

Canvas 内部 renderer、React file tree 和 config workbench 不作为 Workspace API。

### `ui/index.ts`

只导出共享 primitive、图标、Markdown 组件、格式化和渲染 helper。

## 8. Enforced invariants

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

## 9. Testing and proof

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

## 10. Non-goals

- 不修改 `/api/*` 路径或 payload。
- 不更换状态管理库。
- 不改变视觉设计或交互文案。
- 不在本次整合中拆分 PiRuntime 的行为。
- 不引入新的模型、文件或 Skill 功能。
