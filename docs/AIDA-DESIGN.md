---
name: AIDA Design System
version: 2.0
description: >-
  一套可复用的浅色、数据密集型企业级控制台设计语言。slate 画布 + 白色面板，
  indigo 作为「AI / 可交互」信号色；克制、可信、无廉价特效。
  从 AIDA 主仓库 docs/80_设计UX/ 与 frontend/ 实现中抽取并标准化。
canonical_prefix: "--c-"  (颜色), "--r-" (圆角), "--sp-" (间距), "--fs-" (字号), "--fdy-" (深色导航)
---

# AIDA Design System

> **单一真相源**：本文件是 AIDA 设计系统的**唯一权威描述**——包含设计 token、布局骨架、组件范式、品牌标识与前端落地规范。所有页面实现必须对齐本文。

---

## 0. Token 命名规范

### 0.1 前缀体系

所有设计 token 遵循严格的前缀约定，一眼可辨类别：

| 前缀 | 类别 | 示例 |
|------|------|------|
| `--c-` | 颜色（Color） | `--c-brand`, `--c-bg`, `--c-text` |
| `--fs-` | 字号（Font Size） | `--fs-14`, `--fs-24` |
| `--r-` | 圆角（Radius） | `--r-sm`, `--r-lg` |
| `--sp-` | 间距（Spacing） | `--sp-2`, `--sp-6` |
| `--shadow-` | 阴影 | `--shadow-sm`, `--shadow-lg` |
| `--font-` | 字体族 | `--font-sans`, `--font-mono` |
| `--fdy-` | 深色导航（Foundry） | `--fdy-bg`, `--fdy-text` |
| `--nav-` / `--topbar-` / `--claw-` | 布局尺寸 | `--nav-w`, `--topbar-h` |

### 0.2 颜色 token 内部后缀

| 后缀 | 语义 | 示例 |
|------|------|------|
| *(无后缀)* | 主色/实色 | `--c-brand`, `--c-success` |
| `-hover` | 悬停/按下态 | `--c-brand-hover` |
| `-soft` | 浅底色（用于标签底、选中行） | `--c-brand-soft`, `--c-success-soft` |
| `-text` | 浅底上的文字色（保证对比度） | `--c-brand-text`, `--c-success-text` |
| `-bg` ⚠️ | 浅底色（仅 risk 系列，见 §0.3） | `--c-risk-high-bg` |

### 0.3 已知不一致（待修）

| 问题 | 现状 | 应统一为 |
|------|------|----------|
| 风险 token 浅底后缀 | `--c-risk-high-bg` | `--c-risk-high-soft` |
| 品牌红缺 `--c-` 前缀 | `--aida-red` | `--c-aida-red` |

> 这是代码中的实际命名，本文档如实记录。新项目建议先统一再使用。

### 0.4 历史别名（来自 UI视觉规范.md，仅供迁移参考）

AIDA 早期设计文档（`UI视觉规范.md`）使用了另一套命名，与当前代码不一致。**以下为旧名→新名映射，新代码禁止使用旧名**：

| 旧名（UI视觉规范.md） | 新名（代码真相） | 说明 |
|-----------------------|-------------------|------|
| `--bg` | `--c-bg` | |
| `--bg-muted` | `--c-bg-soft` | |
| `--surface` | `--c-surface` | |
| `--surface-secondary` | `--c-surface-2` | |
| `--text-primary` | `--c-text` | |
| `--text-secondary` | `--c-text-2` | |
| `--text-muted` | `--c-text-muted` | 仅前缀不同 |
| `--text-faint` | `--c-text-faint` | |
| `--brand` | `--c-brand` | |
| `--brand-subtle` | `--c-brand-soft` | `subtle` → `soft` |
| `--brand-hover` | `--c-brand-hover` | |
| `--brand-text` | `--c-brand-text` | |
| `--radius-sm/md/lg` | `--r-sm/md/lg` | `radius` → `r` |

前端 `globals.css` 保留了部分旧名作为**语义别名**（`--accent: var(--c-brand)` 等），仅用于兼容旧组件。**新代码禁止引用这些别名**，应直接使用 `--c-*` token。

---

## 1. 设计气质与原则

### 1.1 系统定位

AIDA（Agentic Integrated Delivery Arena，智能体集成交付架构）是面向算力交付的**履约编排系统**。前端是 AI 原生四层架构（Wiki 大脑 → DORA 本体 → 交付 Claw/Agent → 交付编排应用）的**唯一"出口"**。

### 1.2 气质关键词

| 维度 | 描述 |
|------|------|
| 整体基调 | 浅色底、高可读、企业级克制 |
| 视觉风格 | slate 画布 + 白色面板，1px 描边分层，**克制**阴影 |
| 品牌信号 | indigo 专门承担「AI / 可交互 / 选中」语义 |
| 数据展示 | 紧凑表格为主，信息密集但留白克制 |
| 层级表达 | 靠海拔/对比/边框/微动效，不靠重阴影或深色块 |

### 1.3 核心设计原则

