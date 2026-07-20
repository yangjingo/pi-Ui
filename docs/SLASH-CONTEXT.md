# Slash 触发与 Agent 上下文注入设计

输入框里只有两个 slash 触发符：

| 触发符 | 来源 | 含义 |
|--------|------|------|
| `/` | SkillHub（用户上传 / 预置） | 可复用的提示词片段（skill = 一个文件目录） |
| `@` | 当前 workspace 的文件 | 引用某个数据产物 |

两者的本质都是同一件事：**把外部「上下文」注入到即将发给 agent 的消息里**。本文说明它们的触发、注入、与 agent 上下文的管理方式，以及背后的设计取舍。

---

## 1. 架构分层

应用是两层结构（Core + UI/UX）。这两个触发符刻意落在不同层：

```
┌─────────────────────────────────────────────────────────┐
│  UI/UX 层（浏览器）                                       │
│                                                          │
│  src/skills.ts            skill store（localStorage）    │
│  src/components/SkillHub.tsx   整页视图：列表 / 上传 /    │
│     └─ 右栏文件浏览器（预览 / 改写 / 增删文件）           │
│  src/components/Conversation.tsx                         │
│     └─ mention 检测 + 菜单 + 注入（/ 与 @ 共用）         │
│  src/workspace.tsx                                       │
│     └─ sendMessage：把 @文件 展开为内容 ← UI→Core 唯一出口│
└─────────────────────────────────────────────────────────┘
                          │ agentClient.prompt(text)
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Core 层（Node，Pi agent SDK）                            │
│     收到的是「已展开、自包含」的纯文本 prompt             │
└─────────────────────────────────────────────────────────┘
```

- **skills 是纯 UI 数据**：存 `localStorage`（`src/skills.ts`），不经过 Core、不需要 Pi。每个 skill 是**一组文件**（`{ id, name, desc, files: Record<path, content> }`），以 `SKILL.md` 为入口（YAML frontmatter `name`/`description` + 正文），可带若干支撑文件（`references/*.md`、`assets/*.html` 等）——即 Claude Code 的 SKILL 包格式。用户可在无 agent 时也能管理/引用。
- **@文件 来自 Core 产物**：文件树（`active.files`）和文件内容（`getFileContent`）都是 Core 通过 `agentClient` 推到 UI 的 session 状态。
- **唯一的注入出口**：`workspace.tsx` 的 `sendMessage`。Core 永远只收到一段纯文本，不需要知道 `/` 或 `@` 的存在。这保证边界干净、Core 可独立替换。
- **分层契约（实测）**：浏览器 bundle 里**没有任何** `@earendil-works/pi-coding-agent` 的 import——Pi 只存在于 `core/pi/runtime.ts`，且不可从 `src/` 触达。`core/types.ts`、`core/util.ts` 是文件头标注「No React, no Node, no Pi」、**刻意供 Core 与 UI 共享**的纯领域层（类型与无副作用的纯函数，如 `buildFileTree`/`findFileInSession`）；`src/agentClient.ts` 是动作/事件 seam（只 `import type` 自 `core/agent`、`core/types`，构建期擦除）。换句话说：`agentClient` 是唯一的**运行时动作/事件**边界，`sendMessage` 是唯一的 **prompt 注入**出口。

---

## 2. 触发检测：统一的 mention 系统

`/` 和 `@` 共用一套机制（一个 state、一个菜单、一套交互），仅按触发符切换数据源。

### 状态
```ts
type Mention = { trigger: '/' | '@'; at: number; query: string } | null;
```
- `at`：触发符在输入文本中的索引（用于选中后精确替换 `/词` 或 `@词`）。
- `query`：触发符之后到光标的文本，用于过滤。

### 检测（在 `onChange` 里，基于光标位置）
```ts
const m = v.slice(0, pos).match(/(?:^|\s)([\/@][\w一-龥.\-]*)$/);
```
只认「行首或空格之后紧跟 `/` 或 `@`」开头、到光标为止无空格的 token。这样 `https://`、`a/b`、邮箱里的 `@` 不会误触发。

