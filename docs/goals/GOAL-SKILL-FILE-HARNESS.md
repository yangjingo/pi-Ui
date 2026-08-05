# Goal / Skill 与 File Harness：原生渐进披露、环境复用与工作区门禁

> 状态：已实现（2026-08-05 更新）。本文是 Skill Harness、Skill 运行环境和 Pi Tool 文件访问
> 门禁的唯一 Goal 合同。Context Harness 只保留稳定选择策略；Session、Canvas 与架构文档
> 只引用本文件，不复制另一套 Skill/File 权限语义。

## Goal Contract

让本地 Skill 能以低延迟、可定位、可复用的方式进入 Pi Agent，同时让文件与 Shell 工具优先
工作在当前 Session，不会因为模糊搜索或相对路径解释而访问无关工作空间。

完成时必须同时满足：

- Skill 的发现、完整路径披露和 `SKILL.md` 按需展开使用 Pi SDK 原生能力，不维护第二套 body 注入协议。
- Skill Hub 列表只返回元数据；只有用户打开详情时才读取并传输完整 Skill package。
- 从 Agent 回答生成 Skill 时先在 Session 创建待验证草稿，从 Trajectory 提炼 Tool 策略和生成脚本，不直接发布。
- 用户明确要求安装 URL/ZIP Skill 时，来源先进入 Session，再由受控 Tool 校验并提交到 Skill Hub。
- 用户仍使用紧凑的 `/name`，Core 在模型输入层转换为 Pi 原生 `/skill:name`，Transcript 不保存展开后的正文。
- Skill 引用文件按 Skill 根目录解析且只读；任务输入、临时产物和最终输出按当前 Session 根目录解析。
- Skill 依赖环境归 Workspace 所有，通过确定性 fingerprint 跨 Session 复用；Skill 或依赖声明变化时自动失效。
- `read/write/edit/find/grep/ls` 和 Shell 的显式路径经过同一 Workspace Access Policy；搜索缺省路径为当前 Session 的 `.`。
- 不引入 WSL、容器或操作系统级 Bash sandbox，也不把应用层字符串门禁描述成安全沙箱。
- 工具集合和 Context Prefix 在 Session 生命周期内保持稳定；Skill 变更只刷新 ResourceLoader 资源。

## 合并前问题

原实现把 Skill 存储、发现、Prompt 注入和文件读取集中在 `SkillHarness.inject()`：

1. 每次发送 Prompt 都执行 `list()`，递归读取每个 Skill 的全部文件。
2. `/api/skills` 同样返回所有文件正文，Skill Hub 首次打开就传输完整 package。
3. 项目自行去除 frontmatter、拼接 XML 和列出 supporting files，与 Pi SDK 原生 Skill 协议重复。
4. 注入内容只列 supporting file 名，没有向 Agent 提供确定的 Skill 根路径。
5. Skill 需要依赖时没有 Workspace 级环境身份；下一次 Session 无法判断已有环境是否仍可复用。
6. File Harness 自有 API 虽然限制在 Session 内，但 Pi 内置 `read/write/edit/find/grep/ls/bash`
   与自定义 `powershell` 可以绕过这层 API。
7. 稳定 Prompt 曾同时声称“Skill 与 Session 互不可见”和“Agent 可以读取 Skill supporting files”，
   并把所有相对路径都解释到 Session；两者无法同时成立。

## 冲突裁决

### 1. 项目注入协议与 Pi SDK 原生 Skill

以 Pi SDK 为唯一发现和渐进披露实现。`DefaultResourceLoader` 读取 Skill frontmatter，向模型提供
Skill 名称、描述和完整位置；显式 `/skill:name` 调用发生时，SDK 才读取完整 `SKILL.md`。
项目 Harness 不再剥离正文或生成 `<activated_skill>`。

项目仍拥有以下产品语义：本地启用状态、Skill Hub 保存/删除、`/name` UI 别名、环境 fingerprint、
turn-to-Skill projection 和受控 package install。这些不是 Pi SDK 的重复实现。

### 2. “只注入 metadata”与执行时需要完整说明

两者按阶段同时成立：

- 发现阶段：只加载 `name`、`description`、`filePath`、`baseDir`。
- Skill Hub 列表：只返回 metadata、精确路径和 `fileCount`，`files` 为空对象。
- 编辑阶段：`GET /api/skills?id=<id>` 才读取完整 package。
- 激活阶段：Pi SDK 只为被显式调用的 Skill 展开 `SKILL.md`；supporting files 继续按需读取。