1. **态势优先，而非工具优先**：先让用户看到交付态势与 AI 研判
2. **信息逐级披露**：每层只露宏观信息 + 关键异常，下钻深入
3. **AI 可见即可信**：每条研判可溯源，排期调整必须展示对照
4. **一套数据、多个镜头**：通过视角切换器在全局/PD/TD 间切换
5. **企业级克制视觉**：可信度来自结构而非特效

### 1.4 红线（禁止）

- ❌ 霓虹/发光/赛博/消费品风格
- ❌ 机器人/脑/电路板/盾牌/地球网格等泛 AI 图形
- ❌ 大面积蓝紫渐变或深色块
- ❌ 硬编码 hex / px（一律用 token）
- ❌ 用品牌红（`--aida-red`）表达风险/错误

---

## 2. 颜色 Tokens

> **铁律**：写页面永远引用 `var(--c-*)`，不硬编码 hex 或像素。换肤只需覆盖 `:root` 中的 token。

### 2.1 中性色 / 表面（Slate 体系）

| Token | 色值 | 用途 |
|-------|------|------|
| `--c-bg` | `#f6f8fb` | 页面/主内容区底色 |
| `--c-bg-soft` | `#eef2f7` | 卡片内凹陷区、轨道、次级分组底 |
| `--c-surface` | `#ffffff` | 面板/卡片/弹层表面 |
| `--c-surface-2` | `#fafbfc` | 次级表面、表头、嵌套区域 |
| `--c-border` | `#e3e8ef` | 默认 1px 描边 |
| `--c-border-strong` | `#cbd5e1` | hover/强调描边 |
| `--c-divider` | `#eef2f7` | 分隔线 |

**构图原则**：白卡（`--c-surface`）浮在 slate 画布（`--c-bg`）上——这是本系统的基本构图公式。

### 2.2 文本色（四级灰阶）

| Token | 色值 | 用途 |
|-------|------|------|
| `--c-text` | `#0f172a` | 主文本、标题 |
| `--c-text-2` | `#334155` | 次文本、正文 |
| `--c-text-muted` | `#64748b` | 弱化、元信息、标签 |
| `--c-text-faint` | `#94a3b8` | 最弱、占位、时间戳 |

层级用**颜色深浅**拉开，而非字号堆叠。

### 2.3 品牌色（Indigo）

`--c-brand` 是主品牌色，同时专门承担 **「AI 在动作 / 可点击 / 当前选中」** 语义：

| Token | 色值 | 用途 |
|-------|------|------|
| `--c-brand` | `#3551d8` | 主按钮、链接、选中态、导航 active |
| `--c-brand-hover` | `#2a44c2` | 按下/悬停加深 |
| `--c-brand-soft` | `#eef1fc` | 浅底（选中行、chip 底） |
| `--c-brand-text` | `#1e34a8` | 浅底上的品牌文字 |

### 2.4 语义状态色

每档 **主色 / soft 浅底 / text 文字 三件套**，组合方式固定：
- **状态标签** = `*-soft` 浅底 + `*-text` 文字 + 透明描边
- **实色** = 进度段/强调条/图标

| 语义 | 主色 | 浅底 `-soft` | 文字 `-text` |
|------|------|-------------|-------------|
| `success` 成功 | `#0f9d58` | `#e6f6ee` | `#0a7d46` |
| `warning` 警告 | `#d97706` | `#fdf2dd` | `#9a5b08` |
| `danger` 危险 | `#dc2626` | `#fde8e8` | `#a31919` |
| `info` 信息 | `#2563eb` | `#e6efff` | `#1747b8` |

### 2.5 风险等级

活动条/风险标签专用三档。⚠️ 浅底后缀为 `-bg`（与其他 token 的 `-soft` 不一致，系历史原因）：

| 等级 | 主色 | 浅底 `-bg` |
|------|------|-----------|
| `high` | `#d92e2e` | `#fde6e6` |
| `mid` | `#d98014` | `#fdeed6` |
| `low` | `#b58a0c` | `#fbf3d3` |

- **Solid 版**：实色底 + 白字，用于彩色背景（如活动条内）
- **Ghost 版**：`*-bg` 浅底 + 主色字，用于浅色背景（如列表/标签）

### 2.6 品牌红（例外，慎用）

`--aida-red: #c7000a` —— **仅限** Logo 与极少数关键品牌标识。⚠️ 缺少 `--c-` 前缀（历史原因），**禁止**用它表达「风险/错误」——风险语义一律走 `--c-danger` / `--c-warning`。

### 2.7 深色导航 Token

侧边栏使用独立的 `--fdy-*` token 体系（scoped to `.left-nav-fdy`）：

| Token | 色值 | 用途 |
|-------|------|------|
| `--fdy-bg` | `#1a1f2a` | 侧边栏底色 |
| `--fdy-bg-2` | `#232936` | 次级底色 |
| `--fdy-bg-soft` | `#2a3140` | 软底色 |
| `--fdy-border` | `#2f3645` | 边框 |
| `--fdy-border-soft` | `#262c38` | 软边框 |
| `--fdy-text` | `#e6e9ee` | 主文本 |
| `--fdy-text-2` | `#b4bcc9` | 次文本 |
| `--fdy-text-3` | `#7c8696` | 弱文本 |
| `--fdy-text-4` | `#5a6470` | 最弱文本 |
| `--fdy-hl-bg` | `rgba(255,255,255,.04)` | hover 高亮 |
| `--fdy-active-bg` | `rgba(53,81,216,.18)` | 选中态背景 |
| `--fdy-active-bar` | `#6a7df0` | 选中态左侧指示条 |