### 数据源切换
- `trigger === '/'` → 从 `useSkills()` 过滤（按 name / desc 模糊匹配，取前 6）。
- `trigger === '@'` → 从 `active.files` 扁平化后过滤（按文件名，取前 8），每项带类型图标。

### 交互
- 菜单项：图标（skill 用 `spark`，文件用类型图标）+ 名称（`/name` 或 `@name`）+ 描述。
- `Enter`：选中第一项（最常见路径：打 `/词` 直接回车）。
- `Esc`：关闭菜单。
- 点击：选中该项。

---

## 3. 注入语义（核心差异）

这是整套设计里最关键的取舍：**两个触发符选中后的注入方式不同**。

### `/` skill → 直接注入内容
选中后把该 skill 的 **SKILL.md 正文**（`skillEntryBody`，即去掉 frontmatter 后的内容）注入输入框，替换掉 `/词`：
```
/翻<Enter>   →   请将以下内容在中文与英文之间互译，保持语气、术语与格式一致：
```
用户在输入框里**看得见、可继续编辑**这段提示词，可以再拼接自己的内容后发送。

> 注入范围：`/` 只注入 **SKILL.md 的正文**（`skillEntryBody`）。skill 目录里的支撑文件（`references/*.md`、`assets/*.html` 等）可在 SkillHub 右栏浏览/预览/改写，但**不会**随 `/` 自动注入——它们是给作者组织素材用的；要让 agent 读到某个支撑文件，把它放进工作目录后用 `@` 引用。

### `@` 文件 → 注入标记，发送时展开
选中后只注入一个 `@文件名` 标记，不把文件内容塞进输入框：
```
@REA<Enter>   →   @README.md 请总结这份文档
```
真正的文件内容在 `sendMessage` 发出前才展开：

```ts
// workspace.tsx
const expanded = text.replace(/@([\w一-龥.\-]+)/g, (full, name) => {
  const f = findFileInSession(active, name);
  if (!f?.path) return full;                 // 找不到 → 保留原文
  const content = getFileContent(f.path);
  return content
    ? `\n\n（引用文件 ${name}）\n${content}\n`
    : full;                                  // 无内容 → 保留原文
});
agentClient.prompt(expanded);
```

最终 Core 收到的是：
```
请总结这份文档

（引用文件 README.md）
# PDF 检测报告分析
... 完整文件内容 ...
```

---

## 4. Agent 上下文管理

发送链路（`workspace.tsx → sendMessage`）：

1. 用户点发送，文本里可能含若干 `@文件名`（skill 内容已在输入框，无需再处理）。
2. 正则扫描所有 `@文件名`。
3. `findFileInSession` 在当前 session 文件树里查文件。
4. `getFileContent` 取内容（来自 Core 推送的 `st.contents`）。
5. 命中 → 替换为「引用块 + 内容」；未命中 → 原样保留 `@name`。
6. 把展开后的纯文本交给 `agentClient.prompt`。

要点：
- **Core 无感知**：agent 收到的是自包含文本，不需要理解 `@` 约定、不需要 read 工具、不依赖 cwd。
- **幂等可读**：用户从输入框就能看到引用了哪些文件（`@README.md`），展开发生在不可见的发送环节。
- **失败兜底**：文件名拼错或文件不存在时，标记原样进入消息（agent 能看到用户意图）。

---

## 5. 设计取舍

### 取舍 A：为什么 `/` 注入内容、`@` 只注入标记？

| | / skill | @ 文件 |
|---|---|---|
| 体积 | 短（几十字提示词） | 可能很大（CSV/HTML，几十行~KB） |
| 注入 | 直接进输入框 | 只进 `@name` 标记 |
| 理由 | 短文本可读、可编辑，用户能组合多个 skill | 大内容塞进输入框不可读、难编辑；标记保持输入框干净 |

