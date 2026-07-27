# Model Configuration

## Ownership

模型配置由 Node Core 负责，Canvas 仍提供直接编辑体验：

- Canvas 持有表单草稿、校验反馈和未保存状态。
- Workspace 只把操作转发给 `/api/models/*`。
- Core 解析和校验配置、保存模型与凭据、刷新 Pi SDK runtime，并返回脱敏结果。
- Pi SDK 只在 `src/core/pi` 中使用，不进入浏览器 bundle。

## Visible catalog

UI 只展示用户通过界面添加，或在
`.workspace/.agentcore/models.json` 的 `providers` 中显式声明的模型。
Pi SDK 自带的 Provider/模型目录不会被枚举、预加载或渲染。
首次启动生成的 `models.json` 也是空目录，不预置任何 Provider。

这意味着使用 SDK 已支持的 Provider 时，也必须先把 Provider 及其模型写入 Core
配置；“SDK 支持”不等于“UI 自动展示”。

## Files

- `.workspace/.agentcore/models.json`：Provider 与模型定义，可在高级编辑器中修改。
- `.workspace/.agentcore/auth.json`：Core 私有凭据，API Key 不通过列表或配置读取接口返回。
- `.workspace/.agentcore/active-model.json`：当前激活模型。

保存表单时，空的 API Key 表示保留现有凭据；提交新值则由 Core 更新
`auth.json`。旧 `.workspace/settings.json` 会在首次启动时迁移，但不会被删除。