因此“渐进披露”不是项目启发式猜测，而是确定的 metadata -> explicit activation -> supporting file 流程。

### 3. Skill/Session 隔离与 supporting files

“互不可见”被废止，因为它与可读取参考文件的需求矛盾。最终合同采用能力分区：

| Root | 读取 | 写入 | 生命周期 |
| --- | --- | --- | --- |
| 当前 Session | 允许 | 允许 | 单 Session |
| 已启用 Skill roots | 允许 | 禁止 | Workspace |
| 本轮激活 Skill 的 fingerprint 环境 | 允许 | 允许 | Workspace，可跨 Session 复用 |
| 其他路径 | 拒绝 | 拒绝 | 不在项目能力范围内 |

Skill 内用于读取的相对引用（例如 `references/checklist.md`）相对于 SDK 披露的 Skill `baseDir`
解析；任务输出路径相对于当前 Session 的 `.` 解析。Skill package 永远不是输出目录。

### 4. Session 隔离与共享 Skill 环境

共享环境不属于 Session 内容，因此不会进入 `workspaceRoot/<sessionId>`。它位于：

```text
workspaceRoot/.agentcore/skill-envs/<skill-id>/<fingerprint>/
```

Session 只有在本轮显式激活对应 Skill 后，才把该环境加入可访问 roots。环境共享的是依赖与
工具链，不共享 Session 文件、消息、Goal、Steer 队列或输出。

### 5. Bash 权限与 OS sandbox

本 Goal 不考虑 WSL，也不实现敌对进程隔离。Shell 保持普通 Pi Bash/本机 PowerShell：

- 工作目录固定为当前 Session。
- `..` 越界、机器级绝对路径和明确越界搜索在 `tool_call` 阶段被拒绝。
- 指向 Skill root 的显式变更操作被拒绝；读取允许。
- 环境变量、子表达式、脚本生成路径等刻意绕过不由字符串门禁提供安全保证。

如果未来需要执行不可信脚本，必须单独建立 OS sandbox Goal，不能扩大本合同的承诺。

## 最终设计

### Skill 发现与调用

```text
Workspace skills/<id>/SKILL.md
        |
        v
SkillHarness.catalog() -- metadata only --> Skill Hub / slash completion
        |
        v
DefaultResourceLoader(additionalSkillPaths, noSkills=true)
        |
        v
用户 /name --> resolveInvocation() --> /skill:<commandName>
        |
        v
Pi SDK JIT 展开 SKILL.md + 精确 location/baseDir
```

`noSkills=true` 禁止自动继承无关全局 Skills；显式的 `additionalSkillPaths` 仍加载当前 Workspace
Skill 根目录。`skillsOverride` 根据 `.skillhub.json` 的 enabled 状态过滤资源，并把不符合 Agent
Skills 命名规范的历史条目稳定映射到目录派生的 `commandName`。保存新 Skill 时 frontmatter
名称被规范为小写字母、数字和连字符，显示名称仍保存在本地 metadata 中。

Skill 保存或删除后 Core 增加 `skillRevision`。下一次非流式 Prompt 到来时只调用
`session.resourceLoader.reload()`；不销毁 Session，不变更工具定义，也不污染 Context Prefix。

### Skill Hub 懒加载

`SkillHarness.catalog()` 只读取入口 frontmatter、`.skillhub.json` 和目录项数量，不读取 supporting
file 正文。`GET /api/skills` 返回 summary；`SkillHarness.read(id)` 与详情 endpoint 才执行有数量、
单文件大小和总大小上限的递归读取。浏览器 store 会把已加载 detail 与刷新后的 summary 合并，
避免刷新列表时清空正在编辑的文件。

### Skill Generator 与受控安装

Agent 回答头部 `···` 菜单的第三项“创建 Skill”是 turn-to-Skill 的唯一 UI 入口。Harness 从
已完成 Turn 提炼目标、实际 Tool 策略和被该 Turn 引用的生成脚本，先写入当前 Session：

```text
skill-drafts/<draft-id>/
├─ SKILL.md
└─ scripts/                 # 仅当本轮真实生成并引用了可复用脚本
   └─ <script>
```

`SKILL.md` 的 draft frontmatter 只使用临时 ID；正文包含 Objective、由 Trajectory 提炼的 Tool
strategy、实际复制的 scripts 清单和验证合同。它不会复制 Agent 最终回答、Thinking、Tool
output 或完整 Trajectory。旧的默认任务标签、fallback 名称和提前发布描述全部删除；验证前不替
用户决定最终名称，也不生成占位 README、references 或 assets。