- **被否决的方案 1**：两者都直接注入内容。→ 文件大时输入框被淹没，无法编辑。
- **被否决的方案 2**：两者都只注入标记 + 发送时展开。→ skill 这种短文本也走间接层，失去「可见可组合」的好处，且 skill 库是 UI 层数据、展开反而要在发送时回头查 store，多余。

### 取舍 B：skills 存 `localStorage`（UI 层）还是 Core 文件系统？

- **选择 localStorage**：skill 是纯前端概念（提示词片段 + 一组文件），没有 Pi/Core 语义。localStorage 即时、离线、零网络、零边界穿越。每个 skill 采用**文件目录**结构（`SKILL.md` 入口 + 支撑文件），对齐 Claude Code 的 SKILL 包格式——既能整包 zip 导入导出，又能在 SkillHub 右栏像文件系统一样浏览/预览/改写其中任意文件。
- **被否决**：存进 Core（如 `.pi-workspace/skills/`）让 agent 也能读 skill 库。→ 增加 Core API、穿透架构边界，而当前场景**用户始终主动引用**（`/` 注入的是 SKILL.md 正文），agent 不需要自己枚举 skill 库。若未来要「agent 自主调用 skill」，再把整包目录上移到 Core。

### 取舍 C：`@` 在发送时展开内容，还是让 agent 自己 read？

- **选择前端展开**：自包含、后端无关。换成任何 agent 后端（不限于 Pi）都能工作；不要求 agent 有 read 工具、不要求 cwd 与 workspace 一致。
- **被否决**：只发 `@README.md` 标记，依赖 agent 用 read 工具读取。→ 更省 token（不重复传内容），但**强耦合 agent 能力**（要懂约定、要有工具、要 cwd 正确）。前端模板优先可移植性。

代价：大文件会全文进 prompt，消耗 token。未来可加截断（见第 7 节）。

### 取舍 D：统一 mention 系统 vs 两个独立菜单？

- **选择统一**：一个 state、一个菜单组件、一套交互，按 `trigger` 切数据源。代码量小、行为一致、扩展第 3 种触发符（如 `#` 引用历史消息）成本极低。
- **被否决**：两个独立组件。→ 重复检测/键盘/样式逻辑，交互容易不一致。

### 取舍 E：`Enter` 选首项 vs 完整 `↑↓` 键盘导航？

- **选择 Enter 选首项**（+ Esc 关闭、鼠标点击）：覆盖最常见路径（打 `/词` 回车）。MVP 够用。
- **被否决（暂缓）**：`↑↓` 高亮 + Enter 选中高亮项。→ 更完整，但当前未实现，列为后续扩展。

### 取舍 F：`@` 展开成内容 vs 注入路径让 agent read？

- 与取舍 C 同源：选择展开内容，换取后端无关与可靠性，牺牲 token 效率。

---

## 6. 边界与注意

- **检测正则的防误触**：只认「空格或行首后的 `/` `@`」，避免 URL、路径片段、邮箱触发。代价：紧贴前导字符（如 `中文/词`）不会触发——可接受。
- **安全（skill / zip 导入）**：skill 是提示词片段，最终会被 `/` 注入进发给**有工具能力的 agent** 的用户消息——因此 zip 导入的正文是潜在的 **prompt-injection 载体**（恶意包可伪装成「代码审查/部署助手」诱导 agent 泄露工作区或执行危险命令）。三层防御：
  1. **导入前预览**：上传 `.zip` / `.md` / `.txt` **不自动入库**，而是把解析出的 name/desc/files 填进表单（zip 显示「将整包导入 N 个文件」），用户审阅后点「添加 Skill」才提交（`SkillHub.tsx`）。
  2. **解压有界**：`parseSkillZip` 定位 `SKILL.md` 后**保留包内全部文本文件**（二进制按 NUL 字节判定跳过），对压缩包大小（≤4MB）、条目数（≤200）、解压后总大小（≤8MB）、单文件（≤256KB）、压缩比（≤200×）设上限，超限直接拒绝，避免 zip-bomb 冻结/OOM 主线程（解压仍同步在主线程，靠上限兜底；未来可移到 worker）。
  3. **注入透明**：`/` 注入的是**用户主动选中的可见可编辑文本**（写进输入框），用户在发送前能完整看到、可删改；不在注入环节加隐藏边界包裹，因为可见即审计。
