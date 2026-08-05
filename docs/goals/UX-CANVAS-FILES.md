# UX Goal：Canvas 与 Files 操作一致性

> 状态：已实现并完成专项回归（2026-08-04 修复）。核心交互、File Harness 安全边界、
> 直接下载错误处理和 Session 请求隔离已落地；Canvas 20 项、模块 94 项、E2E 36 项与生产构建通过。

> 2026-08-04 补充：本文的 File Harness 安全边界只覆盖 Files/下载/ZIP 产品流程。Pi 内置
> read/write/edit/find/grep/ls 与 Shell 的工作区门禁、Skill 只读 roots 和依赖环境复用统一由
> [GOAL-SKILL-FILE-HARNESS.md](./GOAL-SKILL-FILE-HARNESS.md) 定义；两层约束互补，不互相替代。

## Goal Contract

在不增加 Canvas 认知负担的前提下，简化文件预览工具栏，建立一致的文件管理入口，并让用户能够安全、可访问地选择多个文件并下载为 ZIP。

完成时必须同时满足：

- Canvas 不再提供“上一项 / 下一项”按钮或对应的顺序翻页快捷操作。
- Canvas 不再提供文件“更多”菜单；重命名和删除统一迁移到 Files。
- Canvas 对当前文件提供直接下载，并正确处理未保存内容。
- Canvas 首次以 50/50 分栏打开，保持 Conversation 上下文；用户拖拽后持久化其宽度选择。
- Trajectory、Artifact 与 Files 预览统一外层 chrome，不强制统一格式专用 renderer 的内容体。
- Files 支持显式多选模式和保留目录结构的 ZIP 下载。
- Workspace Files 与 Skill Files 的工具栏结构、动作槽位和反馈模式一致；具体动作按资源能力显示。
- Model 与 Skill 的创建入口遵循同一信息架构，不通过虚构功能强行凑齐行数。

## 背景与现状

当前 Canvas 顶栏同时承担路径、顺序导航、保存、复制和文件管理。文件重命名与删除藏在 Canvas 的“更多”菜单，而导入位于 Files 顶栏，导致“查看文件”和“管理文件”的职责交叉。

单文件下载的服务端能力已经存在，但只在部分 Office 预览中暴露，没有成为所有文件类型一致可用的 Canvas 操作。Files 文件树目前只有打开行为，没有选择状态、批量动作或 ZIP 下载。

相关设计约束：

