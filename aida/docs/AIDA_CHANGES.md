# AIDA 改动与分支汇总

> 仓库：`C:\Users\yangjing\Project\dsh-`
> 当前分支：`codex/aida-ui-skin`

## 1. 分支情况

| 分支 | 说明 |
|---|---|
| `master` | 主分支，当前指向 `47f943859bef60e4160492346772ded9b24f765a` |
| `codex/aida-ui-skin` | 当前工作分支，从 `master` 创建，承载 AIDA UI skin / Canvas 相关改动 |
| `origin/master` | 远端主分支，与本地 `master` 同一提交 |

当前 `codex/aida-ui-skin` 尚未产生独立提交，AIDA 相关改动目前以工作区改动形式存在。

## 2. AIDA 相关改动清单

### 2.1 新增 `aida/` 目录

- `aida/slides/SLIDES.md`：AIDA 概览 slides 大纲。
- `aida/docs/slides.html`：AIDA 介绍型 HTML slides。
- `aida/docs/assets/*`：架构图、价值图、插件评测图等 SVG/Excalidraw 资源。
- `aida/plugins/aida-desktop/PRD.md`：AIDA Desktop 插件 PRD（只读，未修改）。
- `aida/plugins/aida-w3/PRD.md`：AIDA W3 插件 PRD（只读，未修改）。

### 2.2 新增 DSH 客户端 UI 插件包

路径：`packages/client/ui-aida`

包名：`@aida/aida-ui-dsh`

主要能力：

- **AIDA 视觉皮肤**：覆盖 `sidebar.brand`、`sidebar.mark`、`conversation.hero.brand`，提供 AIDA 品牌标识、slogan 和主题 token。
- **Canvas 右侧栏**：文件树、Markdown/HTML/Mermaid 预览、Trajectory、文件上传、@-mention 引用、产物预览。
- **Project 词汇**：将 Workspace/工作区 文案显示为 Project/项目。
- **内网模型**：提供 Ollama、vLLM、One API / New API、LM Studio 等内网模型预设，一键写入 provider 配置。
- **可逆性**：移除 `ui-aida` 插件入口即可恢复默认 UI 皮肤与行为。

### 2.3 插件标准格式

`packages/client/ui-aida` 符合 DSH 客户端插件标准：

- `package.json` 声明 `dsh.client.inject` 与 `platform: "web"`。
- `src/client/index.ts` 导出 `apply(ctx)`，注册 locale、theme、slots、settings 等。
- 包含 `README.md` / `README.zh.md`、测试、`tsdown` 构建配置。
- 可通过 Cordis 配置启用/禁用。

## 3. 当前修改记录

由于当前分支尚未提交，以下为工作区可见的 AIDA 相关新增内容：

- 新增 `aida/` 文档与 PRD 目录。
- 新增 `packages/client/ui-aida` 完整插件包。
- 当前仓库主分支 `master` 未包含上述 AIDA 内容。

## 4. 未修改项

- 未修改 `aida/plugins/*/PRD.md`。
- 未修改用户会话、模型配置等持久化数据。
