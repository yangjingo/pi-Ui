# @aida/aida-ui-dsh

[English](README.md) | 中文

> 本仓库内容由 `git@github.com:yangjingo/pi-Ui.git` 的 `aida-dsh` 分支
> （提交 `79b72eb`）迁移而来，现于
> `ssh://git@codehub-dg-g.huawei.com:2222/y00842095/aida-ui-dsh.git` 的
> `master` 分支上维护与更新。

设计与维护入口：[AIDA UI 设计语言](docs/design-language.md)、[集成文档](docs/README.md)和[代理协作规范](AGENTS.md)。UI 改动由项目内置的 TASTE 与 Amicro 技能共同约束，并以 DSH 原生组件和语义 token 为最终实现基线。

AIDA 是 dsh Web 客户端的纯浏览器端部署皮肤与画布。主界面保留 PIUI 现有的新会话布局，通过 `sidebar.brand` 与 `sidebar.mark` 把展开和收起侧边栏的图形替换为同一个 AIDA Logo，并通过 `conversation.hero.brand` 把新会话品牌组合替换为 `Logo | AIDA`、`DELIVERY INTELLIGENCE` 定位语、本地化项目交付标语与“预览版”标签。它只改变呈现：agent 组合、工具、提示词、会话行为与持久化数据都不受影响。

这套视觉身份在亮色表面使用提供的 `assets/brand-logo-light.svg`，在深色表面使用 `assets/brand-logo.svg`。侧边栏只渲染这一图形。新会话 Banner 用细分隔线把图形与 AIDA 身份块并排，AIDA 名称下方显示 `DELIVERY INTELLIGENCE`，品牌组合下方再显示本地化项目交付标语和紧凑的“预览版”胶囊。`assets/aida-wordmark.svg` 继续作为提供的品牌源文件保存，响应式 Banner 则使用实时文本，以便本地化并适配窄视口。其余 AIDA 配色继续消费由 `theme.ts` 持有的语义化 `--dsw-*` 变量。

会话打开首次历史页时，插件会把会话包的纯文字加载 fallback 替换为居中的双轨圆形信号。内外圆轨使用当前 AIDA 品牌色反向旋转，同时保留本地化的“载入历史…”状态；启用 `prefers-reduced-motion: reduce` 时圆轨保持静止，移除插件则恢复会话包的 fallback。

## AIDA 鲸鲸

本分支只携带一套 DSH Pet：`healing-whale-hit`（鲸得起打）。AIDA bundle 启用官方 `@linxin666/dsh-pet` runtime，不分叉 renderer，也不复制它对会话和工具事件的状态投影。鲸鲸的图集、manifest、voice pack 与素材说明位于 `assets/pets/healing-whale-hit`；来源集合中的其他宠物不会进入本包。

重启 Web 前，把鲸鲸安装到当前 DSH home：

```powershell
node .\scripts\install-whale.mjs
dsh web
```

如果安装的是归档包，可在 Web profile 内执行其命令（`pnpm --dir <DSH_HOME>/profiles/web exec aida-install-whale`）。随后在 Settings → Pet 选择“鲸得起打”，也可通过 Pet API 切换。鲸鲸跟随 DSH runtime phase 变化，减少动态效果时服从 Pet runtime 的静态降级，并保持在 React 所有的画布布局之外。

插件会把自己的品牌 token 层叠加到用户选择的亮色、深色或跟随系统主题之上，因此现有“外观”偏好仍然可用。移除 `ui-aida` 客户端条目会撤销 token、语言与 slot 注册，恢复中性的 PIUI 侧边栏图形。通用外壳仍持有全部交互行为：侧边栏折叠与展开、New Session、Workspace 选择及输入区行为都不会被替换。

## AIDA 画布

