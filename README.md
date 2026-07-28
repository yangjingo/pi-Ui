# Pi UI

本地优先的 Pi Agent Workspace。浏览器 UI、Node Core、Harness、Canvas 和 Workspace
保持清晰的内部边界，但统一发布为一个 `@whyj/pi-ui` npm 包。

## Quickstart

需要 Node.js 20 或更高版本。

```bash
npm install --global @whyj/pi-ui
cd /path/to/your-project
piUi install
```

`piUi install` 会在当前目录创建 `.workspace/`、启动 UI 和 Core API，并自动打开
`http://127.0.0.1:4173`。按 `Ctrl+C` 停止。

不想全局安装时：

```bash
npx --yes @whyj/pi-ui@latest install
```

如果本机已经使用过 Pi，首次启动会自动继承 `~/.pi/agent` 中的默认模型、认证和历史
Session；无需重复填写 API Key。没有现有 Pi 配置时，再从顶部“模型配置”添加模型。

## 常用命令

再次启动或诊断前，先回到初始化时的项目目录；也可以通过 `--cwd <项目目录>` 指定。

```bash
piUi install                         # 初始化并启动
piUi start                           # 再次启动
piUi doctor                          # 检查环境和配置
piUi doctor --json                   # 输出 JSON 诊断结果
piUi start --cwd ./work --port 4317  # 指定目录和端口
piUi --help
piUi --version
```

免全局安装时，将 `piUi` 替换为 `npx --yes @whyj/pi-ui@latest`。

## 核心能力

- Pi Agent 对话、Thinking、Tool 轨迹和 Goal 工作流。
- 本地 Session、模型、Skill、文件与 Canvas 管理。
- Markdown、Mermaid、Excalidraw、SVG、HTML、PDF、Office 和代码预览。
- 浏览器只通过 `/api/*` 使用 Core；Pi SDK、凭据和文件系统保留在 Node 端。

## 本地数据

运行数据默认保存在启动目录的 `.workspace/`：

- `.workspace/.agentcore/`：模型、凭据和 Core 设置。
- `.workspace/.agentcore/inherited-sessions/`：从已有 Pi Session 创建的可继续分支。
- `.workspace/<session-id>/`：Session、生成文件和 Canvas 产物。
- `.workspace/skills/`：本地 Skill。

`.workspace/` 不会进入 Git 或 npm 发布包。不要把 API Key 写入 `VITE_*` 变量或提交到
Git。继承时只读取 Pi 的全局凭据；继续历史 Session 会创建私有分支，不改写原始 JSONL。

## 开发

Windows 下使用 pnpm：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test:modules
pnpm build
```

构建产物：

- `dist/`：浏览器 UI。
- `dist-node/`：CLI、Core server、Harness 和 Pi runtime。
- `bin/pi-ui.js`：`piUi` / `pi-ui` 命令入口。

发布前检查：

```bash
npm pack --dry-run
npm whoami
npm publish --access public
```

架构说明见
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) 和
[`docs/SOURCE-MODULE-DESIGN.md`](./docs/SOURCE-MODULE-DESIGN.md)。
