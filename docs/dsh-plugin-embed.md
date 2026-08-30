# DSH 插件嵌入 AIDA UI 契约

日期：2026-08-30  
适用范围：与 `@aida/aida-ui-dsh` 同屏加载的 AIDA Web 插件，当前主要是：

- `@aida/dsh-lld-show-plugin`（系统设计）
- `@aida/dsh-liquid-email-plugin`（液冷通液）

本文是这些插件嵌入 AIDA UI 的对接基线。插件可以实现自己的业务界面，但全局
身份、背景、底部入口节奏和动效边界由 AIDA UI 统一约束。

## 1. 责任边界

| 区域 | 所有者 | 插件规则 |
| --- | --- | --- |
| AIDA 品牌、Hero、全局 atmosphere、主题 token | `@aida/aida-ui-dsh` | 业务插件不得重绘品牌、不得引入第二套全局主题 |
| Sidebar 底部入口 | 各业务插件 | 必须使用统一的 `aida-liquid` footer action 契约 |
| center+details 接管 | 各业务插件 | 通过 `conversation` slot 注册，不搬移 DSH React 节点 |
| 全局背景 | AIDA UI | 业务插件不得复制或二次绘制 atmosphere 图片 |
| 入口动效 | AIDA UI 契约 | 不做几何位移动效；激活态即时、清晰、可逆 |

业务插件不 import `@aida/aida-ui-dsh` 的内部模块，也不直接修改其 React 状态。
所有协作通过 DSH slot、theme token、CSS 局部规则和同 origin HTTP route 完成。

## 2. Sidebar 底部入口

### 2.1 顺序与插槽

当前固定顺序自上而下：

```text
系统设计
液冷通液
```

- 液冷通液注册 `sidebar.footer.action`，`order: 100`。
- 系统设计注册同一 slot，`order: 101`，并以液冷入口为锚点 portal 到其上方。
- 两个入口之间保持 `4px` 垂直间距。
- 系统设计是业务入口，不进入 workspace/session 列表。

### 2.2 DOM 契约

两个入口使用同一结构：

```tsx
<button
  type="button"
  className={[
    'aida-liquid-sidebar-action',
    wide ? '' : 'aida-liquid-rail',
    active ? 'aida-liquid-active' : '',
  ].filter(Boolean).join(' ')}
>
  <span className="aida-liquid-action-icon" aria-hidden>{icon}</span>
  {wide && (
    <span className="aida-liquid-action-label">
      {active ? closeLabel : label}
    </span>
  )}
</button>
```

文案要求：

| 插件 | resting | active | title |
| --- | --- | --- | --- |
| 系统设计 | `系统设计` | `关闭系统设计` | 与可见文案一致 |
| 液冷通液 | `液冷通液` | `关闭液冷通液` | 与可见文案一致 |

关闭控件就是这个高亮入口，不新增右上角关闭按钮、悬浮按钮或第二个退出入口。

## 3. Footer action CSS 契约

统一使用液冷通液的 project-row 形态：

```css
.aida-liquid-sidebar-action {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  box-sizing: border-box;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}
```

状态：

```css
.aida-liquid-sidebar-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.aida-liquid-sidebar-action.aida-liquid-rail {
  justify-content: center;
  padding: 0;
}

.aida-liquid-sidebar-action.aida-liquid-active {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-brand-text);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
}
```

当前实测尺寸：

```text
width:      sidebar 内容宽度（当前展开态 256px）
height:     34px
padding:    0 8px
border:     0
radius:     8px
resting:    transparent
active bar: 2px 品牌色左侧内阴影
```

不得回退为 36px 带边框的卡片行，不得给入口添加独立背景块、投影或渐变底。

## 4. Icon 与背景

### 4.1 Icon 容器

入口 icon 统一放在：

```css
.aida-liquid-action-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  font-size: 14px;
  line-height: 1;
}
```

规则：

- icon 容器没有自己的 border、background、box-shadow 或渐变底。
- 入口背景只由 button 本身的 resting/hover/active 状态控制。
- icon 是 `aria-hidden`，可访问名称由 button 文案和 `title` 提供。
- 不用 icon 颜色单独表达激活态；激活态必须同时有文字、背景和左侧品牌条。