### 2.8 扩展色板（Tailwind 兼容）

前端 `globals.css` 额外定义了以下色阶，供 Tailwind utility 和旧组件使用：

| 色系 | Token 范围 | 用途 |
|------|-----------|------|
| Zinc/Slate | `--zinc-50` … `--zinc-800` | 通用灰阶 |
| Blue | `--blue-50`, `--blue-100`, `--blue-600`, `--blue-700` | 蓝色辅助 |
| Green | `--green-50`, `--green-100`, `--green-600`, `--green-700` | 绿色辅助 |
| Red | `--red-50`, `--red-100`, `--red-600`, `--red-700` | 红色辅助 |
| Amber | `--amber-50`, `--amber-100`, `--amber-700` | 琥珀辅助 |
| Purple | `--purple-50`, `--purple-100`, `--purple-600` | 紫色辅助 |

> 新代码优先使用 `--c-*` 语义 token；仅在 Tailwind 无法引用 CSS 变量时使用上述色阶。

---

## 3. 排版

### 3.1 字体

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", "Source Han Sans SC", "Noto Sans CJK SC", Arial, sans-serif` | 正文 |
| `--font-mono` | `"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` | 数字、ID、代号、时间戳 |

页面基准：14px / 行高 1.55。

### 3.2 字阶

| Token | 字号/字重 | 用途 |
|-------|-----------|------|
| `--fs-10` | 10px | 极小标注 |
| `--fs-11` | 11px | eyebrow 小标签 |
| `--fs-12` | 12px | 元信息 |
| `--fs-13` | 13px | 紧凑正文、表格、按钮 |
| `--fs-14` | 14px | 正文基准 |
| `--fs-16` | 16px | 强调正文 |
| `--fs-18` | 18px / 600 | 区块标题（h2） |
| `--fs-20` | 20px | 次级大标题 |
| `--fs-22` | 22px / 600 / -.01em | 页面标题（h1） |
| `--fs-24` | 24px / 600 / -.01em | 大标题（display） |
| `--fs-26` | 26px / 600 / -.01em | KPI 大数值（metric） |
| `--fs-32` | 32px | 超大标题 |

### 3.3 三条硬规则

1. **所有数字都要 `font-variant-numeric: tabular-nums`** ——等宽数字让纵向对齐、跳动不抖动。这是本系统的标志性细节。
2. **eyebrow 小标签**：11px、`letter-spacing` .04–.06em、`text-transform: uppercase`、配 `--c-text-muted`。用于 KPI label、区块眉题。
3. **大标题用负字距**（`letter-spacing: -0.01em`），收紧观感；小字不加。

---

## 4. 间距与圆角

### 4.1 8pt 间距制

| Token | 值 | Token | 值 |
|-------|-----|-------|-----|
| `--sp-1` | 4px | `--sp-5` | 20px |
| `--sp-2` | 8px | `--sp-6` | 24px |
| `--sp-3` | 12px | `--sp-8` | 32px |
| `--sp-4` | 16px | `--sp-10` | 40px |

> 跳过 7、9，保持 4 的倍数节奏。

常用节奏：
- 卡片/面板内边距：`--sp-3` `--sp-4`（头）/ `14px` `--sp-4`（体）
- chip / 小控件内边距：`2px 7px` ~ `4px 10px`
- 元素间隙 `gap`：`6px / 8px / 10px / 12px`

### 4.2 圆角

| Token | 值 | 用在 |
|-------|-----|------|
| `--r-sm` | 4px | chip / tag / 状态标签 / 小控件 |
| `--r-md` | 6px | 按钮 / 输入框 / 导航项 / seg |
| `--r-lg` | 8px | 卡片 / 面板 / popover |
| `--r-xl` | 12px | 大容器 |
| `--r-pill` | 999px | 过滤胶囊 / 进度条 / live 圆点 |

**不要临时发明新的圆角值**，从 scale 里取。

---

## 5. 阴影与层级

分层主要靠**描边**，阴影是点缀，**没有霓虹/发光**。

| Token | 值 | 用途 |
|-------|-----|------|
| `--shadow-sm` | `0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03)` | 卡片、面板静置态 |
| `--shadow-md` | `0 4px 14px rgba(15,23,42,.06), 0 1px 4px rgba(15,23,42,.04)` | 抬起态、次级浮层 |
| `--shadow-lg` | `0 12px 28px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.05)` | popover / 抽屉 |

- 阴影颜色统一用 slate（`rgba(15,23,42,*)`）低透明度，而非纯黑
- **焦点态**全站统一：`outline: 2px solid var(--c-brand-soft); border-color: var(--c-brand)`
- 遮罩用 `rgba(15,23,42,.32)`

---

## 6. 布局骨架（应用壳）

### 6.1 整体结构

