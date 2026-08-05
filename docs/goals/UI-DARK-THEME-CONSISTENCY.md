# UI Goal：多主题与视觉一致性

> 状态：已完成 locale/主题整改与自动化回归（2026-08-04 复核）。截图审评是历史人工证据，
> 不作为可重复的自动化基线。

## Goal Contract

建立以 Pi-inspired 灰黑主题为默认、ZenGrid 与 AIDA 为可选的统一视觉系统；统一界面语言、字体角色、配置页面和 Canvas 预览外壳，并为代码提供真实语法高亮。

完成时必须同时满足：

- 新用户默认进入灰黑主题。
- ZenGrid 暖白主题保留为启动时可配置选项。
- AIDA 作为基于 `docs/AIDA-DESIGN.md` 的真实浅色主题进入注册表，而不是仅保留品牌文案。
- 所有业务组件只消费语义 token，不硬编码主题颜色。
- 界面动作服从统一 locale：默认英文，启动时选择中文后使用统一中文；同一界面不无理由混排两种语言。
- Thinking、Tool Call、Markdown、Code 和文件预览共享一致的 Canvas 外壳。
- 代码预览按语言高亮；编辑行为与只读预览明确分离。
- Model 与 Skill 使用相同的排版角色、Canvas 壳和组件规格。

## 背景与现状

实施前的 [DESIGN.md](../DESIGN.md) 曾将 ZenGrid 暖白风格定义为唯一视觉合同，`styles.css` 也以暖白 token 为默认；当时实际代码中的阴影、keyframes 和局部视觉覆盖与该约束并不一致。当前合同已改为默认暗色、ZenGrid 可选，本段只保留历史问题背景。

实施前界面以中文为主，但 `File`、`Files`、`Canvas`、`Goal`、`Skill Hub`、`Benchmark` 等文本与中文动作混排；当时 `ui/language/format.ts` 只有基础格式化，没有语言目录或统一术语表。

Markdown fenced code 只输出语言 class，没有高亮 runtime；Code 文件直接进入 textarea；轨迹输入输出使用普通 pre。因此“都使用等宽字体”并不等于预览一致。

## 已锁定的产品决策

1. 灰黑主题是默认主题。
2. ZenGrid 保留为部署者可选主题。
3. AIDA 保留原规范的 slate canvas、white panel、indigo interaction 与 semantic state；Logo
   根据产品决策改为 indigo，不使用原稿 red-logo
   关系；与 Pi UI 共享合同冲突的弱阴影和行为差异不移植。
4. 主题与语言只在服务启动时由环境变量选择，不保存在浏览器，也不占用顶栏按钮。
5. Canvas 不再显示上一项/下一项和文件更多菜单；视觉设计必须匹配简化后的工具栏。
6. UI 与 UX 分开：本文件只规定视觉、文本、排版和组件状态，不重新定义业务流程。

## 主题架构

主题通过根节点属性选择：

```html
<html data-theme="dark">
<html data-theme="zengrid">
<html data-theme="aida">
```

CSS 结构：

```css
:root,
html[data-theme="dark"] {
  /* 默认 Pi-inspired 灰黑语义 token */
}

html[data-theme="zengrid"] {
  /* 当前 ZenGrid 语义 token */
}

html[data-theme="aida"] {
  /* AIDA canonical palette + Pi UI semantic token mapping */
}
```

禁止组件通过主题名称判断行为。组件只允许使用语义 token，例如：

- `--surface-base`
- `--surface-raised`
- `--surface-sunken`
- `--content-primary`
- `--content-secondary`
- `--content-tertiary`
- `--border`
- `--border-strong`
- `--focus`
- `--accent`
- `--success`
- `--warning`
- `--error`
- `--code-*`

### 灰黑主题方向

灰黑主题应表现为本地开发工具，而不是高饱和消费产品：

