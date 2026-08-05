# Goals 完成度与冲突审计

> 审计日期：2026-08-04。本文是 `docs/goals/` 的状态索引；各 Goal 保留产品合同与历史记录，
> 当前完成度、跨 Goal 冲突裁决和证据边界以本文为准。

## 当前状态

| Goal | 状态 | 自动化证据 | 尚未证明或剩余项 |
|---|---|---|---|
| [Skill / File Harness](./GOAL-SKILL-FILE-HARNESS.md) | 已实现 | SDK loader 集成、metadata/detail、环境指纹、路径策略、Skill E2E | 没有可用 Provider 时未执行真实 Skill 调用；应用层 Shell 门禁不是安全沙箱 |
| [UserIntent / Context Harness](./GOAL-USER-INTENT-HARNESS.md) | 核心已实现 | revision/hash、确认/替换门、三轮上限、completion audit、Contract UI | 真实模型分类与多轮澄清质量未形成可重复 E2E |
| [Session Runtime](./SESSION-BACKGROUND-FLOW-GOAL.md) | 已实现 | Runtime 隔离、显式 sessionId、多 Tab、未读、恢复、删除边界 | 进程退出续跑、Runtime 淘汰与多人协作是明确非目标 |
| [UI Theme / Locale](./UI-DARK-THEME-CONSISTENCY.md) | 已实现 | typed locale、theme token、contrast、syntax fallback、启动配置 | 截图是历史人工审评，不存在跨平台像素基线 |
| [Agent Loop UX](./UX-AGENT-LOOP-RESTRAINT.md) | 已实现 | Traj/Goal 投影、菜单、指标、Loop Pet、rail、Shell Canvas | 当前模型 readiness/API Key 是运行配置，不属于完成证明 |
| [Canvas / Files UX](./UX-CANVAS-FILES.md) | 已实现 | 多选、ZIP、保存后下载、请求隔离、50/50、错误重试、路径/大小/TOCTOU 安全 | 文件夹 mutation、流式大文件 ZIP 等明确非目标 |

## 已裁决的冲突

1. 产品只支持最小宽度 1280px 的桌面环境。随机浏览器缩放与上下可用高度需要自适应，但
   手机、touch-only、coarse-pointer 和移动导航不是目标；旧“窄屏问卷”“触摸等价状态”已删除。
2. 默认 locale 是英文，中文是完整可选 locale。`aria-label` 与 tooltip 跟随当前 locale，
   不是固定中文。
3. Agent 回答、指标、Shell Canvas 与 Loop Pet 的交互只由 Agent Loop UX Goal 定义；Theme
   Goal 只拥有 token、字体、对比度、focus 与 reduced-motion，避免两份尺寸合同。
4. Skill roots 和 fingerprint 环境属于 Workspace 级资源；Session Runtime 只保存本轮 active
   Skill 与获准 roots。Skill 文件只读，任务产物写入当前 Session。
5. Architecture 的“不得修改 API/payload、不得新增 Skill 功能”只约束历史五模块目录迁移，
   不否定后来由独立 Goal 授权的 Intent、Skill detail 与 archive API。
6. Canvas 首开采用 50/50，用户拖拽后才持久化；zoom 压缩可触发 65% 安全 clamp，但不产生手机布局。
7. Preview Surface 统一 outer chrome，renderer body 保持格式专用；Theme Goal 不复制 Canvas 业务行为。
8. 300ms 只约束有限交互 transition；真实异步状态可使用 900–1800ms、可取消且 reduced-motion 静止的循环，具体 Agent 状态由 Agent Loop Goal 拥有。
9. Model/Skill 预取与缓存属于 Workspace 性能行为，HTML staged mount、ready 与 30fps 属于
   Canvas 行为；Theme Goal 只定义 loading 面的视觉 token 和动效约束，避免再次复制行为合同。

## 已裁撤的 overdesign

- 不建设 schema-driven Canvas 问卷或独立 answer endpoint；澄清问题在 Contract 卡展示，用户
  通过普通 Composer 回答。
- 不引入 IDE 级高亮器、跨平台像素截图矩阵、流式 ZIP/backpressure、OS 级 Shell sandbox、
  分布式 Session job queue 或第二套 Skill body 注入协议。
- `IntentDraft.assessing` 与 `confirmationError` 是当前未消费的遗留类型字段，不构成新 UI
  状态要求；后续协议清理可删除，不应围绕它们增加实现。

## 当前验证基线

2026-08-04 在当前工作树执行：

- `pnpm typecheck`：通过。
- `pnpm test:modules`：95 项通过。
- `pnpm test:canvas`：20 项通过。
- `pnpm test:e2e`：37 项通过。
- `pnpm build`：浏览器与 Node Core 生产构建通过。

这些命令证明当前代码回归基线，不证明真实 Provider 的语言判断质量，也不把一次本地
`/api/health` 状态或人工截图变成永久验收事实。各 Goal 中更小的测试数量均标注为历史快照。

## 文档所有权

- [ARCHITECTURE.md](../ARCHITECTURE.md)：当前五模块边界、依赖方向、公开 API 和架构摘要。
- 本目录：产品 Goal、验收条件、非目标、冲突裁决与完成证据。
- [UX.md](../UX.md)：跨页面交互原则；[DESIGN.md](../DESIGN.md)：视觉系统与 token 原则。
- 实现和测试是最终事实来源。文档状态与代码冲突时，先把 Goal 标为部分完成或证据不足，
  不通过改写历史或增加无必要系统来制造“已完成”。
