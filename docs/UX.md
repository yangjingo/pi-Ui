> **UI/UX layer — interaction contract.** Behavior and feel only. Sessions,
> messages, and files now stream live from the Core agent (see
> [ARCHITECTURE.md](./ARCHITECTURE.md)); the principles below still govern how that
> live data is revealed to the user.

# UX Principles — Pi Workspace

The visual system lives in [DESIGN.md](./DESIGN.md): gray-black English with the Pi brand is the
default startup configuration, while ZenGrid, the AIDA visual theme, Chinese, and an explicit brand
override are deployment-time options. Theme, language and brand have no top-bar switch. This
document defines **how the interface behaves**. Interaction polish follows the project Skill at
[`.agents/skills/emil-design-eng/SKILL.md`](../.agents/skills/emil-design-eng/SKILL.md).

## Product surface boundary

Pi UI is a desktop-only workbench. Phone, touch-only, coarse-pointer, and mobile navigation layouts
are outside the product scope. Desktop browser zoom remains fully supported: when zoom changes the
effective CSS viewport, the same two-column workbench contracts fluidly in both dimensions. Its
chrome and gutters tighten, Conversation yields the measured Composer height, and short workspaces
scroll inside their owning region without creating page-level overflow. Zoom never transforms the
workbench into drawers, stacked panels, enlarged touch targets, or a mobile model.

## 1. 克制 — Progressive Disclosure (primary principle)

Do not surface everything at once. Show the essence; reveal detail only when the user asks for it. The user sets the depth, not the interface.

**Defaults that respect restraint:**
- **Workspace is collapsed** on entry for every session (including completed ones). The user opens it with the panel toggle, or by clicking an artifact / trajectory step / "在 Canvas 中打开".
- **Trajectory is mode-aware** — ordinary Sessions show compact, clickable Traj summaries in Conversation. Once Core reports a real Goal for the Session, those summaries disappear and only the final result remains. Raw Tool input/output never expands in Conversation, and neither mode shows step/file counts.
- **Run details is explicit** — the answer's `···` menu opens a Run overview in Canvas, not a second modal or panel. The overview contains a trajectory index, Tool Call summaries, and collapsed Diagnostics; selecting a step replaces it with raw input/output in the same Canvas.
- **Running state is transient** — one short status line updates in place and disappears when the answer completes.
- **Drawers** (会话历史, 模型配置中心) are hidden until their trigger is clicked.
- **Secondary message actions** (Copy / Regenerate / Create Skill / Run details) live behind one hover/focus `···`, never as a permanent button row.
- **Create Skill validates before publishing** — the third item in that answer menu creates a
  Session draft and prepares an `@SKILL.md` validation prompt in the same Composer. A compact status
  row can open the draft, but it does not show “Contribute to Skill Hub” until the referenced
  validation turn completes. Choosing contribution prepares a naming discussion; it never publishes
  or chooses the final name immediately. There is no modal wizard or copied transcript.
- **Compact metrics** appear on answer hover/focus as `TTFT · TPOT · TPS · IN · OUT · CACHE`.
  `CACHE` is the weighted cumulative hit ratio for the current Session through that answer:
  `ΣcacheRead / Σ(input + cacheRead + cacheWrite)`. Exact per-turn values and explanations stay in
  Diagnostics.
- **Metadata** (timestamps, sizes, paths) stays hidden by default; when explicitly revealed, it recedes via tertiary color.

Rationale: low cognitive load, calm rhythm, the conversation breathes. Nothing demands attention until it is relevant.

## 2. One focus per surface

- Ordinary Conversation = follow the summarized run. Goal Conversation = read the result. Canvas = inspect raw details or artifacts. Composer = the persistent primary action, with `Goal` immediately beside `File`.
- Canvas opens in the split Workspace at an initial 50/50 width, so Conversation remains available as context. A user drag becomes the persisted preference; resetting the separator returns to the current 50/50 split. Zoom-compressed desktop viewports may clamp the Workspace up to the existing 65% safety bound to preserve usable content. Fullscreen focus is an explicit user action from the Canvas toolbar.
- In fullscreen focus, Conversation contracts to a narrow rail containing only return, running state, and necessary unread cues. `Esc` exits fullscreen without closing Canvas.

## 3. Direct manipulation & left–right linkage