- 背景接近黑色但避免纯黑。
- 面板层级通过小幅明度差与边框表达。
- 主文本为低眩光灰白，次级文本明显后退。
- 强调色克制，只用于 focus、选择和 Agent 运行状态。
- 成功、警告、错误只用于功能状态。
- 不使用霓虹渐变、彩色 glow 或大面积品牌色。
- Canvas 网格在暗色下必须低对比，不能干扰文档阅读。

最终色值在实现时通过实际页面截图校准；本 Goal 锁定的是语义和对比关系，而不是在未验证状态下写死一组“看起来像 Pi”的颜色。

### ZenGrid

ZenGrid 保留现有暖白、Stone、Sage 的核心方向，但需要清理与设计文档冲突的局部阴影和 keyframe。ZenGrid 是主题，不再是组件实现的默认假设。

### AIDA

AIDA 是第三套完整主题。它使用 `#F6F8FB` canvas、白色 panel、slate text/border、
`#3551D8` primary/active/focus，并将 success、warning、danger 与 info 严格限制为功能状态。
AIDA 产品 Logo、欢迎页 hover、交互、选中与 Agent 运行图标统一使用 indigo；默认内容图标保持
单色中性。原稿的 Red Logo 不进入 Pi UI AIDA 主题。Mermaid 必须使用同一浅色映射。

冲突裁决：`AIDA-DESIGN.md` 的弱阴影不进入 Pi UI，因为共享 Design Contract 禁止阴影；
AIDA 原稿中的动效也不覆盖 UX 的 `<300ms`、transform/opacity-only 与 reduced-motion 合同。
所有布局、交互和 Canvas 行为跨主题保持一致。

## 主题选择

- `PI_UI_THEME` 接受 `dark`、`zengrid` 或 `aida`，缺失时使用 `dark`。
- 主题不写入浏览器 localStorage 或 Session 状态；同一服务进程的所有页面使用同一启动配置。
- 顶栏不显示主题或语言切换按钮。
- 服务端在返回 HTML 时注入主题，首屏在 React 挂载前生效，避免亮色闪烁。
- 未识别主题值回退到 `dark`。
- `PI_UI_BRAND` 独立接受 `pi` 或 `aida`。未显式配置时，AIDA 主题默认使用 AIDA 品牌，其他
  主题默认使用 Pi；显式品牌值优先，并只决定欢迎页署名。

## 界面语言

`PI_UI_LANGUAGE` 接受 `en`、`zh` 或 `zh-CN`，缺失与非法值回退到 `en`。英文是新部署的默认界面语言；中文词表作为可选 locale 保留。启动配置同时写入 `html[lang]` 与 `html[data-language]`，不允许组件自行读取 Node 环境变量。

当前实现边界：所有浏览器 UI chrome（导航、Canvas、Conversation、Files、Session、Model、Skill、配置、空/错误状态和 renderer fallback）已进入 typed catalog。历史 Session 标题、用户输入、Agent 原始输出、Tool 载荷和文件内容保留原文；Core 所有的系统分组与相对时间则在 UI 语义化，不会因历史数据造成 chrome 混语。

中文 locale 的产品动作映射：

| 当前混用 | 统一界面文本 |
|---|---|
| File / Files | 文件 |
| Canvas | 画布 |
| Goal | 目标 |
| Skill Hub | 技能中心 |
| Model | 模型 |
| Upload / Import | 上传 / 导入，按真实动作区分 |
| Download | 下载 |

允许保留的技术术语包括：

- API Key
- Base URL
- Model ID
- Provider
- Benchmark
- JSON
- Markdown
- Mermaid
- Excalidraw
- Core

可见界面的固定术语映射：

| 源码/能力名 | 用户可见文本 |
|---|---|
| Workspace | 工作区 |
| Files | 文件 |
| Canvas | 画布 |
| Goal | 目标 |
| Skill / Skill Hub | 技能 / 技能中心 |
| Thinking | 思考 |
| Tool Call | 工具调用 |
| Trajectory / Traj | 执行轨迹 |
| Agent | Agent |

这张表是中文 locale 的封闭基础词表。英文 locale 使用对应的统一英文术语；源码模块名、协议字段、日志和开发者文档不参与界面翻译。

规则：

