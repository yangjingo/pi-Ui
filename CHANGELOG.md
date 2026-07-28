# Changelog

Pi UI 的重要变更记录在此文件中。

版本格式遵循 [Semantic Versioning](https://semver.org/)，日期使用
`YYYY-MM-DD`。

## [0.1.1] - 2026-07-28

### 修复

- 会话列表显示原生 Pi sessid，而非内部路由 ID；支持以任意 sessid 片段搜索。
- 会话卡片在右下角完整显示 sessid，并以 `YYYY-MM-DD HH:mm` 显示最近活动时间。

## [0.1.0] - 2026-07-27

首个正式版本。该版本将 Pi UI 整理为边界清晰、可验证的两层 Agent Workspace，
并完善 Goal、模型配置、Canvas 文件产物和测试体系。

### 新增

- 新增单包 npm 发布产物和 `piUi` CLI；可通过 `npx @whyj/pi-ui install` 一键初始化并启动
  本地 Workspace，并使用 `piUi doctor` 检查运行环境。
- Workspace 的浏览器启动流程自动继承本机已有 Pi 的模型、认证和历史 Session；Core
  启动本身不自动接管，继续历史会话时在 UI 私有目录创建分支。
- Session 列表以 `YYYY-MM-DD HH:mm (sessid)` 单行完整展示原生 Pi 会话 ID，并支持
  使用任意较短的 sessid 片段搜索。
- 建立 `core`、`harness`、`ui`、`canvas`、`workspace` 五个源码模块，以及与其边界
  对齐的测试目录。
- 新增 Context、File、Goal、Skill 四类 Harness，分别管理稳定上下文、文件产物、
  目标生命周期和本地 Skill。
- 集成 `pi-codex-goal`：`/goal` 自动启用最高 Thinking 强度，记录 Goal 内容、
  语义化输入输出、Agent Loop、Thinking/Tool 轮次、耗时与 Token 使用情况。
- 新增 Goal 结束报告，并从 SDK response metadata 统计 input、output、cache read、
  cache write 等 Token 指标；报告可作为文件直接在 Canvas 打开。
- 在 Node Core 集成 `@earendil-works/pi-ai` 模型配置；模型与凭据分别保存到
  `.workspace/.agentcore/models.json` 和 `.workspace/.agentcore/auth.json`。
- 新增 Canvas 代码编辑与 `Ctrl+S` 保存、HTML 幻灯片翻页、Markdown/Mermaid、
  Excalidraw、SVG、Excel/表格等预览能力。
- 新增文件产物识别：Agent 输出中声明的文件会复用 Traj 文件步骤展示，并可直接在
  Canvas 打开。
- 新增模块测试、Canvas 浏览器测试和跨模块 E2E 测试，并加入源码边界和文件命名校验。

### 变更

- 浏览器代码只通过 `/api/*` 使用 Core 能力，Pi SDK 与 Provider 凭据保持在服务端。
- 模型配置 UI 只显示用户添加或 Core `models.json` 显式声明的模型，不加载 SDK
  内置 Provider/模型目录。
- 模型配置使用 Workspace 根目录；Agent 消息、Traj、文件与 Canvas 继续按
  `workspace/sessionId` 隔离。
- Goal 与普通 Agent 复用既有 Traj、Canvas 和文件步骤组件，不再维护独立的展示体系。
- Canvas 的复制操作统一复制当前预览的纯文本内容；移除定位按钮、底部路径栏和冗余
  文件卡片。
- 调整 Canvas 面板密度、边框、代码展开方式、不可预览状态和表格视觉样式。
- 将旧 `verify/` 回归脚本迁移为常见的 `tests/` 结构，并统一源码和测试文件为
  lowercase kebab-case。
- 将源码架构说明归并到 `docs/`，以公开入口和自动化边界测试约束模块依赖。

### 移除

- 移除 `CLAUDE.md`、旧 `.claude` 项目 Skill 和过时的验证脚本。
- 移除旧的扁平组件、Core 和 Workspace 兼容目录，避免新旧实现并存。
- 移除独立的产物 Manifest 视觉组件；文件产物直接使用现有 Agent Flow 步骤。
- 移除 Agent 输出卡片下无意义的编辑操作，以及 Goal 专属的重复状态组件。

[0.1.1]: https://github.com/yangjingo/pi-Ui/releases/tag/v0.1.1
[0.1.0]: https://github.com/yangjingo/pi-Ui/releases/tag/v0.1.0