```
┌──────────┬──────────────────────────────────────┐
│          │  Topbar (44px, 白色)                  │
│  Sidebar │──────────────────────────────────────│
│  (232px  │                                      │
│   深色)   │  Main Content                        │
│          │  (可滚动, slate 底色)                  │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

### 6.2 布局 Token

| Token | 值 | 说明 |
|-------|-----|------|
| `--nav-w` | `232px` | 侧边栏展开宽度 |
| `--nav-w-collapsed` | `56px` | 侧边栏收起宽度 |
| `--topbar-h` | `44px` | 顶栏高度 |
| `--claw-w` | `360px` | 对话栏展开宽度 |
| `--claw-w-collapsed` | `44px` | 对话栏收起宽度 |

### 6.3 控件尺寸 Token

| Token | 值 | 说明 |
|-------|-----|------|
| `--ctrl-h` | `32px` | 标准控件高度（按钮/输入框） |
| `--ctrl-h-sm` | `26px` | 紧凑控件高度 |
| `--pad-panel` | `14px 16px` | 面板内边距标准值 |

### 6.4 侧边栏（深色导航 `.left-nav-fdy`）

| 区域 | 规格 |
|------|------|
| 品牌区 | Logo（22px）+ wordmark，底部分隔线 |
| 导航组 | icon（18px）+ label（13px），active 态左侧 2px indigo 竖条 |
| 子项 | 缩进 38px，左侧竖线连接，active 态文字高亮 |
| 底部 | 用户头像（28px 圆形渐变）+ 名称 + 版本号 |
| 折叠态 | 仅显示 icon，文字/徽标/子项全部隐藏 |
| 滚动条 | 3px 深色，hover 可见 |
| 过渡 | `grid-template-columns 0.3s ease-in-out` |

**色调 Token 体系**：nav 使用独立的 `--fdy-*` 深色 token，不与主区 `--c-*` 混用。具体色值见 §2.7。

### 6.5 顶栏（Topbar `.topbar`）

- 高度 `--topbar-h`（44px），白色底，`z-index: 40`
- 左侧：当前项目名称（13px / 600），仅展示不可切换
- 右侧：WeLink 通知铃铛（红点 `#dc2626` 胶囊）+ 用户 chip
- 用户 chip：`border-radius: 999px`，hover → `--c-bg`，头像 22px 品牌红渐变圆形
- 下拉菜单：白底 + `--c-border` + `--shadow-md`，项目行 hover → `--c-bg-soft`

---

## 7. 通用组件范式

> 下文组件均有对应的 CSS class 或 React 组件实现。新页面直接复用，不要重写。

### 7.1 按钮 `.btn` / `<Button>`

圆角 `--r-md`，transition `background .12s`：

| 变体 | 背景 | 文字色 | 描边 | hover 背景 |
|------|------|--------|------|-----------|
| default | `--c-surface` | `--c-text-2` | `--c-border` | `--c-surface-2` |
| primary | `--c-brand` | `#fff` | `--c-brand` | `--c-brand-hover` |
| ghost | transparent | `--c-text-2` | transparent | `--c-bg` |
| danger | `--red-50` | `--red-700` | `--red-100` | `--red-100` |
| dark | `--zinc-800` | `--zinc-100` | transparent | `--zinc-700` |

尺寸：`sm`（`--ctrl-h-sm` 26px / 12px）/ `md`（`--ctrl-h` 32px / 13px）/ `lg`（40px / 14px）。

### 7.2 状态标签 `.tag` / `<Badge>`

本系统**最核心**的小组件。公式固定：

```
*-soft 浅底 + *-text 文字 + 透明描边 + --r-sm 圆角
```

| 变体 | 浅底 | 文字色 |
|------|------|--------|
| `.solid-brand` | `--c-brand-soft` | `--c-brand-text` |
| `.solid-info` | `--c-info-soft` | `--c-info-text` |
| `.solid-green` | `--c-success-soft` | `--c-success-text` |
| `.solid-amber` | `--c-warning-soft` | `--c-warning-text` |
| `.solid-red` | `--c-danger-soft` | `--c-danger-text` |

尺寸：11px / `2px 7px` / `--r-sm`。

React 实现：`<Badge tone="accent|blue|green|red|amber|purple|dark" size="xs|sm|md" dot />`

### 7.3 风险胶囊 `.risk-pill`

16px 高、10px 加粗、3px 圆角。

| 变体 | 样式 | 用于 |
|------|------|------|
| `.high` / `.mid` / `.low` | 实色底 + 白字 | 彩色背景上（活动条内） |
| `.ghost-high` / `.ghost-mid` / `.ghost-low` | `*-bg` 浅底 + 主色字 | 浅色背景上（列表/标签） |

### 7.4 卡片 `.card` / `<Panel>`

白底 + `--c-border` + `--r-lg`：

| 区域 | 样式 |
|------|------|
| `.card-head` | `--sp-3` `--sp-4` 内边距 + `--c-divider` 底分隔 |
| `.card-title` | 13px / 600 / `--c-text` |
| `.card-body` | `14px` `--sp-4` 内边距 |

React 实现：`<Panel title subtitle action tone="default|raised|accent|amber|blue|red|green" />`
- `tone` 带 accent 时左侧 3px 彩条 + 标题旁 3×14px 色块

### 7.5 KPI `.kpi` / `<KPI>`