在 AIDA 部署下，会话头部操作区（会话日志按钮旁）出现画布开关 —— 一个与侧边栏 logo 行面板开关一致的纯图标按钮（28px 圆形、tooltip/aria 标注；无文字标签），图标为第一版画布标记：圆角方环内嵌 2×2 小方块网格，与图标集一致的圆角风格。点击后画布作为框架的**右侧 details 轨道**打开 —— 真正的左右平铺：对话区自动收窄、从不被遮挡，列宽可像内置详情面板一样拖拽调整且**没有固定最大宽度**（窄视口下由中间栏下限约束），关闭即恢复布局。头部**右上角的全屏图标**把画布扩展到占据整个对话区 —— 框架网格把中间栏轨道收为零，对话区**真正收窄**（绝不是被覆盖），最大化期间窗口尺寸变化会重算覆盖网格、画布持续占满剩余区域，翻转的全屏图标还原三栏布局。画布占据 `details` 席位（比内置「工具详情」面板更低的遮蔽优先级），移植自 Pi Canvas 功能集：

- **文件** —— 会话工作区的递归文件树（跳过隐藏与工具目录），支持搜索、逐行重命名/删除、Ctrl/⌘+点击与 Shift+点击多选（批量打开/引用/删除）、右键行菜单、树内拖拽移动（`host.moveFile` 动词）、拖拽导入与文件/文件夹选择器。
- **画布** —— 打开的文件页签，按格式渲染与编辑：
  - **Markdown**（`.md`/`.markdown`）渲染为格式化 GFM 文档（复用共享的 `MarkdownText` 渲染器，代码围栏带语法高亮）；点击「编辑」切换为源码文本框，Ctrl/⌘+S 通过宿主保存。
  - **HTML**（`.html`/`.htm`）在带 `allow-scripts` 沙箱的 iframe 中渲染；同样的「编辑」开关编辑源码。
  - **Mermaid**（`.mmd`/`.mermaid`）通过懒加载的 mermaid 运行时渲染图表（不进入主包）；图表损坏时回退为源码并显示失败信息。
  - **SVG**（`.svg`）以渲染视图预览（宿主按图片分类，读取返回 base64）；同样的「编辑」开关编辑解码后的 UTF-8 源码，保存写回文本并在原地刷新渲染视图。
  - **JSON**（`.json`/`.jsonl`）以共享的可折叠 `JsonTree` 渲染（逐节点复制操作，文案本地化）；无法以树形展示的内容回退为原始文本并给出提示。
  - **CSV/TSV**（`.csv`/`.tsv`）渲染为表格（支持 RFC-4180 引号）。
  - **源代码**（`.py`、`.ts`/`.js`、`.rs`、`.go`、`.css`、`.xml` 等）经共享的 shiki `CodeBlock` 按扩展名语法高亮渲染，带复制按钮。
  - 其他文本文件使用纯文本面板；图片、PDF、Office（提取的文本/表格预览）与二进制下载预览补全表面。
- **轨迹** —— 轨迹表面：中间栏轨迹视图被隐藏（AIDA 界面皮肤），本页签在画布内渲染**完整的原版 ui-trajectory 视图** —— 工具栏（回合/调用/输入/模型/工具）、时间线以及带 JSON 载荷的记录表格；点击记录就地展开其输入与输出。画布经共享的 `conversation.view` 席位渲染它（`renderSlot` 配 `only: 'trajectory'`）；ui-trajectory 缺席时回退到画布自有的 **turn/call 台账** —— 从会话快照折叠，每个回合头（“第 N 回合”）聚合其工具调用，回合头可折叠/展开，点击调用打开其详情（参数 + 输出 + 产物文件）并可返回。工具栏带 **会话日志** 下载按钮（接到 `sessionLogDownload` 服务）；页签顺序为 文件 / 轨迹 / 画布，各带计数。调用详情即合并进来的工具详情视图：画布遮蔽了内置详情面板，工具检视在这里完成，点击对话里的工具行会打开画布列。
- **联动** —— 头部开关打开画布列；每条助手消息收尾处的产物文件 chips 改为在画布中打开，而非走宿主 OS 打开器；面板的 ✕ 关闭画布列。画布列、开关与 chips 共享同一个逐会话 store；列的开合由框架 details 轨道状态（`ctx.layout`）管理。
- **@ 引用到输入框** —— 项目文件是输入栏的一个 `@` 引用源（菜单分组「文件」，排在内置子代理引用源之前）：输入 `@` 会列出当前会话的文本文件，选中后插入一个 `@路径` chip，其模型形式在提交时内嵌文件内容。文件行操作 **引用到输入框** 为所选文件插入同一 chip；画布预览区的 **引用** 按钮把当前选中内容（编辑区文本框选区，或渲染预览选区）作为带来源路径标注的引用块插入 —— 没有选区时回退为整文件 chip。连续引用同一文件且其间没有输入变化时去重（第二次插入为空操作）。选取与注入都经由会话输入服务的逐会话输入壳完成，画布列从不直接触碰输入机。

