# AIDA 插件标准格式核对

## 结论

AIDA 相关改动符合 DSH 客户端插件标准格式。

## 核对清单

| 检查项 | 结果 |
|---|---|
| 独立插件目录 | ✅ `packages/client/ui-aida` |
| 包元数据 | ✅ `package.json`，包名 `@aida/aida-ui-dsh` |
| DSH 插件声明 | ✅ `dsh.client.inject` + `platform: "web"` |
| 插件入口 | ✅ `src/client/index.ts` 导出 `apply(ctx)` |
| 资源注册 | ✅ locale、theme、slots、settings |
| 文档 | ✅ `README.md`、`README.zh.md` |
| 测试 | ✅ `tests/*.spec.ts(x)` |
| 可逆性 | ✅ 移除插件入口即可恢复默认 UI |
| PRD | ✅ 未修改，仅只读 |

## 实现文件

- `packages/client/ui-aida/package.json`
- `packages/client/ui-aida/src/client/index.ts`
- `packages/client/ui-aida/src/client/AidaBrand.tsx`
- `packages/client/ui-aida/src/client/AidaHero.tsx`
- `packages/client/ui-aida/src/client/canvas/*`
- `packages/client/ui-aida/src/client/models/*`
- `packages/client/ui-aida/src/client/skin/chrome.ts`
- `packages/client/ui-aida/src/client/theme.ts`

## 说明

该插件是浏览器端（Web）插件，通过 Cordis 配置启用；当前改动集中在 AIDA 视觉皮肤、Canvas 与内网模型预设，不改变 Agent 核心行为。