白底 + `--c-border` + `--r-lg` + `--sp-3` `14px` 内边距：

| 元素 | 样式 |
|------|------|
| `.kpi-label` | 11px / uppercase / `--c-text-muted` / `.04em` |
| `.kpi-value` | 22px / 600 / `tabular-nums` / `-.01em` |
| `.kpi-delta.up` | `--c-success-text` |
| `.kpi-delta.down` | `--c-danger-text` |
| `.kpi.warn` | 暖黄渐变底 + 琥珀描边 |
| `.kpi.risk` | 暖红渐变底 + 红描边 |

React 实现：`<KPI label value unit suffix decimals delta tone sparkline />`

### 7.6 输入框 `.input` / `.select`

白底 + `--c-border` + `--r-md` + `7px 10px` 内边距：
- 聚焦态：`--c-brand` 描边 + `--c-brand-soft` 2px outline
- 配 `.field-label`（12px / 500）+ `.field-hint`（11px muted）

### 7.7 分段控件 `.seg` / 过滤胶囊 `.pill`

- `.seg`：`--c-bg` 底 + `--c-border` + `--r-md`；`.active` → 白底 + `--shadow-sm`
- `.pill`：`--c-bg` 底 + `--c-border` + `--r-pill`；`.active` → `--c-brand-soft` 底 + `--c-brand` 描边 + `--c-brand-text` 文字

### 7.8 表格 `.vs-table`

| 区域 | 样式 |
|------|------|
| 表头 `th` | 11px / uppercase / `--c-text-muted` / `--c-bg` 底 / `.04em` |
| 单元格 `td` | 13px / `8px 10px` / `--c-divider` 底分隔 |
| `td.num` | 右对齐 + `tabular-nums` |
| 行 hover | `--c-bg` 底 |

### 7.9 浮层 `.popover`

白底 + `--c-border` + `--shadow-lg` + `--r-lg` + 340px 宽：

| 区域 | 样式 |
|------|------|
| `.pv-head` | `--sp-3` `14px` `--sp-2` + `--c-divider` 底分隔 |
| `.pv-body` | `10px` `14px` `--sp-3` |
| `.pv-row` | flex 键值对（`.k` muted / `.v` `tabular-nums`） |
| `.pv-risk` | `--c-warning-soft` 底 + 左侧 3px 实色边；`.high` → `--c-danger` |

### 7.10 提示条 `.callout`

浅底 + 左侧 3px 同色边，圆角 6px，内边距 `14px` `--sp-4`：

| 变体 | 底色 | 文字色 | 左边色 |
|------|------|--------|--------|
| *(default)* | `--c-warning-soft` | `--c-warning-text` | `--c-warning` |
| `.red` | `--c-danger-soft` | `--c-danger-text` | `--c-danger` |
| `.green` | `--c-success-soft` | `--c-success-text` | `--c-success` |
| `.info` | `--c-info-soft` | `--c-info-text` | `--c-info` |

### 7.11 进度条 `<Progress>`

- 轨道：`--c-bg-soft`（或 `--zinc-100`），`--r-pill`
- 填充色：`--c-brand`（running）/ `--c-success`（done）/ `--c-danger`（error）
- running 态带流动动画（`.claw-flow-bar`）
- React：`<Progress value={0-100} status="default|running|done|error" height={6} showValue />`

### 7.12 骨架屏 `<Skeleton>`

扫光动画 `claw-shimmer`（左→右），圆角 4px。
React：`<Skeleton width height={16} />`

### 7.13 两种反复出现的范式

1. **左侧彩条**：用 `::before` 或 `border-left` 画 2–3px 色条表严重度/分类，比整块染色更克制
2. **行/卡片 hover**：背景转 `--c-bg`，描边转 `--c-border-strong`，可选 `translateY(-1px)` + `--shadow-sm`

---

## 8. 品牌标识

### 8.1 系统名称

| 项目 | 内容 |
|------|------|
| 品牌名 | **AIDA** |
| 英文全称 | Agentic Integrated Delivery Arena |
| 中文 | 智能体集成交付架构 |
| 发音 | 艾达 |

### 8.2 Logo 方案：AIDA Gateway

以大写字母 **A** 为基础，构造"架构之门"：

| 字母 | 视觉表达 | 业务含义 |
|------|----------|----------|
| A | 上升的结构门形 | **A**gentic — 从信息化升级为智能体化 |
| I | 横向连接梁与中心通道 | **I**ntegrated — 多平台、多工具统一接入 |
| D | 向前推进的红色路径 | **D**elivery — 任务承接、执行、闭环 |
| A | 稳定的几何框架 | **A**rchitecture — 企业级底座和长期架构 |

### 8.3 组合方式

| 场景 | 推荐组合 |
|------|----------|
| PPT 封面 / 系统首页 | 图形标 + AIDA 字标 + 英文全称 |
| 系统导航栏 | 图形标 + AIDA wordmark |
| App 图标 / favicon | 仅图形标（最小 20px） |
| 深色背景 | 白色图形标 + 红色路径 |

### 8.4 品牌色

| 用途 | 色值 | Token |
|------|------|-------|
| 界面主色 | `#3551d8` (indigo) | `--c-brand` |
| Logo 集成路径 | `#c7000a` (品牌红) | `--aida-red` |

