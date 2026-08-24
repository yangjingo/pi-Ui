# AIDA UI Plugin — DSH rc.2 适配与缺陷修复记录

## 0. 文档信息

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-24 |
| 插件版本 | `@aida/aida-ui-dsh` 0.1.1-rc.2（与 DSH 平台版本同步） |
| 目标平台 | DSH 0.1.1-rc.2（deepseek-harness `b150a551`） |
| 状态 | 已完成，本地部署验证通过 |

## 1. 背景

DSH 平台由 0.1.0-rc.8 升级至 0.1.1-rc.2 后，AIDA UI 插件客户端与新版平台出现三处不兼容：

1. rc.2 将框架 details 列改为会话级且默认折叠，插件启动时的 `ctx.layout.openDetails()` 未生效，画布列被压为 0 宽；
2. rc.2 的 `@deepseek-ai/dsh-client-ui-trajectory/client` 运行时未导出 `TrajectoryView`；
3. 插件侧边栏的 `backdrop-filter` 形成包含块，使设置弹窗的 `position: fixed` 覆盖层被限制在侧边栏内。

## 2. 变更内容

### 2.1 插件适配（DSH rc.2）

| 变更 | 涉及文件 | 说明 |
| --- | --- | --- |
| 画布列打开 | `src/client/canvas/contract.ts`、`src/client/index.ts`、`src/client/canvas/CanvasPanel.tsx` | 画布面板在会话挂载/切换时主动调用 `ctx.layout.openDetails()`；启动重试窗口由 1s 延长至 20s |
| 画布网格 | `src/client/canvas/canvas.module.css` | 平衡/最大化网格规则移除 `:not([data-details-collapsed])` 守卫，details 列始终按 `--aida-canvas-cols` 渲染 |
| 独立构建 | `package.json` | `workspace:^` 替换为具体版本区间；补充 `tsdown`/`typescript` 开发依赖 |

### 2.2 缺陷修复

#### BUG-1 轨迹页签点击崩溃（React #130）

- **现象**：点击「轨迹」页签后，details 席位渲染崩溃，报 `Element type is invalid ... but got: undefined`（React #130）。
- **根因**：rc.2 的 trajectory 客户端类型声明导出 `TrajectoryView`，但运行时构建产物未导出该组件，插件直接渲染得到 `undefined`。
- **修复**：在 deepseek-harness 的 trajectory 客户端（源码 `src/client/index.ts` 与构建产物 `lib/client.js`）补回 `TrajectoryView` 导出。
- **验证**：轨迹页签渲染出完整工具栏（Duration / Turns / Calls / Input / Model / Tools），控制台无报错。

#### BUG-2 设置弹窗被限制在侧边栏内

- **现象**：设置弹窗遮罩/覆盖层被限制在 280px 侧边栏区域，未全屏显示。
- **原始反馈**：

  > `#root > div > div > div.UQnn-a_sidebarCol > div > div > div.nIV7rq_regionArea` 区域被限制在了
  > `#root > div > div > div.UQnn-a_sidebarCol > div > div > div.nIV7rq_footArea > div.nIV7rq_settingsArea >
  > div > div > div.CyPOeG_mask`，它应该在 `#root > div > div` 一个完整的页面显示弹窗的。

- **根因**：插件给 `[class*='_sidebarCol']` 设置 `backdrop-filter: blur(18px) saturate(106%)`，该属性会建立包含块，使弹窗的 `position: fixed` 覆盖层以侧边栏为定位基准。
- **修复**：`src/client/AidaBrand.module.css` 移除侧边栏规则中的 `backdrop-filter`（保留半透明渐变背景与背景图）。
- **验证**：弹窗遮罩恢复 `1600×1800` 全屏，对话框面板居中渲染，导航与内容正常。

## 3. 验证情况

- 画布列可见（三栏布局），文件 / 轨迹 / 画布页签可点击；
- 轨迹页签、画布页签内容正常渲染；
- 设置弹窗全屏显示，「内网模型」页签（Ollama / vLLM 预设）正常；
- 工作区列表、「项目」词汇、背景图正常；
- 浏览器控制台无 error / warning。

## 4. 已知限制

- details 列原生拖拽调整宽度的 handle 未显示（列宽由 CSS 覆盖决定），最大化 / 关闭按钮可用；
- 插件仓库缺少共享构建配置 `tsdown.client.ts`，完整重新打包需补齐；当前部署使用已适配的 bundle。

## 5. 涉及提交

对应拆分后的提交见仓库 `git log`（build / feat / fix / docs 分组）。