- [UX.md](../UX.md) 要求每个界面只有一个焦点，并采用渐进披露。
- [ARCHITECTURE.md](../ARCHITECTURE.md#source-module-contract) 要求 Canvas 只渲染和转发操作，文件业务归 Workspace，服务端安全约束归 File Harness。

## 已锁定的产品决策

1. Canvas 顶栏移除“上一项 / 下一项”。
2. Canvas 顶栏移除“更多”菜单。
3. Canvas 顶栏增加直接下载当前文件。
4. 重命名和删除迁移到 Files 文件行菜单。
5. 多文件下载统一生成 ZIP，不触发多个浏览器下载。
6. ZIP 必须保留所选文件的相对目录结构。
7. Canvas 文件切换只通过 Canvas 标签页、Files 文件树或显式轨迹步骤选择完成。
8. 首次打开 Canvas 使用 50/50；用户拖拽是唯一持久化宽度来源，重置回到当前视口的 50/50。
9. Session 变化必须取消旧 Session 的单文件/ZIP 请求并丢弃迟到结果，同时清空 Files 的搜索、选择、菜单、busy 与错误状态。
10. “预览一致”只约束外层 header/action、边框、背景、状态与滚动归属；内容体按 renderer 语义保持差异。

## 目标交互

### Canvas 顶栏

读取状态：

```text
文件路径                                      复制（适用时）  下载
```

编辑状态：

```text
文件路径                       保存状态  保存（有修改时）  复制（适用时）  下载
```

规则：

- 没有当前文件，仅显示轨迹、报告或空状态时，不显示下载。
- 复制只对能够生成可靠纯文本预览的文件显示。
- 保存只在文件可编辑且存在未保存修改时成为主要动作。
- 下载当前文件前若存在未保存修改，必须先保存；保存失败则停止下载并显示错误。
- 下载文件名使用当前文件名，不泄漏服务端绝对路径或 Session 目录。
- 移除 `navCanvas` 对应的 Canvas 顺序翻页入口和仅为该功能存在的 PageUp/PageDown 行为。

### Files 文件行操作

每个文件行在 hover、键盘 focus 或当前选中时显示克制的行菜单入口，菜单包含：

- 重命名
- 删除

文件夹首期不提供重命名和删除，除非后续明确增加服务端文件夹 mutation 协议。

删除继续要求二次确认，并明确说明不可撤销。重命名必须保留在原目录内，并复用现有路径安全规则。

### 多选模式

Files 默认仍是“点击打开文件”，不常驻复选框。用户点击“选择”后进入多选模式：

```text
已选择 N 项          全选当前结果  下载 ZIP  取消
```

行为：

- 文件行显示复选框，点击文件行切换选择，不打开 Canvas。
- 支持 Space 切换当前项、Shift 连续选择、Esc 退出选择模式。
- 文件夹选择递归包含其当前全部后代文件。
- 搜索状态下“全选当前结果”只选择过滤后的文件，不选择被搜索隐藏的文件。
- 文件被删除或刷新后不存在时，从选择集合中自动移除。
- 退出选择模式时清空选择集合，避免跨上下文误下载。
- 下载按钮在选择为空、正在压缩或存在未处理错误时禁用。

### ZIP 下载

ZIP 由 Node Core 与 File Harness 生成，不在浏览器内读取并压缩所有大文件。

批量 ZIP 首期只适用于当前 Session 的 Workspace Files。Skill Files 共享 Files 工具栏的视觉结构，但不获得选择/ZIP 能力；Skill 文件仍通过 Skill 保存协议管理。这样可以保持交互位置一致，同时避免把 Session File Harness 的路径权限错误扩展到 Skill 根目录。

建议文件名：

```text
<session-title>-files-YYYYMMDD-HHmm.zip
```

服务端必须：

- 接收显式 `sessionId` 和规范化相对路径数组。
- 将所有归档路径解释为 `workspaceRoot/<sessionId>` 下的相对路径；协议不接受绝对路径、Skill ID 或其他 root kind。
- 对每个路径复用 File Harness 的 workspace containment 校验。
- 拒绝隐藏文件、目录穿越、符号链接越界和不存在的文件。
- 对重复路径去重，并使用确定性排序。
- 保留相对目录结构，ZIP entry 统一使用 `/` 分隔符。
- 规范化后发生同路径碰撞或 Windows 大小写碰撞时整体失败。
- 产品目标是少量小文件的批量下载；500 个文件、100MB 单文件和 256MB 总未压缩大小仅作为拒绝异常请求的硬上限，不是大文件归档性能目标。
- 归档前记录规范化路径、realpath、大小和修改时间；打开后以同一文件描述符执行 `fstat → read → fstat`，对象身份或元数据变化时整体失败。
- 设置正确的 `Content-Disposition` 和 ZIP content type。
- ZIP 直接在服务端内存中生成，不写入源码或临时目录；压缩失败时在响应 body 开始前返回错误。
- 客户端断开不会留下临时归档；不把不完整 ZIP 暴露为成功响应。

### 上传位置

Workspace Files 和 Skill Files 采用一致工具栏结构：

```text
文件 / 文件数量                         动作槽位  导入/上传
```

- Workspace Files 的动作槽位显示“选择”，进入后提供 ZIP 下载。
- Skill Files 的动作槽位不显示“选择/ZIP”，只保留 Skill 上传动作。
- 不可用动作不使用 disabled 占位凑齐数量。
- “上传模型配置”仍属于“添加模型”流程，不迁移到 Files。模型 JSON 是配置导入，不是普通工作区文件上传。

### Model 与 Skill 入口一致性

一致性应来自信息架构，而不是让两个页面拥有相同数量的虚构选项：

- Model 主入口：添加模型。
- Skill 主入口：新建 Skill。
- Workspace 根目录移出“模型创建入口”，放到独立的运行环境/全局设置位置。
- 两个入口使用相同的行高、图标槽、标题、说明、尾部箭头和选中状态。
- 详情继续共用 `ConfigWorkbench`，但表单字段根据业务语义不同。

## 模块所有权

- `canvas`：工具栏、选择模式视图、文件行菜单、键盘与焦点管理。
- `workspace`：选择集合、下载 action、保存后下载编排、ZIP 请求与错误状态。
- `core/agent`：批量下载请求/响应协议和浏览器 client。
- `core/pi`：HTTP 传输与 Session 路由。
- `harness/file`：路径、文件数量、文件大小、归档内容和安全边界。
- `ui`：共享按钮、菜单、复选框和状态视觉。

Canvas 不得直接调用 `/api/*`，不得自行拼接服务端文件路径，也不得在浏览器内绕过 Workspace 执行 mutation。

## 错误与边界状态

- 保存失败：不开始下载，保留编辑内容，显示可重试错误。
- 单文件不存在：显示“文件已不存在”，刷新文件树。
- ZIP 中部分文件失效：默认整体失败并列出失效路径，不生成不完整归档。
- ZIP 超过限制：返回明确的数量/大小边界，不静默截断。
- ZIP 路径规范化后碰撞：整体失败并列出冲突 entry。
- 文件在校验与读取之间变化：整体失败，并在发送 ZIP body 前返回错误。
- 网络断开：选择状态保留到当前页面生命周期内，允许重试。
- 当前 Session 切换：立即中止旧 Session 的单文件与 ZIP 请求，递增请求代次并清空搜索、选择、菜单、busy 与错误；迟到响应不得触发保存或污染新 Session。
- 后台 Agent 修改文件：下载前以服务端当前文件为事实来源；存在用户未保存编辑时先完成保存。

## Accessibility

- 所有图标按钮必须有当前 locale 的 `aria-label` 和 tooltip。
- 文件树多选使用 `aria-multiselectable="true"` 与准确的 `aria-selected`。
- 行菜单可以通过键盘打开、导航和关闭。
- 文件树初始且任意时刻只有一个 `tabIndex=0` 的 roving-focus 项；行菜单支持 ArrowUp/ArrowDown/Home/End，并在打开后聚焦首项。
- ZIP 生成进度使用 `role="status"`，错误使用 `role="alert"`。
- 二进制 renderer 加载失败使用 `role="alert"` 并提供原位重试；404 同步刷新当前 Session 文件树。
- hover 披露必须有键盘 focus 等价状态；产品不承诺触屏或 coarse-pointer 交互。
- reduced-motion 下不使用位移动画。

## 验收标准

1. Canvas 中不存在“上一项 / 下一项”按钮、相关 test id 和仅服务该功能的快捷键。
2. Canvas 中不存在文件“更多”菜单；重命名和删除只能从 Files 文件行发起。
3. 所有可下载文件在 Canvas 中拥有直接下载动作。
4. 未保存文件执行下载时，测试证明先保存后下载；保存失败不会下载旧内容。
5. Files 可以选择多个跨目录文件，下载的 ZIP 内路径和内容正确。
6. 搜索状态下全选只包含当前结果。
7. 文件删除、Session 切换和下载失败不会留下跨 Session 的选择状态。
8. Workspace Files 与 Skill Files 的上传动作位于相同工具栏槽位。
9. Model 与 Skill 各有一个主要创建入口，Workspace 根目录不再伪装成模型创建入口。
10. 键盘、桌面布局、loading、empty、error 和 reduced-motion 状态均有明确行为；自动化覆盖
    以实际测试清单为准，不把人工检查写成测试事实。
11. Canvas 首次打开宽度为应用可用宽度的 50%；持久化拖拽和 zoom 安全 clamp 不改变这一默认合同。
12. Session 切换会中止旧 archive/download，请求迟到也不会保存；Files 的搜索、选择和瞬态反馈全部归零。
13. Trajectory、Artifact 与 Files 预览共用外层视觉语法，图片/PDF/代码等内容体保持格式专用布局。
14. 复杂 HTML 先提交 Canvas chrome、下一帧挂载 iframe，并以 iframe ready 信号结束 loading；
    所有 HTML 预览内的 `requestAnimationFrame` 工作限制为 30fps，不能以修改文档内容换取性能。

“可下载文件”定义为：当前 Files 中可见、类型不是 `folder`、位于当前 Session workspace 内，并通过 File Harness raw-download 大小与路径校验的文件。文本、代码、Office、PDF、图片和受支持 binary 都属于候选；隐藏文件和越界路径永远不属于候选。

## 验证

- Workspace 模块测试：选择集合、Session 隔离、保存后下载编排。
- File Harness 测试：路径穿越、隐藏文件、重复路径、大小写碰撞、Windows 分隔符、数量与大小上限、同一文件描述符 TOCTOU 变化和目录结构。
- Canvas 测试：工具栏简化、50/50 首开、行菜单、roving focus、选择模式、请求隔离、直接下载/renderer 错误与重试。
- E2E：多目录文件选择、ZIP 下载、解压内容验证、未保存编辑下载。
- `pnpm typecheck`
- `pnpm test:modules`
- `pnpm test:canvas`
- `pnpm test:e2e`
- `pnpm build`

### 本次实施结果

- Canvas 已移除 `navCanvas`、上一项/下一项按钮、Ctrl/Cmd+PageUp/PageDown 文件切换与文件“更多”菜单。
- Canvas 增加当前文件直接下载；dirty 编辑会先走现有保存协议，保存失败时不触发下载。
- Files 文件行承担重命名与二次确认删除；默认点击仍打开文件。
- Files 增加显式选择模式、文件夹递归选择、Shift 连选、搜索结果全选、Esc 退出和 Session 隔离。
- 单文件与 ZIP 下载都通过 Workspace 可观察 Blob 请求；Session 切换或卸载会 abort，request generation 拒绝迟到结果。
- 直接下载 404 会显示行内错误并刷新文件树；图片/PDF renderer 失败使用语义 alert 和原位重试。
- 文件树补齐单一 roving-focus 起点，行菜单补齐 Arrow/Home/End 导航，ZIP 压缩暴露 live status。
- Canvas 首次分栏改为 50/50；仅用户拖拽写入宽度偏好，重置恢复流式 50/50，压缩视口保留 65% 安全 clamp。
- Core 新增 `/api/files/archive`；File Harness 负责去重、稳定排序、目录结构、hidden/symlink/containment、500 文件、100MB 单文件、256MB 总量，以及同一文件描述符上的身份与读取前后元数据校验。
- Workspace 与 Skill 的导入/上传动作都位于各自 Files 工具栏右侧；Skill 不暴露 Session ZIP 能力。
- Model 左栏已将“运行环境”与“模型操作”拆成独立分区；Model 与 Skill 的主要创建入口继续复用相同的 `model-opt` 行结构。
- 新增 File Harness ZIP 内容与安全测试、Canvas 简化/行菜单/多选/ZIP 测试，以及 dirty 保存先于下载的时序测试。

历史验证快照（2026-07-31）：

- `pnpm typecheck`
- `pnpm test:modules`（62 项）
- `pnpm test:canvas`（14 项）
- `pnpm test:e2e`（29 项）
- `pnpm build`（浏览器与 Node Core）

### 2026-08-04 修复与证据状态

- 旧审计中的 archive AbortSignal 与跨 Session 请求生命周期缺口已经关闭。
- 新增直接下载 404、renderer 失败重试、ZIP live status、菜单键盘导航、初始 roving focus、
  50/50 首开与 Session 切换丢弃迟到 ZIP 的浏览器回归。
- 本次 `pnpm typecheck`、`pnpm test:modules`（95 项）、`pnpm test:canvas`（20 项）、
  `pnpm test:e2e`（37 项）和 `pnpm build` 已通过。Playwright 配置显式让
  127.0.0.1/localhost 绕过 HTTP 代理，避免本机代理将“Vite 已 ready”误报为服务就绪超时。

### 决策记录

1. **已决策（2026-07-31）**：批量下载只服务少量小文件，继续使用 `fflate.zipSync` 在服务端内存压缩。此路径延迟和实现成本更低，不增加流式压缩、backpressure 或磁盘临时文件；如果产品范围未来扩大到大文件，再以新 Goal 重新评估。
2. **已实现（2026-07-31）**：单文件下载和 ZIP 归档都在路径授权后只打开一次文件，并以同一描述符执行读取前后 `fstat`。实现同时比较 `dev/ino/size/mtime/ctime`，支持的平台附加 `O_NOFOLLOW`，从而拒绝授权后替换文件、最终路径符号链接和读取期间变化。
3. **已实现（2026-08-04）**：Canvas 首开采用流式 50/50，而不是保存一个伪默认像素值；只有用户拖拽写入偏好。桌面缩放造成空间不足时允许使用既有 65% clamp，避免把自适应误解成手机布局。
4. **已实现（2026-08-04）**：预览一致性的对象是 outer chrome，renderer body 保持格式语义；这裁决了“所有预览做成相同卡片”与“完全各自为政”之间的冲突。
5. **已实现（2026-08-04）**：Session 是下载请求与 Files transient state 的隔离边界；AbortSignal 与请求代次同时使用，因为网络取消本身不能证明迟到 Promise 不再提交结果。
6. **已实现（2026-08-04）**：HTML Canvas 的性能边界是“外壳先可用、内容后挂载、显式 ready、
   预览 RAF 30fps”。30fps 适用于普通 HTML 与演示文稿；不注入会改变页面布局或内容的
   `content-visibility` 规则，也不以 Blob URL 改变相对资源语义。

## 非目标

- 文件夹重命名、移动或删除。
- 云端分享链接。
- ZIP 密码、加密或断点续传。
- Skill Files 的批量 ZIP 下载。
- 多用户同时编辑时的锁与冲突合并。
- 用下载动作替代 Canvas 标签页或 Files 文件树。