### 8.5 字体建议

- 英文：几何无衬线（Inter / Aptos Display / Helvetica Now / DIN）
- 中文辅助：Microsoft YaHei / HarmonyOS Sans SC（不进入主标核心图形）

---

## 9. 动画系统

### 9.1 微动效清单

| 动画名 | 用途 | 关键参数 |
|--------|------|----------|
| `clawStepperPulse` | Stepper 当前步骤呼吸 | `box-shadow` 0→6px，1.4s |
| `sdui-pulse` | 加载中闪烁 | `opacity` 1→.5，通用 |
| `sdui-node-in` | SDUI 节点入场 | `opacity` 0→1 + `translateY(7px→0)` |
| `sdui-alert-in` | Alert 入场 | `translateY(-9px→0)`（从上方落下） |
| `sdui-pop` | KPI 数字弹入 | `scale(0.88→1.015→1)` 弹簧 |
| `sdui-shimmer` | Skeleton 扫光 | `background-position` -400px→400px |
| `sdui-stagger` | 列表项错开入场 | `translateX(-5px→0)`，子项 `delay: var(--i)*45ms` |
| `sd-out-pulse` | 输出件高亮脉冲 | `box-shadow` 0→3px brand |
| `sdui-dot-blink` | 执行中省略号 | 三个点依次 `opacity` 0↔1 |
| `fdy-pulse` | 侧边栏 live 灯呼吸 | `box-shadow` 1px→3px green |
| `clawSpringIn` | 文件 chip 弹簧入场 | 配合 `AnimatedNumber` ease-out |

### 9.2 过渡规范

| 对象 | 过渡 |
|------|------|
| 按钮/标签/输入框 | `background .12s ease, border-color .12s ease, color .12s ease` |
| 侧边栏折叠 | `grid-template-columns 0.3s ease-in-out` |
| 进度条 | `width .4s ease` |
| 列表项入场 | `sdui-stagger .35s ease both` |

### 9.3 原则

- 微动效用于**反馈**（hover/active/focus）和**引导**（入场/加载），不做纯装饰
- 持续时间 0.12s–0.4s，缓动 ease / ease-in-out
- **禁止**大面积/长时间的装饰性动画

---

## 10. SDUI 组件类型

SDUI（Server-Driven UI）是 AIDA 的核心交互范式——后端投影 UI 树（`sdui.py` → `project(state) → UI 树`），前端通用渲染。**协议三方一致**（`builder.py` ↔ `sdui.ts` ↔ `SduiNodeView`）。

### 10.1 容器/布局

| 节点类型 | 说明 |
|----------|------|
| `SduiCardNode` | 卡片容器（header / title / headerAction / body） |
| `SduiStackNode` | 垂直栈布局 |
| `SduiRowNode` | 水平行布局 |
| `SduiTabsNode` | 标签页容器 |
| `SduiAccordionNode` | 手风琴折叠面板 |
| `SduiWorkbenchNode` | 工作台（左右分栏） |

### 10.2 数据展示

| 节点类型 | 说明 |
|----------|------|
| `SduiTextNode` | 文本块（支持 tone / weight / size） |
| `SduiMarkdownNode` | Markdown 渲染 |
| `SduiBadgeNode` | 徽标（tone / dot） |
| `SduiTableNode` | 通用表格 |
| `SduiDataTableNode` | 类型化数据表格（筛选 / 分页 / 行操作 / 勾选 / 多值列） |
| `SduiKeyValueListNode` | 键值对列表 |
| `SduiStatisticNode` | 单统计数值 |
| `SduiStatisticRowNode` | 统计行 |
| `SduiNumberCardNode` | KPI 数字卡（可点击联动表格筛选） |
| `SduiCodeBlockNode` | 代码块 |
| `SduiLogStreamNode` | 日志流 |

### 10.3 图表

| 节点类型 | 说明 |
|----------|------|
| `SduiDonutChartNode` | 环形图 |
| `SduiBarChartNode` | 柱状图 |
| `SduiGoldenMetricsNode` | 黄金指标面板 |
| `SduiTimelineNode` | 时间线 |
| `SduiPlaneMatrixNode` | 平面矩阵 |

### 10.4 交互/反馈

| 节点类型 | 说明 |
|----------|------|
| `SduiButtonNode` | 按钮 |
| `SduiMenuButtonNode` | 菜单按钮 |
| `SduiLinkNode` | 链接 |
| `SduiAlertNode` | 提示横幅 |
| `SduiBannerNode` | 顶部通告栏 |
| `SduiHitlNode` | 人机交互卡（HITL，Human-in-the-Loop） |
| `SduiEmptyStateNode` | 空态占位 |
| `SduiSpinnerNode` | 加载旋转器 |
| `SduiProgressBarNode` | 进度条 |
| `SduiChecklistNode` | 检查清单 |
| `SduiStepperNode` | 步骤指示器 |

### 10.5 文件/产出

| 节点类型 | 说明 |
|----------|------|
| `SduiArtifactGridNode` | 产出物网格（预览 + 下载 xlsx/docx） |
| `SduiFileTreeNode` | 文件树 |
| `SduiInputSlotNode` | 输入件槽位（等待 / 已就绪 / 上传） |