- 同一动作不得在相邻界面分别叫“上传”“导入”“添加”，除非行为确实不同。
- 按钮使用动作词，标题使用名词。
- 英文技术术语不与重复中文翻译并排显示，例如避免“文件 Files”。
- `aria-label`、tooltip、错误提示和空状态与可见文本使用同一术语。
- 建立集中术语目录或 typed copy map，禁止继续在大型面板中随意创造同义词。
- 自动扫描或快照至少覆盖按钮、标签页、标题、菜单、空状态、错误、tooltip 和 `aria-label`；技术配置值不参与 locale 一致性断言。

目标不是扩展更多语言，而是让现有 `en` 与 `zh` 两个 locale 各自一致，不通过中英混排模拟国际化。

## 字体角色

字体按内容语义统一：

- 普通界面、按钮、中文说明、Markdown 正文：Sans。
- 标题：与主界面一致的 Sans/Headline，不允许 Model 和 Skill 各自覆盖。
- 路径、代码、命令、模型 ID、Token、时间指标：Mono。
- 大段中文说明不得使用 Mono。
- API Key、Base URL 等输入内容可使用 Mono，字段标签仍使用 Sans。

Model 与 Skill 的不同只能来自内容结构，不能来自不一致的字体、行高、边距和标题层级。

## 统一 Preview Surface

Thinking、Tool Call、Markdown、Code 和普通文件使用同一外壳：

```text
上下文/文件标题 | 状态 | 时间 | 条件动作
------------------------------------------------
内容渲染区域
```

外壳统一（只指 outer chrome，不要求 renderer body 相同）：

- 标题栏高度。
- 图标槽尺寸。
- 标题、状态和时间字体。
- 内容起始位置。
- 边框、背景和滚动行为。
- loading、empty、error 状态。
- focus 与键盘进入方式。

内容渲染器允许不同：

- Thinking：可读正文，保留换行。
- Tool Call：结构化输入/输出，JSON 格式化。
- Markdown：渲染预览与源码模式。
- Code：语法高亮预览与编辑模式。
- 图片、PDF、Mermaid、Excalidraw：使用格式专用 renderer。

“一致”指相同的结构和视觉语法，不要求所有内容都变成同一种卡片。

### Traj Shell 输入与输出

- Bash 与 PowerShell 必须显示真实 shell 类型，不能统一标成含糊的“命令”。
- 输入区显示原始命令；输出区显示合并后的 stdout/stderr，并保留多行，不再只取首行摘要。
- ANSI、NUL 与不可见终端控制字符在进入 Canvas 前规范化。
- 已发生替换字符或上游字符损失时显示 encoding warning；历史记录中已经变成 `?` 的字符不能伪造恢复。
- PowerShell 新调用必须通过 Core 原生 UTF-8 通道进入 Traj，避免 Bash/WSL 边界在渲染前丢失中文。
- 实时 `tool_execution_update` 与最终结果使用相同 renderer，避免运行中空白、结束后才突然出现内容。

## 代码高亮与编辑

### 只读预览

- 根据文件扩展名或 fenced code language 选择语言。
- 未识别语言回退为纯文本，不报错。
- 高亮主题必须同时适配 dark 和 zengrid。
- 高亮 runtime 懒加载，不能显著增加首屏 bundle。
- 大文件设置明确上限，超过后使用虚拟化、截断提示或纯文本回退。
- 复制得到原始代码，不包含行号或高亮 DOM 文本。

### 编辑

- Markdown 和 Code 都提供明确的“预览 / 源码”模式。
- 进入源码模式才创建编辑器。
- 若保留 textarea，语法高亮仅用于只读预览。
- 若引入 CodeMirror 6，必须按需加载，并验证输入法、撤销、Tab、查找、只读和大文件行为。
- 不引入 Monaco，除非后续明确需要 IDE 级语言服务；本 Goal 不包含自动补全或 LSP。

## Model 与 Skill 视觉一致性

