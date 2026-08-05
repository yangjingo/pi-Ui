# Repository Guidelines

## Project Structure & Module Organization

This is a two-layer Pi agent workspace. `src/` has five module directories: `core/` owns the Agent loop and gateway, `harness/` owns reusable constraints, `ui/` owns styles/theme/language primitives, `canvas/` owns panels and renderers, and `workspace/` owns files, models, Skills, Sessions, and browser application state. Keep browser code dependent only on the `core/agent` gateway; never import Pi SDK packages into the UI bundle. Read `docs/ARCHITECTURE.md` before moving code across these boundaries. Read `docs/UX.md` and `docs/DESIGN.md` before changing interaction behavior or visual styling.

`tests/core/`, `tests/harness/`, `tests/ui/`, `tests/canvas/`, and `tests/workspace/` mirror the five source boundaries. `tests/e2e/` contains cross-module browser regressions, while `tests/fixtures/` contains shared test infrastructure. `docs/` holds product and design references. Runtime data belongs in ignored `.workspace/`, never in committed source.

## Product Direction & Project Skills

The project's first product objective is to build a tasteful Pi UI that can be integrated into
other products without weakening its architecture, accessibility, or visual identity. Local
contracts always take precedence over third-party Skills: `docs/ARCHITECTURE.md` defines integration
boundaries, `docs/UX.md` defines interaction, and `docs/DESIGN.md` defines the visual system.

Project Skills are committed under `.agents/skills/` and pinned in `skills-lock.json`. Use them as
focused reviewers, not as competing product specifications:

- For new UI direction, use
  [`design-taste-frontend`](./.agents/skills/design-taste-frontend/SKILL.md). For an existing screen
  or flow, prefer
  [`redesign-existing-projects`](./.agents/skills/redesign-existing-projects/SKILL.md). Do not apply
  `minimalist-ui`, `industrial-brutalist-ui`, `high-end-visual-design`, or another style variant
  unless the user explicitly chooses that direction.
- Use [`emil-design-eng`](./.agents/skills/emil-design-eng/SKILL.md) for interaction polish and
  [`review-animations`](./.agents/skills/review-animations/SKILL.md) for motion review. These Skills
  supplement the repository's easing, duration, pointer, and reduced-motion constraints.
- Use [`shadcn`](./.agents/skills/shadcn/SKILL.md) for accessible composition and integration
  patterns. It does not authorize introducing Tailwind, replacing the Pi UI theme, or bypassing the
  five-module boundary without an explicit task decision.
- Use the GSAP suite beginning with
  [`gsap-core`](./.agents/skills/gsap-core/SKILL.md),
  [`gsap-react`](./.agents/skills/gsap-react/SKILL.md), and
  [`gsap-performance`](./.agents/skills/gsap-performance/SKILL.md) only when a task genuinely needs
  timelines, scroll-linked motion, or runtime animation control. Ordinary UI feedback should remain
  lightweight CSS transitions under 300 ms.
- Use [`lieflat-charts`](./.agents/skills/lieflat-charts/SKILL.md) for editorial data visualization.
  Its bundled PolyForm Noncommercial license must be checked before using its templates or assets in
  a commercial deliverable.

The remaining installed Skills are discoverable from their `SKILL.md` frontmatter. Never combine
multiple taste/style Skills by default; select the smallest set that fits the task and state which
local product contract resolves any conflict.

## Build, Test, and Development Commands

Use pnpm on Windows; npm can exceed the Pi SDK dependency path limit.

```bash
pnpm install                         # install dependencies
pnpm dev                             # Vite plus Core API middleware on :5173
pnpm typecheck                       # TypeScript and source-boundary checks
pnpm build                           # boundary check, TypeScript, production bundle
pnpm build && pnpm start             # serve production UI and API
pnpm test:modules                    # Core/Harness/UI/Workspace module tests
pnpm test:canvas                     # run the focused Canvas regression module
pnpm test:e2e                        # run cross-module browser regressions
```

Run `pnpm typecheck` before every handoff and `pnpm build` when changing runtime, bundling, or public UI boundaries.

## Coding Style & Naming Conventions

Write TypeScript and React with two-space indentation, semicolons, and named components such as `ModelPanel`. Use PascalCase for components, camelCase for functions/state, and kebab-case for test IDs and CSS utility names. Keep shared contracts in `src/core/agent/protocol.ts`; keep Node/Pi-specific code out of UI modules. Treat `docs/DESIGN.md` as the visual contract and `docs/UX.md` as the interaction contract: dark is the default theme, ZenGrid is optional, and both use the same semantic tokens and behavior. Use easing tokens, transform/opacity transitions under 300 ms, pointer-gated hover states, and reduced-motion support.

## Testing Guidelines

Validate module behavior under the matching `tests/{core,harness,ui,canvas,workspace}/` boundary. Put only cross-module user flows under `tests/e2e/`, and add or update a test when fixing a regression. Tests should print clear pass/fail output and target local Vite ports. Pi UI is desktop-only: verify the normal 1280px-or-greater desktop viewport and zoom-compressed effective viewports, plus keyboard focus, Canvas behavior, and error/loading states. Browser zoom must keep the same fluid two-column desktop model without page-level horizontal overflow. Do not add phone, touch, coarse-pointer, mobile drawer, or mobile navigation compatibility.

## Commit & Pull Request Guidelines

History uses short imperative subjects (for example, `Add CLAUDE.md`). Keep commits focused and describe the user-visible change. PRs should include a concise summary, verification commands/results, linked issue when available, and screenshots or recordings for visual changes. Do not commit `.env`, API keys, generated runtime data, or workspace contents.

## Security & Configuration

Keep provider credentials server-side and out of `VITE_*` variables. Treat `.workspace/` and its settings JSON as local runtime configuration. Sanitize files and URLs passed from the UI before Core performs filesystem or network work.

## Agent Execution Principle

Exercise restraint: implement the smallest change that satisfies the agreed goal. Before starting work, clarify the goal, scope, acceptance criteria, and any meaningful trade-offs with the user. Do not expand the feature set, refactor adjacent areas, or make irreversible changes unless the user explicitly includes them in scope.