- **localStorage 容错**：`skills.ts` 的 `read()` 校验每条记录的 `id/name/desc/files` 字段类型，损坏条目丢弃、非数组载荷回退预置；旧形态 `{body}` 在读取时**惰性迁移**成 `{files: {'SKILL.md': frontmatter+body}}`（不急写 localStorage，下次写入自然落盘）。`addSkill` 按规范化名 replace-in-place，避免同名重复导致 `/` 引用不确定。所有文件粒度的改动（`updateSkillFile`/`addSkillFile`/`removeSkillFile`）都 `list.map(...)` 产出**新数组引用**再 `write/emit`——`useSyncExternalStore` 要求引用变化才会重渲染，原地 mutate 同一数组会让 `useMemo([skills])` 选中的 skill 不更新（实测坑）。
- **安全（@ 文件）**：`@` 展开的是 workspace 已有文件（用户可见），内容进入 prompt 是用户主动行为。
- **token 成本**：`@` 目前**不截断**大文件。引用超大文件会把全文塞进 prompt。短期可接受（用户主动引用），长期应加上限（见第 7 节）。

---

## 7. 未来扩展

- `↑↓` 键盘导航 + 高亮当前项。
- `@` 大文件截断：超过阈值只取前 N 行 + `…（已截断，共 X 行）`，并可选「让 agent 自行 read 完整文件」。
- `@文件夹`：引用整个目录（拼成文件清单 + 各自内容或仅清单）。
- `#历史消息`：第 3 种触发符，引用本轮或跨轮的某条 agent 输出（统一 mention 系统天然支持）。
- skill 的分类 / 搜索 / 导入导出 / 团队共享。
- skill 与 `@` 的**组合校验**：发送前提示「引用了 N 个文件、M 个 skill」，让用户确认上下文体积。

---

## 8. 相关文件

| 文件 | 职责 |
|------|------|
| `src/skills.ts` | skill store：`{id,name,desc,files}` 目录模型 + localStorage 持久化（shape 校验 + 同名去重 + 旧 `{body}` 惰性迁移）+ 预置 + 文件粒度 API（`updateSkillFile`/`addSkillFile`/`removeSkillFile`，均产出新数组引用）+ `skillEntryBody`/`skillToFileNodes` + `useSkills`（`useSyncExternalStore`） |
| `src/skillZip.ts` | 解析上传的 `.zip`（SKILL.md 包）：fflate 解压 + **保留全部文本文件**（二进制按 NUL 跳过）+ 有界上限 + frontmatter 解析 |
| `src/components/SkillHub.tsx` | 顶栏整页视图：左栏 skill 列表 + 新建（文本表单或 zip 整包导入）；右栏文件浏览器（`FileTree` + `SkillFileView` 预览/改写 + 增删文件、改名/改描述） |
| `src/components/FileTree.tsx` | 从 Workspace 抽出的共享文件树组件（`onOpen(node)` 传 FileNode）；Workspace 与 SkillHub 共用 |
| `src/components/SkillFileView.tsx` | 按 skill 文件类型渲染（md→`MdText`，html→沙箱 iframe 预览/源码切换，其余→代码块），content 作 prop 传入（skill 文件在 localStorage，非 workspace contents map） |
| `src/components/Workspace.tsx` | 工作区：数据中心（文件树 + **拖拽上传文本文件到工作目录**，复用 `agentClient.saveFile`）/ Canvas / 报告 |
| `src/components/TopBar.tsx` | SkillHub 入口按钮 + view 开关（与会话/模型视图互斥，再点回到对话） |
| `src/components/Conversation.tsx` | mention 检测 + 菜单渲染 + 选中注入（`/` 注入 `skillEntryBody`、`@` 注入标记，共用） |
| `src/workspace.tsx` | `sendMessage`：把 `@文件名` 展开为文件内容（UI→Core 唯一注入出口） |