- 共用 `ConfigWorkbench` 外壳。
- 共用 master list、primary create row、详情 heading、状态 badge、表单、Files toolbar 和底部 action bar。
- Model 配置值和 Skill 文件内容可以使用 Mono；普通说明统一 Sans。
- Model Files 和 Skill Files 的路径栏、计数、上传位置、空状态和编辑器边距一致。
- “Workspace 根目录”迁出模型创建入口后，左右面板的垂直节奏不再依赖人为补齐行数。

### 性能加载面的视觉合同

- Model、Skill 和 HTML Canvas 的 loading 使用目标页面真实几何，不用居中的全局 spinner。
- 骨架块只使用语义 surface/content token；1200ms opacity 呼吸只在异步工作未完成时存在。
- 内容 ready 后用 160ms opacity 收束，不移动布局；`prefers-reduced-motion` 下骨架保持静态。
- Theme Goal 只拥有这些 loading 面的 token、节奏与 reduced-motion；缓存、预取、iframe ready
  和 30fps 行为分别归 Workspace/Canvas 的实现与 Canvas Goal 所有。

## Motion 与 Accessibility

- 动画只使用 `transform` 和 `opacity`；有限交互 transition 时长不超过 300ms。
- 真实异步运行状态的连续指示可使用 900–1800ms 循环，但必须随状态立即取消，并在 reduced-motion 下静止；其具体出现位置和行为由 Agent Loop Goal 定义。
- 频繁键盘操作不使用位移动画。
- 禁止新增不可中断的装饰性 keyframes；Loop Pet 的 ASCII 帧使用可取消计时器推进，CSS 只负责不超过 300ms 的出现与消失 transition。
- `prefers-reduced-motion` 下移除移动与循环动画。
- dark、zengrid 与 aida 均满足可见 focus 和文本对比要求。
- 普通文本与背景对比度至少达到 WCAG AA 4.5:1；大文本至少 3:1；焦点、边框和非文本交互组件至少 3:1。
- hover 效果必须有键盘 focus 等价状态；产品不承诺触屏或 coarse-pointer 交互。
- 语义状态不能只通过颜色区分。

## 验收标准

1. 首次打开应用默认使用灰黑主题，且无亮色闪屏。
2. `PI_UI_THEME=zengrid` 或 `PI_UI_THEME=aida` 启动时使用对应主题；页面刷新后继续服从同一服务启动配置。
3. 三个主题下所有主页面、弹层、Canvas renderer 和配置页面不存在硬编码错误主题背景。
4. 可见按钮和导航不存在无理由的中英重复标签。
5. Model 与 Skill 的共享结构使用相同字体角色、间距和状态组件。
6. Thinking、Tool Call、Markdown 和 Code 使用统一 Preview Surface。
7. TypeScript、JavaScript、JSON、CSS、HTML、Shell、Python 和 Markdown fenced code 至少具有可验证的语法高亮。
8. 未识别语言、大文件和高亮加载失败均有纯文本回退。
9. dark、zengrid 与 aida 均通过键盘 focus、桌面布局和 reduced-motion 检查。
10. `DESIGN.md` 与 `UX.md` 更新为新的主题与运动事实，不再描述已经不存在的唯一 ZenGrid 合同。
11. 固定术语表在按钮、标题、菜单、状态、tooltip 与 `aria-label` 中一致，扫描/快照不存在当前 locale 之外的无理由混排。
12. dark、zengrid 与 aida 的关键页面通过 WCAG AA 对比度检查和已评审视觉截图。
13. 欢迎页 Slogan 形成单一视觉锁组；首次进入使用不超过 220ms 的 transform/opacity 过渡，
    Composer 不延迟，reduced-motion 不产生位移。

## 验证

- UI 模块测试：启动主题/语言解析、术语映射、代码语言识别。
- Canvas 测试：Preview Surface、代码高亮和编辑切换；截图只作为人工审评，不属于自动化基线。
- E2E：dark/zengrid/aida 启动配置、首屏防闪烁、默认英文、可选中文和 Model/Skill 一致性。
- 对三个主题分别执行 1280px 以上桌面、键盘和 reduced-motion 验证。
- `pnpm typecheck`
- `pnpm test:ui`
- `pnpm test:canvas`
- `pnpm test:e2e`
- `pnpm build`

