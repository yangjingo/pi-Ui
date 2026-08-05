# Pi UI / UX 修改亮点与验收表

日期：2026-08-02

## 总体结论

本轮完成了现有 Pi UI 的克制式重设计。没有更换技术栈或改变 Agent/Session/File 协议；修改集中在 UI、Canvas renderer、视觉契约和对应测试。最终方向符合 `DESIGN.md`、`UX.md`、Dark Theme Goal、Conversation Restraint Goal 与 Canvas/Files Goal。

## Before / After / Why

| 表面 | Before | After | Why |
| --- | --- | --- | --- |
| Canvas 上下文 | 三个装饰圆点 + 路径 | 文件类型图标 + 路径 | 上下文元素必须携带信息 |
| Canvas 画布 | 点阵背景、外框、文档框多层嵌套 | 连续 base surface、无外框、内容靠左 | 降低容器感，让产物成为主角 |
| Markdown | 文档区域结束后露出 raised 色块 | 阅读宽度保留，stage 背景连续 | 同时保证可读性和完整工作表面 |
| Mermaid | 固定 neutral，暗色界面出现白底图 | dark / ZenGrid 各自使用 base theme variables | renderer 必须遵守部署主题 |
| Configuration | 详情像居中的独立卡片 | master/Canvas 全宽工作区，详情无装饰外框 | 配置是工作流，不是模态设置页 |
| Agent 轨迹 | 每一步都有较强填充与边框 | 透明基础面、弱边界、思考行更轻 | 答案优先，轨迹保留可检查性 |
| 状态动效 | 呼吸、弹跳、涟漪、扫光、移动光球并存 | 静态状态点；等待操作使用线性 spinner | 高频专业工具需要安静、可预测 |
| 错误提示 | Conversation 内联 style object | 语义化 `.conversation-error` + `role="alert"` | 可复用、可测试、主题一致 |
| 视口 | 部分 shell/renderer 使用 `100vh` | 使用 `100dvh` | 改善桌面窗口高度变化 |
| 文档引用 | `DESIGN.md` 指向 `.claude/skills` | 指向 `.agents/skills` | 与项目安装位置和 `AGENTS.md` 一致 |

## 交互与可访问性

- Canvas focus mode 保留 44px Conversation rail，桌面返回按钮和 `Esc` 行为保持一致。
- 原有 tablist、menu、focus restore、键盘 resize、Ctrl+S、文件拖放、ZIP 与直接下载行为全部保留。
- 错误状态使用 `role="alert"`；运行/保存状态继续使用既有 live region。
- 按钮 press feedback 仅在 pointer 输入下启用；键盘路径不会被入场动效拖慢。
- `prefers-reduced-motion` 覆盖发送、重连、模型测试等剩余 spinner。

## 动效审计

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `transition: all` | 通过 | 未使用；所有 transition 指定属性 |
| `scale(0)` | 通过 | Popover 从 `scale(.97)` 进入 |
| `ease-in` | 通过 | 进入使用项目 `ease-out`；屏内移动使用 `ease-in-out` token |
| 超过 300ms 的 UI 入场 | 通过 | Goal/Intent/Steer 为 `160–180ms` |
| 持续装饰动效 | 通过 | 已移除；持续动画仅为线性进度 spinner |
| layout 属性动画 | 通过 | 交互动效只使用 transform/opacity 或颜色过渡 |
| hover 输入门控 | 通过 | transform press 受 input dataset 限制；键盘 Focus 提供等价入口；产品仅支持桌面指针 |
| reduced motion | 通过 | 剩余 spinner/非必要过渡有降级 |
| 阴影 / glow | 通过 | 组件样式不包含 `box-shadow` |

**动效 verdict：PASS。** 动效与专业 Agent 工作台的性格一致；没有阻断项。

## 代码与测试变更重点

- `src/ui/styles.css`：工作台层级、Canvas、Configuration、错误、状态动效和 reduced motion。
- `src/ui/markdown/mermaid-runtime.ts`：暗色与 ZenGrid Mermaid palette。
- `src/canvas/panels/workspace-panel.tsx`：Canvas 文件语义标记。
- `src/canvas/panels/conversation-panel.tsx`：语义化错误状态。
- `tests/ui/localization-theme-contract.test.ts`：新增平面 UI 与动效回归契约。
- `tests/canvas/canvas.spec.ts`：Canvas 无外框/无点阵/全尺寸编辑器契约。
- `tests/e2e/configuration.spec.ts`：Configuration 详情无装饰外框契约。

## 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test:modules` | 87 / 87 通过 |
| `pnpm test:canvas` | 17 / 17 通过 |
| `pnpm test:e2e` | 34 / 34 通过 |
| `pnpm build` | 通过 |
| Chromium `1440×900` | 欢迎页、Conversation、Canvas、Mermaid、Configuration 通过 |
| Chromium `760×900` | Canvas、Conversation rail/return、Composer 通过 |

## 已知非阻塞项

- Vite 对部分 Mermaid/Cynefin 动态 chunk 给出超过 `500 kB` 的提示。renderer 已懒加载；后续应基于真实首开性能数据决定是否继续拆包。
