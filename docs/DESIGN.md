> **UI/UX layer — visual contract.** Look-and-feel only. The project's guiding
> design philosophy (Core vs UI/UX) lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

# Pi UI Multi-Theme Design System

## Overview

Pi UI 默认使用接近黑色、低眩光的灰黑主题，面向长时间运行的本地 Agent 工作台。ZenGrid
保留暖白编辑风格；AIDA 保留为由下方完整语义 token 定义的浅色企业控制台主题。
三个主题共用相同组件、间距、状态和交互，只通过 `html[data-theme]` 覆盖语义 token；业务
组件不得根据主题名改变行为。AIDA 可以改变字体角色、颜色与图标状态色，但不能改变信息架构、
控件行为或 Canvas 工作流。

Pi UI 仅设计和支持桌面环境。设计系统不提供手机、触屏专用、coarse-pointer 或移动端
响应式变体；但必须适应桌面浏览器缩放。缩放导致有效 CSS 视口变窄时，仍保持同一套双栏
工作台，通过流式栏宽、随 `dvh` 收缩的纵向 chrome、弹性 gutter、内容截断和区域内滚动
消化宽高变化，不产生页面级溢出，也不折叠为移动端抽屉或单列界面。Composer 必须按真实
高度占据底部空间，不能依赖固定的消息区留白来模拟避让。

主题由服务启动环境变量 `PI_UI_THEME` 配置，合法值为 `dark`、`zengrid` 与 `aida`；缺失或
非法值回退到 `dark`。语言由 `PI_UI_LANGUAGE` 配置，合法值为 `en`、`zh` 或 `zh-CN`，默认
`en`。集成品牌由 `PI_UI_BRAND` 配置，合法值为 `pi` 与 `aida`；未显式配置时，AIDA 主题默认
使用 AIDA 品牌，其余主题默认使用 Pi。品牌仍可显式独立覆盖，它只决定欢迎语署名。服务端在
返回 `index.html` 时注入配置，使它们在 React 挂载前生效；浏览器 localStorage 和顶栏按钮
不改变这些启动配置。

`UI_THEMES` 是主题注册表，`UI_LOCALES` 是 typed locale 注册表。扩展新主题时必须实现完整的语义颜色 token；扩展新语言时必须实现和基准 catalog 完全相同的 key 集。组件不分支判断具体主题或语言。

---

## Semantic Colors

默认灰黑色阶：