### 本次实施结果

- `index.html` 静态声明 `data-theme="dark"`；服务端按 `PI_UI_THEME` / `PI_UI_LANGUAGE` 注入启动配置，并在 React 挂载前生效。非法或缺失值回退到 `dark` + `en`，避免首屏亮色闪烁。
- 顶栏不提供主题或语言切换按钮，浏览器 localStorage 不再决定主题。
- `styles.css` 以灰黑语义 token 为默认，并在 `html[data-theme="zengrid"]` 下保留暖白覆盖；滚动条、scrim、状态色与代码色均通过 token 表达。
- 建立 `UI_LOCALES` typed catalog 和 `UI_THEMES` registry；新语言必须在编译期实现完整 key 集，新主题必须通过语义 token 完整性测试。
- 全量迁移 Conversation、Canvas、Files、Session、Model、Skill、Report 和 renderer 可见文案；Traj 标题根据 `step.t` / `step.shell` 语义渲染，不再展示历史中英文混排标题。
- 文件导入由 Workspace 返回结构化结果，Canvas 负责 locale 渲染；Session 系统分组和“刚刚”仅翻译 chrome，不改写会话标题与历史内容。
- Traj Canvas 使用居中的 920px 阅读列、有界桌面外边距和内容面；步骤头缩小字号并拉开图标/标题/时间；配置 Canvas 增加 18–30px 内边距与 960px 内容边界。
- 新增零依赖语法高亮器，覆盖 TypeScript、JavaScript、JSON、CSS、HTML、Shell、Python、Markdown 与 YAML；未知语言和超过 200,000 字符的内容安全回退为纯文本。
- Code 文件默认进入高亮只读预览，用户显式切到“源码”后才挂载 textarea；保存后回到预览。Markdown fenced code 复用相同的语义 token。
- Model 与 Skill 继续共用 `ConfigWorkbench`，Files/Canvas 标签、标题层级和字体角色在两个 locale 下使用同一规格。
- 添加 AST 可见文案审计、主题 token 完整性/硬编码颜色审计与 WCAG AA 对比度检查；ZenGrid 的次要文字色因此调整到合规范围。
- `DESIGN.md` 已从“唯一 ZenGrid 合同”改为“灰黑默认 + ZenGrid 可选”；`UX.md` 同步新主题事实。

### AIDA 主题扩展结果（2026-08-04）

- `aida` 已进入 Core 启动 allow-list 与 UI 主题注册表，使用 light `color-scheme`。当
  `PI_UI_THEME=aida` 且没有显式品牌配置时，Core 默认注入 `data-brand="aida"`；显式
  `PI_UI_BRAND=pi` 仍可覆盖。
- AIDA canonical palette 作为 `--c-*` 保留，并映射到共享 Pi UI semantic tokens。页面使用
  slate canvas + white panel，Logo、欢迎页 hover、按钮、focus、选中与 Agent running 使用
  indigo；普通内容图标保持中性，danger/error 使用独立语义色。
- Mermaid 增加独立 AIDA light palette；Model、Skill、Files、Conversation 与 Canvas 继续消费
  同一组件和交互实现，没有主题分支行为。
- 首页 Logo 与 Slogan 合并为单一视觉锁组；`Pi Cooks. You Look busy` / `AIDA Cooks. You Look
  busy` 使用 220ms `ease-out` opacity + transform 首次入场。Composer 不参与延迟；
  reduced-motion 只保留 160ms opacity。
- AIDA 原规范的弱阴影未移植，因为它与 Pi UI flat workbench 合同冲突；原规范中不满足当前
  motion 约束的动画也不移植。这两项裁决已经同步至 `DESIGN.md` 与 `UX.md`。

验证快照（2026-08-04）：