- Open a step from Run details → its input + output appears in Canvas (data read fresh from `data/`).
- Shell Canvas uses the effective shell (`Bash` or `PowerShell`) as its title, followed directly by
  command and output. It does not repeat `Command`, `Combined output`, `Done`, `Type`, or `Status`.
  Multiline output is preserved; ANSI/NUL controls are removed, and lossy decoding is surfaced
  instead of rendering an apparently empty Canvas.
- Click an Artifact reference from the final Agent Message → opens it in Canvas. Conversation only renders entries already present in `Message.artifacts`; it does not infer them from user text or Tool Calls.
- Opening an Artifact or trajectory enters the split Canvas. The user may explicitly enter fullscreen; its narrow rail or `Esc` returns to the split view without losing the active preview.
- Trajectory, Artifact and Files previews share the same outer Canvas chrome: title/action slots, border, background, loading/error treatment and scroll ownership. Their renderer bodies remain format-specific; consistency never means forcing Tool, Markdown, image and PDF content into one card body.
- Changing Session aborts in-flight file/ZIP downloads and clears transient Files state (search, selection, open menus, busy and inline errors). A late response from the old Session must not save a file or update the new Session.
- The two panels never sync implicitly; linkage is always a consequence of a user click.

## 4. Motion with purpose

From `emil-design-eng`: custom `ease-out` curves, `scale(0.97)` press feedback, origin-aware popovers (drawers scale from their trigger), CSS transitions for interruptible UI, and `transform`/`opacity` only. Finite interaction transitions stay under 300ms and frequent keyboard actions do not animate. A continuous indicator may use a 900–1800ms state loop only while asynchronous work is genuinely running; it must stop immediately with that state and become static under `prefers-reduced-motion`.

The welcome Slogan is a rare entry surface, so its icon and one-line claim form one centered visual
lockup and may enter once with a 220ms `ease-out` opacity + 7px vertical transition. Composer input is
not delayed or moved. Reduced motion keeps only a 160ms opacity transition. The text remains
`Pi Cooks. You Look busy` or `AIDA Cooks. You Look busy` according to the startup brand; this visual
polish must not add actions, secondary copy, or theme-specific behavior.

One bounded exception is the Loop Pet: after a long-running Agent Turn, a tiny ASCII character may
appear at a stable position for a few seconds. It is not progress, never blocks input, appears at
most once per Turn, and stops immediately when work completes, the user starts typing, or the page
loses focus. Its text frames use a cancelable timer rather than CSS keyframes, and it is static under
`prefers-reduced-motion`.

### Performance disclosure

- Model and Skill route chunks plus their read-only catalogs may warm on pointer/focus intent and
  during browser idle time. Concurrent opens share one request; a short-lived cached result is reused,
  while an explicit Refresh always bypasses that cache.
- Loading feedback preserves the geometry of the surface that will replace it. It is shown only for
  unresolved asynchronous work and disappears as soon as usable content is committed; delayed pages
  do not block the rest of the workbench behind a global spinner.
- Complex HTML previews paint the Canvas chrome first and assign iframe content on the next frame.
  The iframe publishes an explicit ready signal before its loading surface is removed. Preview-owned
  `requestAnimationFrame` work is capped at 30fps for every HTML preview; this performance budget must
  not rewrite the document, reduce renderer fidelity, or change user navigation.

## 5. Accessibility

- Visible focus, keyboard-first: Enter sends, Shift+Enter newline, Esc closes drawers.
- Desktop hover interactions always retain an equivalent keyboard-focus path.
- Reduced motion keeps color/opacity transitions, drops movement.

## 6. Content recedes, structure leads

Hierarchy is carried by the stone→sage→tertiary text ramp and border/background separation (never by shadow or loud color). Semantic colors appear only for functional state (success / warning / error / info).

---

### Restraint checklist (apply to any new surface)

- [ ] Does it show only what the user needs *right now*?
- [ ] Is secondary detail behind a click/hover rather than always-on?
- [ ] Is the primary action obvious and singular?
- [ ] Does motion serve feedback, not decoration?

The implementation Goal for Conversation restraint, Canvas focus mode, compact diagnostics, Shell
detail hierarchy, and Loop Pet is
[UX-AGENT-LOOP-RESTRAINT.md](./goals/UX-AGENT-LOOP-RESTRAINT.md).