画布通过六个仅限 loopback 的宿主方法（`host.listFiles`、`host.readFile`、`host.writeFile`、`host.renameFile`、`host.moveFile`、`host.deleteFile`）读取文件，它们暴露在运行时 `IWorkspaces` 面上。宿主只接受 Workspace 注册表中的根目录，随后规范化每个目标并拒绝路径逃逸；浏览器请求不能指定任意宿主目录。切换会话会中止进行中的列表、读取与上传请求，并在渲染新 Workspace 文件树前清除浏览器本地进度。轨迹与会话事实来自会话快照，不新增线上方法。移除 `ui-aida` 条目即撤下画布列、开关与 chips；内置「工具详情」面板恢复 `details` 席位，中间栏轨迹视图与头部下载按钮回归，所有其他组件回到中性 UI。

## AIDA 界面细节改动

除品牌图形与画布外，AIDA 部署还调整了两处界面细节（移除 `ui-aida` 条目即可全部还原；实现见 `src/client/skin/chrome.ts`）：

- **轨迹表面与会话日志下载归画布所有。** 中间栏轨迹视图 —— 整条视图环页签导航（轨迹页签消失后只剩一个「对话」页签，因此整条导航被移除）与已挂载的视图本体 —— 被隐藏；会话头部“Session log”导出按钮（由 `dsh-session-log-export` 注册到 `conversation.session.header.utilities`，按标签匹配以保住同席位的画布开关）同样被隐藏。画布轨迹页签渲染轨迹并托管下载按钮（React 自有节点，接到 `sessionLogDownload` 服务）。React 自有节点从不被移动：被隐藏的节点保持挂载、只切换 display。
- **工作区词汇改为“项目”。** 在侧边栏工作区区域（`sidebar.workspaces`）与新会话工作区选择器（`conversation.hero.workspace`）中，“Workspaces”/“工作区”渲染为“Projects”/“项目”（含“Add workspace”/“添加工作区”→“Add project”/“添加项目”，以及对应的 aria-label/title/placeholder 属性）。文本由同一 observer 就地改写，React 在文案不变时的重渲染会保留“项目”字样；底层数据模型、RPC 方法名与设置项仍叫 Workspace。画布文案遵循同一词汇（“搜索项目文件”“当前会话没有项目”）。

## AIDA 内网模型

插件附带一个设置页签 **内网模型 / Intranet models**，内置一组内网部署模型预设 —— Ollama、vLLM、One API / New API 网关与 LM Studio —— 每个都是 OpenAI 兼容提供方配置（协议 `openai-completions`、默认本机端点与默认模型列表）。一键把预设写入 `llm-pi-ai` 设置 namespace 的 `providers.<route>` —— 与模型设置页自定义提供方卡片执行的 `settings.mutate` 相同 —— 之后该提供方及其模型即出现在输入栏模型选择器中。端点默认本机（`127.0.0.1`）；安装后在模型设置页改为实际内网地址与模型列表，需要密钥的网关在模型设置页的凭证字段填写。安装写入带 revision 校验，其他表面同时声明同一路由会被拒绝而不会覆盖；移除 `ui-aida` 条目即撤下该设置页签（已安装的提供方仍保留在设置中，直到在模型设置页删除）。