### 10.6 专用业务

| 节点类型 | 说明 |
|----------|------|
| `SduiRiskListNode` | 风险列表 |
| `SduiDividerNode` | 分隔线 |
| `SduiSkeletonNode` | 骨架屏占位 |

---

## 11. 前端技术栈

| 层 | 技术 |
|----|------|
| 构建 | Vite 8 |
| 框架 | React 19 + TypeScript（`strict: true`） |
| 路由 | react-router-dom 7（BrowserRouter） |
| 样式 | **混合模式**：CSS Variables（token）+ Tailwind utilities（`preflight: false`） |
| 动画 | Framer Motion + CSS `@keyframes` |
| 图标 | Lucide React |
| SDUI | SSE 流式渲染（`useSduiStream` → `SduiNodeView` 通用递归） |

### 11.1 样式混合模式

前端采用 CSS Variables + Tailwind 共存：

- **CSS Variables**（`globals.css`）：定义所有 design token + 组件 class（`.btn`, `.card`, `.tag` 等）
- **Tailwind**（`preflight: false`）：仅注入 `utilities`，不注入 Reset，零冲突。`tailwind.config.cjs` 映射了品牌色到 Tailwind 主题（`brand` / `danger` / `success` / `warning`）。

### 11.2 前端 token 别名层

`globals.css` 在 `:root` 中定义了语义别名，供旧组件兼容。**新代码禁止引用这些别名**：

```css
/* 都指向 --c-* token，仅用于旧组件迁移期 */
--accent:         var(--c-brand);
--accent-hover:   var(--c-brand-hover);
--accent-muted:   var(--c-brand-soft);
--surface:        var(--c-surface);
--surface-raised: var(--c-surface-2);
--border:         var(--c-border);
--text-primary:   var(--c-text);
--text-secondary: var(--c-text-2);
--text-tertiary:  var(--c-text-muted);
--radius-sm:      var(--r-sm);
--radius-md:      var(--r-md);
--radius-lg:      var(--r-lg);
--radius-xl:      var(--r-xl);
--radius-full:    var(--r-pill);
```

---

## 12. 颜色使用决策树

```
需要表达状态？
├─ 成功/正常 → --c-success / --c-success-soft / --c-success-text
├─ 警告/注意 → --c-warning / --c-warning-soft / --c-warning-text
├─ 危险/错误 → --c-danger / --c-danger-soft / --c-danger-text
└─ 信息/中性 → --c-info / --c-info-soft / --c-info-text

需要表达风险等级？
├─ 高风险 → --c-risk-high / --c-risk-high-bg
├─ 中风险 → --c-risk-mid / --c-risk-mid-bg
└─ 低风险 → --c-risk-low / --c-risk-low-bg

需要交互信号？
├─ 可点击/选中/AI在动作 → --c-brand / --c-brand-soft
└─ 禁用/不可交互 → --c-text-faint / --c-bg-soft

品牌标识（Logo）
└─ → --aida-red（仅此用途！不要用于风险/错误）
```

---

## 13. 完整 Token 速查表