- `pnpm typecheck`：通过。
- `pnpm test:modules`：97/97 通过。
- `PI_UI_THEME=aida pnpm test:e2e`：37/37 通过。
- `PI_UI_THEME=aida pnpm test:canvas`：20/20 通过。
- 默认 dark `pnpm test:e2e`：37/37 通过。
- `pnpm build`：通过；保留现有 Mermaid 延迟 chunk 大小提示，无新增构建失败。

历史验证快照（2026-08-01）：

- `pnpm typecheck`：通过。
- `pnpm test:modules`：80/80 通过。
- `pnpm test:ui`：17/17 通过，含 locale key、可见文案、主题 token、原始颜色与 WCAG AA 审计。
- `pnpm test:canvas`：17/17 通过。
- `pnpm test:e2e`：34/34 通过。
- `PI_UI_THEME=zengrid PI_UI_LANGUAGE=zh-CN` 的启动 E2E 通过；默认 `dark + en` 同样通过。
- Playwright CLI 已对 dark/英文的 Traj Thinking、Shell、Model Canvas，以及 ZenGrid/中文的 Model Canvas 完成实机截图审评。
- `pnpm build`：通过。

当前全仓数量与可重复证据边界见 [Goals 审计索引](./README.md)；以上数量是当次历史快照。

### 已决策（2026-07-31）

1. 代码高亮继续使用当前轻量、同步、零依赖 tokenizer，不引入 Monaco、CodeMirror 或 Shiki。除非未来出现明确的嵌套语法、行号或增量编辑需求，否则不升级为 IDE 级高亮引擎。
2. 不建设跨平台截图基线，也不为 Windows/macOS/Linux 维护像素级一致性。主题质量继续由语义 token、组件状态测试和当前 Chromium E2E 覆盖；不引入字体和像素容差矩阵。
3. 顶栏主题图标删除。主题、语言与集成品牌分别由 `PI_UI_THEME`、`PI_UI_LANGUAGE`、
   `PI_UI_BRAND` 在服务启动时配置，默认 `dark` + `en` + `pi`；浏览器旧有
   `pi.ui.theme` 值不再生效。
4. 欢迎页只保留一句主张：Pi 品牌为 `Pi Cooks. You Look busy`，AIDA 品牌为
   `AIDA Cooks. You Look busy`；中文 locale 统一为“告诉 Pi，然后假装很忙。”。

### Agent 回答视觉规格的所有权

回答头像、操作菜单、指标顺序、Shell Canvas、Loop Pet 和 Conversation rail 的交互合同只由
[UX-AGENT-LOOP-RESTRAINT.md](./UX-AGENT-LOOP-RESTRAINT.md) 定义。本文件只拥有这些组件使用的
主题 token、字体角色、focus、对比度和 reduced-motion 规则，不复制第二套尺寸与行为清单。

### 一致性补充（2026-08-01）

- Composer 的 `Attach` 收敛为 `File`（中文为“文件”）；Composer、Files、Skill、Model 配置和拖放区域统一使用 `FileUploadIcon`。目录选择继续使用 folder icon，保留“文件/目录”的语义差异。
- Agent Flow 的 Thinking 默认折叠，正文不在折叠状态挂载；只有用户主动展开后才显示并跟随流式内容更新。
- 最终回答及 `agent-artifacts` 与 Traj Canvas 共用 `--content-reading-max: 920px`，禁止分别维护相近但不一致的宽度常量。
- 自动化合同覆盖 File 入口图标、Thinking 折叠交互和回答/Traj 阅读宽度一致性。
- 2026-08-02 完成流式刷新收敛：连续 `text_delta`、`thinking_delta`、`tool_update`
  按 32ms 合并为一次 Agent Store 通知；边界事件同步提交。`AgentFlowStep` 使用稳定
  handler 与 `memo`，未变化步骤不再跟随当前 Thinking 重渲染。

## 非目标

- 翻译历史 Session、Agent 原始输出或用户文件内容。
- 用户自定义任意主题编辑器。
- IDE 级 LSP、自动补全和调试器。
- 用视觉统一改变 Workspace/Core 的业务边界。
- 为了“深色感”引入高饱和霓虹或无功能意义的动画。
