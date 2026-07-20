# Pi UI

A two-layer agent workspace template: a **Core** (Node) that embeds the Pi agent SDK, and a **UI/UX** (React + Vite) that talks to it over a single seam. The browser never imports the agent SDK directly.

- Package `pi-ui` · Title "Pi UI" · Default branch `main`
- Deep docs: `docs/ARCHITECTURE.md` (layering), `docs/DESIGN.md` (ZenGrid design system), `docs/SLASH-CONTEXT.md` (`/` skill & `@` file context injection), `docs/UX.md`

## Architecture

Two layers, one seam:

- **Core** (`core/`, no React, Node-only): embeds `@earendil-works/pi-coding-agent` (isolated to `core/pi/runtime.ts`); exposes the agent through `AgentClient` (`core/agent.ts`). `core/types.ts` + `core/util.ts` are pure ("No React, No Node, No Pi") and shared by both layers.
- **UI/UX** (`src/`, React): consumes `AgentClient`. The browser bundle must contain **zero Pi symbols** — no `createAgentSession` / `earendil-works` in `dist/`. The browser only knows `/api/*`.

The single prompt-injection exit is `src/workspace.tsx` `sendMessage` — Core always receives fully-expanded plain text and never sees `/` or `@`.

## Run

```bash
pnpm install              # pnpm REQUIRED — npm fails on Windows (Pi SDK nests past MAX_PATH)
pnpm dev                  # Vite plugin core/pi/vite-plugin.ts mounts the Core API as dev middleware; :5173
pnpm build && pnpm start  # prod: tsx core/pi/server.ts serves dist/ + API
```

Type-check: `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`

If a script fails with `ERR_PNPM_IGNORED_BUILDS`, run the bin directly —
`node node_modules/vite/bin/vite.js` / `node node_modules/typescript/bin/tsc …`.

## Verify

Playwright (Firefox, headless) scripts in `verify/run_*/`. Each probes `localhost:5173/5174/5175`, drives the app, prints `CP*` lines + `ALL PASS` / `SOME FAILED`.

```bash
python verify/run_4/skillhub.py    # one script
```

Gotchas when writing/running them:
- Firefox needs `firefox_user_prefs={"network.proxy.type":0}` (system proxy blocks localhost).
- Python sync API: `.first` is a **property**, not a method.
- `window.prompt` on click: there is no `expect_dialog` — register `page.once("dialog", lambda d: d.accept("x"))` **before** the `.click()`, or Playwright auto-dismisses the prompt and you time out.
- Drag a file onto a `<div>` (not an `<input>`): no Playwright API — dispatch in-page: `dt = new DataTransfer(); dt.items.add(new File([bytes], name, {type})); el.dispatchEvent(new DragEvent("drop", {bubbles:true, dataTransfer:dt}))`.
- The Workspace aside is hidden until a session exists — click `[data-testid="load-demo"]` first, then the `ws-tab` buttons are visible.

## Hard-won gotchas

- **pnpm, not npm** — Windows MAX_PATH on the Pi SDK's deeply-nested deps. `package.json` pins `pnpm.onlyBuiltDependencies:["esbuild"]`.
- **Pi auth:** the built-in `anthropic` provider **hardcodes `api.anthropic.com` and ignores `ANTHROPIC_BASE_URL`**, so a Claude proxy token will not work here. Register a provider via `pi login` and let `ModelRuntime.getAvailable()` auto-select the first authenticated model. Do not `setRuntimeApiKey('anthropic', …)` with a proxy token — only real `sk-ant-` keys belong there.
- **`tool_execution_end` has no `args`** (only `result`): capture write/edit file paths at `tool_execution_start` keyed by `toolCallId`, then read the file back at `_end`. Emitted tool paths may be absolute — `isAbsolute()`-check before joining.
- **EventSource** to `/api/events` sets an Accept header to dodge Vite's SPA fallback.

## Security (do not violate)

- **Never print or expose `ANTHROPIC_AUTH_TOKEN`** or any provider API key. Only real `sk-ant-` keys may be registered as `anthropic`.
- `.env` is gitignored and **server-side only** (never use a `VITE_` prefix — that ships it to the browser).
- `.pi-workspace/` (custom-models.json, cwd.json) is gitignored runtime data, server-side only. `workspace/` is the agent's working directory, also gitignored. Never commit any of these.

## Design system

ZenGrid (`docs/DESIGN.md`) + the `emil-design-eng` skill (`.claude/skills/emil-design-eng/SKILL.md`): custom easing tokens, `button:active{scale(.97)}`, origin-aware drawers, transitions over keyframes, <300ms, transform/opacity only, a reduced-motion block. Topbar is icon-only; drawers hidden by default. Markdown preview fills the canvas width (`.r-doc{max-width:none}`).

## Notes

- `.pi-workspace/` is a **runtime data directory**, not branding — do not rename it, or you orphan saved models / cwd config.
- Each skill is a **directory** of files (`SKILL.md` entry + supporting files); `/name` injects only the `SKILL.md` body. See `docs/SLASH-CONTEXT.md`.