保存草稿后仍停留在当前 Session，Composer 自动准备 `@<draft-path>/SKILL.md` 的代表性任务验证
请求。Conversation 的紧凑状态条可以打开草稿；只有包含该引用的 user turn 后出现一个完成的
Agent turn，才显示“贡献到 Skill Hub”。点击贡献仅准备名称商讨 Prompt：必须由用户确认最终
名称，Agent 才更新 frontmatter/package metadata 并调用 `skill_package`。安装器在最终 package
缺少时生成官方 `agents/openai.yaml`，其中只包含 `display_name`、`short_description` 和带
`$skill-id` 的 `default_prompt`。这条流程不增加 Wizard 或分步 Tour。

自然语言安装沿用同一 catalog，但不允许 Agent 直接写 Skill root：

1. 用户必须明确要求安装，并提供 URL 或上传 archive。
2. Agent 在当前 Session 的 `.` 下下载/clone 或解包，定位直接包含 `SKILL.md` 的具体目录。
3. 固定注册的 `skill_package` Tool 校验来源仍在 Session、读取文本 package，并按 frontmatter
   name 规范化到 Workspace `skills/<id>`。
4. 同名条目默认拒绝；只有用户明确要求替换时才允许 `replace=true`。
5. 成功后 Core 增加 `skillRevision` 并发出 `skills_changed`，浏览器立即刷新 Skill Hub。

因此项目仍没有远程 Skill 市场或浏览器安装 endpoint；URL 获取、ZIP 解包与风险检查保持为
Agent 可见的普通 Session 步骤，跨越只读边界的只有窄化后的 package commit。

### Workspace 级环境复用

fingerprint 输入包括：

- 平台、CPU 架构和 Node 版本。
- `SKILL.md`。
- 存在的 `skill.env.json`、Python requirements/pyproject/uv lock。
- 存在的 package manifest 与 pnpm/npm/yarn/bun lock。

环境目录首次解析时写入 `manifest.json`。Agent 通过固定注册的 `skill_environment` 工具执行：

- `status`：获取 path、digest、ready 与 fingerprint sources。
- `mark_ready`：依赖准备成功后写入 `ready.json`；digest 不匹配时拒绝。

同一 fingerprint 的后续 Session 直接使用 ready 环境；Skill 或依赖输入变化后生成新 digest，旧环境
不会被误判为 ready。Harness 不自动选择包管理器或安装任意依赖，具体安装仍由 Skill 指令和普通
工具完成。

### File/Bash 工具门禁

`WorkspaceAccessPolicy` 在 Pi `tool_call` extension 中统一处理：

- `find/grep/ls` 没有 `path` 时原地补为 `.`。
- `read/find/grep/ls` 校验 read roots。
- `write/edit` 校验 write roots。
- `bash/powershell` 检查 `..`、显式绝对路径和明显的路径变更命令。
- 对已存在路径使用 `realpath`；目标尚不存在时，从最近存在的父目录 canonicalize 后再比较，避免
  通过符号链接或路径拼接越过 root。

这层策略补齐 Pi 内置工具绕过 File Harness API 的缺口，但 File Harness 原有的下载、ZIP、隐藏
文件、大小限制和文件描述符级 TOCTOU 合同继续有效，两者不能互相替代。

## Context 与 Session 装配

Context Harness 的稳定 `<workspace_policy>` 只描述不随 Session 改变的选择规则：

- 搜索先从当前 Session `.` 开始，不做机器级 find。
- Windows 原生操作优先 PowerShell，明确需要 POSIX 语义时使用 Bash。
- SDK 披露的 Skill location 是只读参考根；引用相对 Skill，输出相对 Session。
- ready Skill 环境应复用，成功准备后才允许标记 ready。

动态 Skill ID、location、digest、ready 和环境 path 只进入当前 user turn，不进入 System Prompt。
每个 `SessionExecutionState` 独立保存本轮 active Skill IDs 与环境 roots；开始新 Turn 时清空，Steer
仍属于同一 Turn，不错误撤销已经激活的能力。

## 实现归属

