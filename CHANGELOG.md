# Changelog

Pi UI 的重要变更记录在此文件中。

版本格式遵循 [Semantic Versioning](https://semver.org/)，日期使用
`YYYY-MM-DD`。

## [0.2.0] - 2026-08-05

该版本把 Pi UI 收敛为仅本地监听、桌面优先且可集成的 Agent Workspace，并完成
Session 隔离、Goal/Skill/File Harness、Canvas 预览和主题系统的系统性升级。

### 新增

- Session Runtime 按 Session ID 独立运行，支持后台执行、跨 Tab 恢复、未读完成提示、永久删除
  保护，以及累计多轮对话的 Cache 命中率统计。
- 新增 User Intent Contract：复杂 Goal 在执行前完成澄清、确认、替换保护与完成证据审计；
  普通任务继续直接执行。
- Skill Harness 支持 SDK 定位的渐进披露、Workspace 环境复用、URL/ZIP 分阶段安装，以及从
  Trajectory 和 Tool 调用生成 Session 内待验证 Skill 草稿，验证后再贡献至 Skill Hub。
- File Harness 新增 Session 优先搜索、授权路径门禁、安全 ZIP、目录上传、批量选择、重命名、
  删除和一致的直接下载流程。
- 新增 Dark、ZenGrid、AIDA 启动主题与中英文 typed catalog；品牌与主题解耦，并加入 AIDA/Pi
  欢迎页文案、单色语义图标和克制的等待动效。
- 项目级设计、交互、动画、GSAP、shadcn 与图表 Skills 固化在 `.agents/skills/`，并由
  `AGENTS.md` 约束其使用边界。

### 变更

- Canvas 默认使用可恢复的半屏分栏，全屏改为显式操作；Files、Artifact、Trajectory 和最终产物
  统一外层预览结构，同时保留各 renderer 的内容语义。
- 优化复杂 HTML、Mermaid、Excalidraw、Skill Hub 和模型配置的懒加载、预取、缓存、骨架与错误
  过渡，并支持桌面浏览器缩放及上下高度变化下的流式双栏布局。
- Agent Loop 删除重复 Thinking、Tool 状态和完成标签，恢复运行头像与 Tool 图标动效；Goal
  Session 使用克制结果视图，普通 Session 保留可扫描 Trajectory。
- PowerShell 成为 Windows 原生 Shell Tool，并修复中文、控制字符、截断历史输出和 Bash/
  PowerShell 分类。
- 将 Slash Context、Source Module 和 Model Configuration 合并进 `docs/ARCHITECTURE.md`；将
  Context、Session、Intent、Canvas、Theme 与 Skill/File 合同合并到 `docs/goals/` 并记录冲突裁决。
- 产品范围明确为桌面端：移除手机、触屏、coarse-pointer、移动抽屉和移动导航兼容层。

### 安全与修复

- CLI 和生产服务器只允许 `127.0.0.1`、`localhost` 或 `::1`，浏览器 API 拒绝跨来源请求。
- 为 JSON 与 Skill 导入请求增加体积上限；加强 Session/File realpath、符号链接、竞态替换和
  ZIP 路径边界。
- FIG 文本改为 React 转义渲染，Mermaid 改为严格安全级别，避免 Workspace 文件触发脚本。
- 覆盖存在安全公告的传递依赖版本；生产依赖审计不再报告已知漏洞。
- 修复 Canvas 高度不足、Files 菜单溢出、缩放横向滚动、流式预览宽度不一致，以及预览加载
  失败缺少可访问反馈的问题。

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

[0.2.0]: https://github.com/yangjingo/pi-Ui/compare/v0.1.0...v0.2.0
[0.1.1]: https://github.com/yangjingo/pi-Ui/releases/tag/v0.1.1
[0.1.0]: https://github.com/yangjingo/pi-Ui/releases/tag/v0.1.0