### 4.2 系统设计 icon

系统设计保留网状蜘蛛图语义，使用 AIDA 品牌渐变：

```text
#1565C0 → #4FC3F7
```

SVG 尺寸 `16×16`，描边使用 `url(#aida-lld-icon-*)` 渐变，不使用 `currentColor`。

### 4.3 液冷通液 icon

液冷通液当前使用既有 `💧` 语义图标，作为该业务入口的历史认可标识。它的
容器同样透明，不新增图标底色；后续如替换为 SVG，应保持 16px 视口和语义不变。

### 4.4 全局 atmosphere

AIDA UI 独占全局 atmosphere：

```text
/aida-ui-assets/aida-background-v2.png?v=4
```

业务插件规则：

1. 不复制这张图片，不引用部署根下的旧 `/aida-background.png`。
2. 不在自己的区域重复绘制同款背景，避免重影。
3. 需要透出 atmosphere 的区域使用 `position: relative; z-index: 1` 加半透明底。
4. 需要高对比读图的工作台可以使用 DSH `bg-base` 不透明底。

当前差异是刻意设计：

| 插件 | 中心区背景 | 原因 |
| --- | --- | --- |
| 液冷通液 | `rgba(255, 255, 255, 0.72)` | 数据表需要轻玻璃感，背景约 28% 透出 |
| 系统设计 | `var(--dsw-alias-bg-base)` | SVG 组网图、端口和连线优先高对比阅读 |

## 5. Center takeover 规则

两个插件都使用同一接管模式：

1. 点击 footer action。
2. 调用 `layout.closeDetails()`。
3. 注册 `conversation` slot，`priority: -2`。
4. iframe 占据 center+details 合并区域，sidebar 保留。
5. active footer action 成为唯一退出控制。

Host route：

```text
系统设计：/aida/lld-show/
液冷通液：/aida/liquid-email/
```

iframe 不耦合 DSH React 内部，不搬移宿主节点，不修改 DSH session 数据。

## 6. 动效契约

底部入口当前不定义独立 keyframes，状态变化即时、确定、无几何位移。

允许的微过渡：

```text
属性：background-color / color
时长：140-180ms
缓动：DSH 默认或 [0.16, 1, 0.3, 1]
```

禁止：

- hover 或 active 时按钮位移、缩放、旋转；
- 入口持续动画；
- center 接管时整块界面横向/纵向飞入；
- 动画化 sidebar 宽度、footer 高度或 grid track；
- 用动效替代 active 文案和左侧品牌条。

如后续加入内容过渡，只能使用 `opacity` 与小范围 `transform`，并响应：

```css
@media (prefers-reduced-motion: reduce)
```

## 7. 验收清单

- 两个入口都使用 `aida-liquid-sidebar-action`。
- 展开态高度 `34px`、透明底、无边框、圆角 `8px`。
- active 态有左侧 `2px` 品牌指示条。
- 系统设计 active 文案是 `关闭系统设计`。
- 液冷通液 active 文案是 `关闭液冷通液`。
- 系统设计位于液冷通液上方，间距 `4px`。
- icon 容器透明，尺寸 `16px`。
- 系统设计 icon 使用 `#1565C0 → #4FC3F7`。
- 打开后无右上角关闭按钮；再次点击 footer action 关闭。
- center takeover 后 sidebar 保留，DSH 原生会话行为可恢复。
- console error 为 0，HTTP 4xx/5xx 为 0。

## 8. 变更流程

这份契约会在三个仓库中保持同步：

```text
aida-ui-plugin/docs/dsh-plugin-embed.md
aida-liquid-email-plugin/docs/integrate.md
aida-lld-show-plugin/docs/design.md
```

修改入口 CSS、icon、顺序、动效或 atmosphere 规则时，必须同时：

1. 更新本文的权威契约；
2. 更新两个业务插件中的落地说明；
3. 补充或更新静态测试；
4. 用真实 DSH Web 页面验证展开态、折叠态、resting、hover、active 和关闭行为。