- `src/harness/skill/index.ts`：metadata catalog、详情读取、保存规范化、调用解析、环境 fingerprint。
- `src/core/pi/runtime.ts`：ResourceLoader 装配、revision reload、Session active roots。
- `src/core/pi/skill-environment-extension.ts`：固定 `skill_environment` Tool adapter。
- `src/core/pi/skill-package-extension.ts`：固定 `skill_package` 安装桥，提交已暂存 package。
- `src/harness/file/access-policy.ts`：与 Pi 无关的路径能力判断。
- `src/core/pi/workspace-access-extension.ts`：Pi `tool_call` adapter。
- `src/harness/context/prompts.ts`：稳定搜索、Shell 选择、Skill 引用与环境复用规则。
- `src/workspace/skills/*`：summary/detail store、slash command 与 mutation facade。
- `src/canvas/panels/skill-panel.tsx`：点击时加载详情，不拥有文件系统或 Pi 逻辑。

Harness 仍不得依赖 Pi SDK、React、Canvas 或 Workspace；所有 Pi 类型和事件适配只存在于
`core/pi`。

## 验收标准

1. `/api/skills` 不包含任何 Skill 文件正文，详情 endpoint 返回完整 package。
2. Pi SDK 可以从 Workspace Skill root 发现 enabled Skill，并暴露准确 `filePath/baseDir`。
3. `/name request` 只激活匹配 Skill，并保留用户 request；非匹配 slash 不被改写。
4. Skill supporting files 可以读取但不能写入；Session 与 active environment 可写。
5. find/grep/ls 缺省路径为 `.`，外部路径和 `..` Shell 搜索被拒绝。
6. ready 环境在 fingerprint 不变时复用；修改 `SKILL.md` 或依赖输入后 digest 改变且 ready=false。
7. Skill 保存/删除后下一次空闲 Turn 可用，不重建 Session 或更改固定 Tool 集合。
8. Skill Hub 创建、打开、上传文件、编辑文件和 slash completion 不退化。
9. Context、Session 和 Canvas Goal 不再声明与本合同冲突的相对路径或隔离语义。
10. turn-to-Skill 先生成 Session `SKILL.md` 草稿和真实引用脚本；验证轮完成前没有 Skill Hub 贡献入口。
11. 用户选择贡献后仍必须先确认最终名称；`skill_package` 安装时补齐官方 UI metadata 并刷新 catalog。
12. URL/ZIP 安装只能从 Session 中直接包含 `SKILL.md` 的目录提交，默认不覆盖，成功后 catalog 自动刷新。

## 验证记录（2026-08-04）

- `pnpm typecheck`：通过。
- `pnpm test:modules`：94 项通过。
- Core 原生集成测试：验证 `DefaultResourceLoader` 的 exact `filePath/baseDir`。
- Harness 测试：验证 metadata discovery、显式 invocation、环境 reuse/invalidation、路径区域与搜索缺省值。
- `tests/e2e/skills.spec.ts`：4 项通过，覆盖 Skill Hub、turn-to-Skill、文件上传/编辑与目录上传。
- `pnpm test:canvas`：17 项通过。
- `pnpm test:e2e`：36 项通过，其中包含上述 4 项 Skill E2E。
- `pnpm build`：浏览器与 Node Core 生产构建通过。
- 本地 `GET /api/skills`：24 个 summary，`files` 均为空；按 ID 详情返回完整文件集合。

### Skill Generator / Installer 增量验证（2026-08-05）

- `pnpm typecheck`：通过，包含五模块边界、浏览器、Core 与测试类型检查。
- `pnpm test:harness`：覆盖 Trajectory Tool 策略、实际脚本复制、无原始输出复制、Session staged
  package 安装、官方 metadata 补齐与默认拒绝覆盖。
- `pnpm test:modules`：98 项通过。
- `pnpm exec playwright test tests/e2e/skills.spec.ts`：4 项通过；覆盖回答菜单第三项、Session
  草稿、`@SKILL.md` 验证门、验证后贡献/名称商讨、详情懒加载、文件与目录上传。
- `pnpm build`：浏览器与 Node Core 生产构建通过；`skill_package` 保持在 Node/Pi bundle。

## 非目标

- 自动安装所有 Skill 依赖或替 Skill 决定包管理器。
- 远程 Skill 市场、联网安装 endpoint 或组织级 Skill 分发。
- 让 `skill_package` 自己访问网络、自动解压 archive 或猜测包含多个 Skill 的仓库应安装哪一个。
- WSL、容器、虚拟机、受限用户或其他 OS 级命令隔离。
- 抵御恶意 Shell 使用环境变量、动态脚本或子进程刻意绕过应用层字符串检查。
- 让 Skill package 成为任务输出目录。
- 在 System Prompt 中注入当前 Skill、环境、Session 或可变权限状态。
- 给 Skill Files 增加 Session ZIP、批量 mutation 或不受限写权限。