- **Surface Base** (#171717)
- **Surface Raised** (#202020)
- **Surface Sunken** (#121212)
- **Content Primary** (#E5E5E5)
- **Content Secondary** (#B8B8B8)
- **Content Tertiary** (#949494)
- **Border** (#343434)
- **Focus** (#B8B8B8)

ZenGrid 可选色阶：

- **Stone** (#78716C): Primary text, headings
- **Sage** (#A8A29E): Secondary text, borders
- **Warm White** (#FAF9F6): Background, surfaces
- **Surface Base** (#FAF9F6): App background
- **Success** (#65A30D): Published, live
- **Warning** (#CA8A04): Draft, needs review
- **Error** (#DC2626): Error, removed
- **Info** (#78716C): Informational (uses stone)

AIDA 可选色阶：

- **Canvas / Panel** (#F6F8FB / #FFFFFF): slate canvas with white work surfaces
- **Text / Secondary / Muted** (#0F172A / #334155 / #64748B)
- **Border / Strong Border** (#E3E8EF / #CBD5E1)
- **Brand Indigo** (#3551D8): product Logo, AI identity, primary action, active navigation and focus
- **Brand Soft** (#EEF1FC): selected rows and quiet active surfaces
- **Success / Warning / Danger / Info**: reserved functional state families for feedback only
Pi UI 的 AIDA 集成不使用原稿的 Red Logo；产品决策将 Logo、欢迎页 hover 和交互身份统一为
Brand Indigo，危险状态仍独立使用 Danger 色族。AIDA 原稿的 `#64748B` muted 值保留为规范色；Pi UI 中承担普通小字的
`--content-tertiary` 会略微加深以满足当前背景上的 WCAG AA。图标默认使用中性灰，只有可交互、
选中或 Agent 运行状态使用 Brand Indigo。

组件只使用 `--surface-*`、`--content-*`、`--border*`、`--accent*`、`--success`、`--warning`、`--error` 和 `--code-*`。AIDA 的白色 Panel 是已注册主题表面；除此之外，纯白只允许出现在 HTML iframe、Excalidraw 画纸等内容格式自身要求的表面。

## Typography

- **Headline Font**: Raleway
- **Body Font**: DM Sans
- **Mono Font**: Fira Code

AIDA 覆盖为 `Inter / Segoe UI / system-ui` 与 `SFMono-Regular / JetBrains Mono / Consolas`，
以匹配企业控制台密度；字体变化不得改变组件尺寸与交互布局。

- **h1**: Raleway 40px light, 1.15 line height
- **h2**: Raleway 32px light, 1.2 line height
- **h3**: Raleway 24px medium, 1.25 line height
- **h4**: Raleway 18px medium, 1.35 line height
- **body**: DM Sans 15px regular, 1.7 line height
- **small**: DM Sans 13px regular, 1.6 line height
- **tiny**: DM Sans 11px medium, 1.4 line height
- **mono**: Fira Code 13px regular, 1.6 line height

---

## Spacing

Base unit: 12px (spacious)
- **sp-1**: 6px
- **sp-2**: 12px
- **sp-3**: 24px
- **sp-4**: 36px
- **sp-5**: 48px
- **sp-6**: 72px
- **sp-7**: 96px
- **sp-8**: 120px

## Border Radius

- **radius-sm** (2px): Small elements, inline badges
- **radius-md** (4px): Cards, inputs, buttons
- **radius-lg** (6px): Modals
- **radius-none** (0px): Images, full-bleed sections

## Elevation

所有主题都使用平面层级。视觉深度由背景明度、边框与间距表达，不使用装饰性阴影或 glow。
AIDA 原稿允许弱阴影，但该规则与 Pi UI 的共享产品合同冲突，因此在集成主题中由边框和表面色
替代；这是有意的适配，不是遗漏。
- **shadow-none**: None. All elements.
Separation is expressed through border-default borders and background shifts between surface-base and surface-raised.

## Components

### Buttons

All buttons use 4px rounded corners (radius-md).

- **Primary**: Accent fill, content-on-accent text, no border, DM Sans medium (500). Hover and active use the stronger accent tokens. Available in small (12px text, 32px tall, 6px 16px padding), medium (14px text, 40px tall, 10px 20px padding), and large (15px text, 48px tall, 14px 28px padding).
- **Secondary**: Transparent fill, content-primary text, 1px strong border. Hover fills with surface-sunken background.
- **Ghost**: Transparent fill, content-secondary text, no border. Hover shifts text to content-primary.
- **Destructive**: Error fill, content-on-error text, no border. Hover uses the stronger error token.

Disabled buttons drop to 0.35 opacity with a disabled cursor.

### Cards

- **Default**: Raised surface with a 1px default border, 4px rounded corners, 36px padding, and no shadow.
- **Elevated**: Raised surface with a 1px strong border, 4px rounded corners, 48px padding, and no shadow. Differentiated by the heavier border weight.

### Agent Answers

- Keep a 20–24px Agent avatar or product Logo as the stable identity anchor.
- Do not pair the avatar with a redundant “completed” badge or heading.
- At rest, the answer surface contains content rather than a permanent action toolbar.
- Hover or keyboard focus reveals a single `···` action entry and one compact diagnostic line.
- Diagnostic order is fixed: `TTFT · TPOT · TPS · IN · OUT · CACHE`.
- Use Mono tiny text and tertiary color for diagnostics. TPS keeps one decimal; Token counts use
  `k` / `m`; `CACHE` is the current Session's weighted cumulative cache-hit percentage through that
  answer. Missing values disappear.
- Never render these diagnostics as six badges, cards, or columns.

### Shell Canvas

- The title is only the effective shell name: `PowerShell` or `Bash`.
- Duration may appear as tertiary text on the opposite edge.
- The command uses a `>` prompt and Mono text; output follows directly below.
- Successful results have no `Done` badge. Failure appends `· Failed` to the shell title and preserves the real error output.
- Do not repeat `Command`, `Combined output`, `Type`, or `Status` labels.

### Canvas Preview Surface

Trajectory steps, final Artifacts and files opened from Files use one outer visual grammar: the same
Canvas header/action slots, semantic border and surface tokens, loading/error placement, focus
treatment and owning scroll region. A first-open split is visually balanced at 50/50; a persisted
user resize may override it, while zoom-compressed desktop widths use the interaction contract's
safety clamp.

Only the outer chrome is shared. Thinking, Tool Call, Markdown, Code, image, PDF, Mermaid and
Excalidraw retain renderer-specific content bodies. Do not wrap every renderer in an identical inner
card or erase format-native spacing merely to make previews look uniform.

### Loading Surfaces

Loading states use the final surface's real master/detail or preview geometry, semantic surface
tokens and low-contrast neutral blocks. They do not introduce a third card language, branded splash,
shimmer sweep or layout movement. A genuine unresolved load may use one 1200ms opacity-only breathing
cycle; the transition from loading content to usable content is a 160ms opacity fade. Under
`prefers-reduced-motion` the breathing blocks remain static.

For HTML Canvas, the loading treatment occupies the renderer body below the normal Canvas toolbar.
It uses one small monochrome state mark and a concise locale-aware label. The iframe remains visually
hidden until its ready contract resolves, so a white or format-native document surface does not flash
through partially parsed content.

### Inputs

Inputs sit on the semantic sunken surface with 4px rounded corners, 10px 14px padding, and DM Sans 15px regular (400) text in content-primary. The border is 1px in the default border color.

In the default state there is no shadow. On hover the border strengthens to border-strong. On focus the border shifts to border-focus. In the error state the border turns red (error). No shadows appear in any state. When disabled the border returns to default and opacity drops to 0.35.

Labels are DM Sans 12px medium (500) in content-secondary with 6px bottom margin. Helper text is DM Sans 11px regular (400) in content-tertiary with 4px top margin; error helper text uses the error color.

### Chips

- **Filter**: Transparent fill, content-secondary text, 1px default border, 4px rounded corners, 4px 12px padding. Active state uses accent fill and content-on-accent text.
- **Status**: 4px rounded corners, 11px medium (500) text, 3px 10px padding. Published, Draft, Archived, and Removed consume success, warning, neutral, and error semantic tokens respectively.

### Lists

Transparent background with 1px default-color dividers. Each item has 12px 16px padding and 15px content-secondary text. On hover the background shifts to surface-sunken. The active row uses the subtle accent surface. Trailing elements include timestamps and chevrons.

### Checkboxes

16px square with 2px rounded corners and a 1px strong border. Unchecked background is surface-raised. When checked the box uses accent fill and a content-on-accent 1.5px-stroke checkmark. Focus shows a 2px border-focus outline offset by 2px. Disabled drops to 0.35 opacity.

### Radio Buttons

16px circular with a 1px strong border. Unchecked fill is surface-raised. When selected the border and 6px inner dot use the accent token. Focus shows a 2px border-focus outline offset by 2px. Disabled drops to 0.35 opacity.

### Tooltips

Inverse surface with content-inverse text at 12px, 2px rounded corners, 5px 10px padding, and no shadow. A 4px arrow matches the background. Maximum width is 200px. Shows after 400ms and hides after 100ms.

---

## Do's and Don'ts

1. **Do** let the grid dictate every layout decision; no element should break the column rhythm.
2. **Don't** bypass semantic theme tokens with component-local color values.
3. **Do** use light headline weights (300) for H1 and H2 to maintain the calm aesthetic.
4. **Don't** add shadows or glows; visual separation comes only from borders and background shifts.
5. **Do** use generous vertical spacing (48-120px) between major content sections.
6. **Don't** use bold or heavy font weights for body text; 400-500 maximum.
7. **Do** keep images unadorned -- no borders, no rounded corners, no overlays.
8. **Don't** center-align large blocks of text; always left-align for a clean reading line.
9. **Do** use content-tertiary for timestamps and metadata to keep them receded.
10. **Don't** use semantic colors for decorative purposes; reserve them strictly for functional states.

---

## Companion documents

- **[UX.md](./UX.md)** — interaction behavior, motion, accessibility, and the **克制 (progressive-disclosure)** principle that governs when information appears.
- **`.agents/skills/emil-design-eng/SKILL.md`** — animation/interaction craft (easing, press feedback, origin-aware popovers) applied across the workspace.