## 插件库条目

本包是 AIDA 视觉身份与画布在 DSH 插件库中的可复用单元。包清单同时声明浏览器插件与可安装的 `dsh.bundle` 层；安装该包会把以下 Cordis 条目作为一个由本包持有的可移除层加入部署：

```yaml
- id: pet
  name: '@linxin666/dsh-pet'

- id: ui-aida
  name: '@aida/aida-ui-dsh'
```

通过 DSH 插件命令安装构建后的 tarball 或本地 checkout；CLI 会把本包加入所选 profile 的 bundle 栈：

```sh
dsh plugin --profile web add ./aida-aida-ui-dsh-0.1.0-rc.11.tgz
pnpm --dir <DSH_HOME>/profiles/web exec aida-install-whale
pnpm dsh plugin --profile web add ./packages/client/ui-aida
```

激活后的部署会在 **设置 → 插件 → 插件列表** 中列出 `pet` 与 `ui-aida`。`dsh plugin --profile web remove @aida/aida-ui-dsh` 会移除 AIDA bundle 条目与浏览器贡献，但不改变已存会话，也不删除通过“内网模型”页签安装的模型提供方设置。该归档需要匹配的 DSH Web 构建提供上文六个 Workspace 文件方法。

## 模型体验

通过画布插入的 Workspace 文件引用间接影响模型：`@路径` 引用会把有长度上限的文件内容嵌入所提交的提示词，引用选中内容则会把字面文本作为带来源标注的引用块插入；除此之外，AIDA 文案与画布状态都不会进入模型请求。

#### KV Cache 影响

无；该插件不组装提供方输入。

## 已知限制与暂缓事项

- **深色模式保留中性表面配色**：AIDA 当前会适配品牌强调色，而不替换每一项深色表面 token。
- **文件页签尚无多选 ZIP 操作**：重命名与删除一次只作用于一行；本次集成不包含 Pi 的多选归档流程。
- **Office 预览仅为文本/表格**（无版式保真），画布侧“在聊天中定位”高亮尚未交付。
- **会话重挂载后引用退化为字面 `@路径` 文本**：与内置子代理引用一致，文件引用的 chip 只存在于实时输入状态；跨会话切换或刷新后持久化的草稿只保留剪贴板文本（`@路径`），提交时发送该字面量而非重新内嵌文件。
- **工具详情接管为文本级**：画布列遮蔽内置详情面板，其轨迹步骤详情展示参数、输出文本与产物文件，但按工具定制的卡片渲染（终端、代码查看器等）不会移入画布列；点击对话中的工具行会打开画布列，但不会自动选中轨迹中的对应步骤。
- **中间栏轨迹视图被隐藏**：画布轨迹页签才是轨迹表面；工具行 “inspect” 动作若激活被隐藏的中间栏视图，中间栏会留白（画布轨迹页签一步可达）。

## 本地开发说明（2026-08-26）

- **背景由 web 部署提供，而非插件托管**：`aida-dsh-pets` 合并后替换了
  atmosphere 背景图（`assets/aida-background.png`，SHA-256 `5C96D6…`）并移除了
  插件侧的 `/aida-background.png` 路由；部署的 dsh web 静态根目录携带同一图片
  （`apps/web/dist/aida-background.png`）。
- **不再需要 dsh 源码补丁**：合并后的客户端自带重定位的 `TrajectoryView`，不再
  引用 `@deepseek-ai/dsh-client-ui-trajectory` 内部实现，`deepseek-harness`
  保持上游干净。`integration/ui-trajectory-public-exports.patch` 仅作为历史参考保留。
- **鲸鱼宠物（鲸得起打）**：`scripts/install-whale.mjs` 将 `healing-whale-hit`
  安装到 `$DSH_HOME/pets` 并设为默认选择（不覆盖用户显式选择的其它宠物）。
  本地测试：`pnpm test`（独立 `tsconfig.base*.json` + `vitest.config.ts`）。
