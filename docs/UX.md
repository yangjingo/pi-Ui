> **UI/UX layer — interaction contract.** Behavior and feel only. Sessions,
> messages, and files now stream live from the Core agent (see
> [ARCHITECTURE.md](./ARCHITECTURE.md)); the principles below still govern how that
> live data is revealed to the user.

# UX Principles — Pi Workspace

The visual system lives in [DESIGN.md](./DESIGN.md) (ZenGrid). This document defines **how the interface behaves**. Interaction polish follows the `emil-design-eng` skill (`.claude/skills/emil-design-eng/SKILL.md`).

## 1. 克制 — Progressive Disclosure (primary principle)

Do not surface everything at once. Show the essence; reveal detail only when the user asks for it. The user sets the depth, not the interface.

**Defaults that respect restraint:**
- **Workspace is collapsed** on entry for every session (including completed ones). The user opens it with the panel toggle, or by clicking an artifact / trajectory step / "在 Canvas 中打开".
- **Trajectory is collapsed** — only its header shows ("Agent 执行轨迹 · N 步 · 已完成/进行中"). Steps appear when the header is clicked.
- **Step input/output** render on the right only when that step is clicked.
- **Drawers** (会话历史, 模型配置中心) are hidden until their trigger is clicked.
- **Secondary message actions** (复制 / 重新生成) appear on hover, never at rest.
- **Metadata** (timestamps, sizes, paths) recede via tertiary color.

Rationale: low cognitive load, calm rhythm, the conversation breathes. Nothing demands attention until it is relevant.

## 2. One focus per surface

- Conversation = read the result. Canvas = inspect the artifact. Composer = the persistent primary action.
- Don't compete for attention inside a single view.

## 3. Direct manipulation & left–right linkage

- Click a trajectory step → its 输入 + 输出 on the right (data read fresh from `data/`).
- Click an artifact / output card → opens in Canvas (and reveals the workspace if collapsed).
- Drag the workspace's left edge → resize freely (default 860px).
- The two panels never sync implicitly; linkage is always a consequence of a user click.

## 4. Motion with purpose

From `emil-design-eng`: custom `ease-out` curves, `scale(0.97)` press feedback, origin-aware popovers (drawers scale from their trigger), CSS transitions (not keyframes) for interruptible UI, durations under 300ms, animate only `transform`/`opacity`. Never animate frequent/keyboard actions. Honor `prefers-reduced-motion`.

## 5. Accessibility

- Visible focus, keyboard-first: Enter sends, Shift+Enter newline, Esc closes drawers.
- Hover-only effects gated behind `(hover: hover) and (pointer: fine)`.
- Reduced motion keeps color/opacity transitions, drops movement.

## 6. Content recedes, structure leads

Hierarchy is carried by the stone→sage→tertiary text ramp and border/background separation (never by shadow or loud color). Semantic colors appear only for functional state (success / warning / error / info).

---

### Restraint checklist (apply to any new surface)

- [ ] Does it show only what the user needs *right now*?
- [ ] Is secondary detail behind a click/hover rather than always-on?
- [ ] Is the primary action obvious and singular?
- [ ] Does motion serve feedback, not decoration?
