# 少一点界面，多一点工作：Pi UI 的一次克制式重设计

日期：2026-08-02

Pi UI 的第一个产品目标不是做一个看起来像 AI 产品的展示页，而是做出一套**有品位、可被集成、能够承载真实 Agent 工作流的界面**。这次重设计没有更换 React/Vite 技术栈，也没有引入新的 UI 或动画运行时；它从现有功能出发，收敛视觉层级、补齐状态契约，并让 Conversation、Canvas、Files 与 Configuration 使用同一种产品语言。

## 设计判断

一个开发者每天会打开很多次的 Agent 工作台，不应该靠渐变、发光和持续运动证明自己“智能”。真正的品质来自四件事：信息层级稳定、交互可预期、长内容可读、状态完整。

因此这次工作的核心不是增加装饰，而是减少竞争：

- Conversation 继续承担任务摘要与下一步输入，执行轨迹退到第二层。
- Canvas 成为真正的工作表面。文件内容靠左、保持可读宽度，并移除点阵、嵌套卡片和多余外框。
- Configuration 沿用 master/Canvas 结构，配置内容不再被包成居中的“设置卡片”。
- 状态颜色只表达状态；动效只表达进入、反馈或加载，不持续吸引注意。

这与项目的模块边界相容：所有变化仍位于 Canvas/UI 层，浏览器没有引入 Pi SDK，Agent 协议、文件能力和 Session 状态没有被视觉重构侵入。

## 从“组件堆叠”到“工作表面”

改造前的 Canvas 同时出现了外层边框、点阵背景、文档边框和 renderer 背景。每一层单看都合理，叠加后却让内容像被放在几层容器里。路径栏还使用三个装饰圆点，无法帮助用户识别当前文件。

改造后，Canvas 使用文件类型图标和真实路径建立上下文；文档表面与工作区背景连续，Markdown 保留 `920px` 阅读宽度但不再形成右侧色块。代码、表格、HTML、PDF、Mermaid 等 renderer 仍可占用完整空间，阅读内容与工具内容各自遵守合适的宽度契约。

暗色主题下的 Mermaid 也不再输出白色图块。渲染运行时现在根据部署主题选择一组明确的 `themeVariables`，默认 dark 与可选 ZenGrid 都能与外部工作台连续。主题仍是启动配置，不在浏览器里增加第二套切换状态。

## 让 Agent 的“正在工作”安静下来

原样式里存在呼吸点、头像环、弹跳点、涟漪、扫光和移动光球。它们都在表达“系统还活着”，但同时出现会让用户持续感知界面本身。

新的规则更简单：

- Session 完成、运行、Thinking 与 Trajectory 状态使用静态状态点。
- 只有真实等待操作保留线性 spinner，例如发送、重连和模型测试。
- 进入型反馈保持 `160–180ms`，使用项目统一的强 `ease-out`。
- 不使用 `transition: all`、`scale(0)`、`ease-in`、装饰性阴影或 glow。
- `prefers-reduced-motion` 会关闭剩余 spinner 与非必要过渡。

这不是“完全没有动效”，而是让动效重新成为信息，而不是氛围。

## 对文档矛盾的处理

本轮识别并解决了三个直接矛盾：

1. `TODO.md` 与 UX Goal 要求 Canvas 内容靠左、弱边界，但旧 Canvas 回归仍断言文档面板必须有 1px 外框。产品目标优先，测试改为验证无外框、无点阵且编辑器与画布等宽等高。
2. Dark Theme Goal 要求 renderer 与工作台一致，但 Mermaid 运行时固定使用 `neutral`。运行时改为按主题输出 base palette。
3. `DESIGN.md` 仍引用 `.claude/skills`，而项目 Skills 已安装在 `.agents/skills`。引用已统一到项目真实路径。

## 验证方式

这次修改不是只靠截图验收。最终结果通过：

- `pnpm typecheck`
- `pnpm test:modules`：87 项
- `pnpm test:canvas`：17 项
- `pnpm test:e2e`：34 项
- `pnpm build`

另外用真实 Chromium 在 `1440×900` 下检查了欢迎页、长对话、Canvas、暗色 Mermaid、focus mode/return rail 和 Model Configuration。原 `760×900` 兼容检查已随桌面专用产品边界移除。测试契约新增了平面 UI、动态视口、显式 transition、线性持续动效、Canvas 文件语义和暗色 Mermaid 约束，防止后续重新滑回装饰性界面。

## 下一步观察

生产构建通过，但 Vite 仍提示部分 Mermaid/Cynefin 动态 chunk 超过默认 `500 kB` 警戒线。它们已经按 renderer 懒加载，不阻塞本轮体验目标；如果后续首开 Mermaid 的性能成为真实问题，应以加载测量决定是否进一步拆包，而不是为了消除警告提前增加架构复杂度。

这次重设计的结果可以概括为一句话：**让 Pi UI 看起来更少，让 Pi 的工作看起来更多。**