```css
:root {
  /* ═══ 中性色 / 表面 ═══ */
  --c-bg: #f6f8fb;
  --c-bg-soft: #eef2f7;
  --c-surface: #ffffff;
  --c-surface-2: #fafbfc;
  --c-border: #e3e8ef;
  --c-border-strong: #cbd5e1;
  --c-divider: #eef2f7;

  /* ═══ 文本 ═══ */
  --c-text: #0f172a;
  --c-text-2: #334155;
  --c-text-muted: #64748b;
  --c-text-faint: #94a3b8;

  /* ═══ 品牌 Indigo ═══ */
  --c-brand: #3551d8;
  --c-brand-hover: #2a44c2;
  --c-brand-soft: #eef1fc;
  --c-brand-text: #1e34a8;

  /* ═══ 语义状态 ═══ */
  --c-success: #0f9d58;
  --c-success-soft: #e6f6ee;
  --c-success-text: #0a7d46;
  --c-warning: #d97706;
  --c-warning-soft: #fdf2dd;
  --c-warning-text: #9a5b08;
  --c-danger: #dc2626;
  --c-danger-soft: #fde8e8;
  --c-danger-text: #a31919;
  --c-info: #2563eb;
  --c-info-soft: #e6efff;
  --c-info-text: #1747b8;

  /* ═══ 风险等级 ⚠️ 浅底后缀为 -bg（不一致，见 §0.3） ═══ */
  --c-risk-high: #d92e2e;   --c-risk-high-bg: #fde6e6;
  --c-risk-mid: #d98014;    --c-risk-mid-bg: #fdeed6;
  --c-risk-low: #b58a0c;    --c-risk-low-bg: #fbf3d3;

  /* ═══ 品牌红 ⚠️ 缺 --c- 前缀（不一致，见 §0.3） ═══ */
  --aida-red: #c7000a;

  /* ═══ 深色导航 ═══ */
  --fdy-bg: #1a1f2a;
  --fdy-bg-2: #232936;
  --fdy-bg-soft: #2a3140;
  --fdy-border: #2f3645;
  --fdy-border-soft: #262c38;
  --fdy-text: #e6e9ee;
  --fdy-text-2: #b4bcc9;
  --fdy-text-3: #7c8696;
  --fdy-text-4: #5a6470;
  --fdy-hl-bg: rgba(255,255,255,.04);
  --fdy-active-bg: rgba(53,81,216,.18);
  --fdy-active-bar: #6a7df0;

  /* ═══ 扩展色板 (Tailwind 兼容) ═══ */
  --zinc-50: #f8fafc;   --zinc-100: #f1f5f9;   --zinc-200: #e2e8f0;
  --zinc-300: #cbd5e1;  --zinc-400: #94a3b8;   --zinc-500: #64748b;
  --zinc-600: #475569;  --zinc-700: #334155;   --zinc-800: #1e293b;
  --blue-50: #eff6ff;   --blue-100: #dbeafe;   --blue-600: #2563eb;   --blue-700: #1d4ed8;
  --green-50: #ecfdf5;  --green-100: #d1fae5;  --green-600: #10b981;  --green-700: #047857;
  --red-50: #fef2f2;    --red-100: #fee2e2;    --red-600: #dc2626;    --red-700: #b91c1c;
  --amber-50: #fffbeb;  --amber-100: #fef3c7;  --amber-700: #b45309;
  --purple-50: #faf5ff; --purple-100: #f3e8ff; --purple-600: #9333ea;

  /* ═══ 字体 ═══ */
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei",
               "Helvetica Neue", "Source Han Sans SC", "Noto Sans CJK SC", Arial, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  /* ═══ 字号 ═══ */
  --fs-10: 10px; --fs-11: 11px; --fs-12: 12px; --fs-13: 13px; --fs-14: 14px;
  --fs-16: 16px; --fs-18: 18px; --fs-20: 20px; --fs-22: 22px;
  --fs-24: 24px; --fs-26: 26px; --fs-32: 32px;

  /* ═══ 圆角 ═══ */
  --r-sm: 4px; --r-md: 6px; --r-lg: 8px; --r-xl: 12px; --r-pill: 999px;

  /* ═══ 阴影 ═══ */
  --shadow-sm: 0 1px 2px rgba(15,23,42,.04), 0 1px 1px rgba(15,23,42,.03);
  --shadow-md: 0 4px 14px rgba(15,23,42,.06), 0 1px 4px rgba(15,23,42,.04);
  --shadow-lg: 0 12px 28px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.05);

  /* ═══ 间距 (8pt grid) ═══ */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;  --sp-10: 40px;

  /* ═══ 布局尺寸 ═══ */
  --nav-w: 232px;            --nav-w-collapsed: 56px;
  --topbar-h: 44px;
  --claw-w: 360px;           --claw-w-collapsed: 44px;

  /* ═══ 控件尺寸 ═══ */
  --ctrl-h: 32px;            --ctrl-h-sm: 26px;
  --pad-panel: 14px 16px;
}
```

---

## 14. Do's and Don'ts

**Do**
- ✅ 颜色/字号/圆角/间距一律用 token：`var(--c-*)`、`var(--fs-*)`、`var(--r-*)`、`var(--sp-*)`
- ✅ 状态标签用「`*-soft` 底 + `*-text` 字 + 透明边」公式
- ✅ 所有数字加 `font-variant-numeric: tabular-nums`
- ✅ 把 indigo（`--c-brand`）留给「AI / 可交互 / 选中」语义
- ✅ 换品牌色：在 `:root` 覆盖 `--c-brand`（及可选的 `--c-brand-hover/-soft/-text`）
- ✅ 分层靠描边 + 弱阴影，信息靠结构组织
- ✅ 新 token 一律加对应前缀（`--c-` / `--r-` / `--sp-` / `--fs-`）

**Don't**
- ❌ 不要硬编码 hex / px——一旦写死，换肤和改品牌色就失效
- ❌ 不要用 `--aida-red` 表达风险/错误；风险走 `--c-danger` / `--c-warning`
- ❌ 不要用大面积深色块、霓虹/发光阴影、或赛博/消费品风格
- ❌ 不要临时发明圆角/间距数值，从既有 scale 里取
- ❌ 不要使用旧 token 名（`--bg` / `--surface-secondary` / `--brand-subtle` / `--radius-sm` 等，见 §0.4）
- ❌ 不要在组件中散落内联样式替代 token

---

<sub>本文件从 AIDA 主仓库以下来源抽取并标准化：
- 设计规范：`docs/80_设计UX/DESIGN.md`（YAML token 真相）、`UI视觉规范.md`（视觉骨架）、`visual-system.css`（CSS 实现）
- 设计意图：`docs/80_设计UX/设计Brief.md`、`页面设计偏好.md`
- 品牌：`docs/80_设计UX/品牌与草图/AIDA_Logo设计方案.md`
- 前端实现：`frontend/src/styles/globals.css`（token 落地）、`components/primitives.tsx`（通用组件）、`tailwind.config.cjs`（Tailwind 集成）
- Token 命名以 `globals.css` 中的 `--c-*` 体系为权威真相（与 DESIGN.md YAML front matter 一致），`UI视觉规范.md` 的旧名仅作迁移参考。</sub>
