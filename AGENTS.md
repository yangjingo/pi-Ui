# Repository Guidelines

## Project Structure & Module Organization

This is a two-layer Pi agent workspace. `src/` has five module directories: `core/` owns the Agent loop and gateway, `harness/` owns reusable constraints, `ui/` owns styles/theme/language primitives, `canvas/` owns panels and renderers, and `workspace/` owns files, models, Skills, Sessions, and browser application state. Keep browser code dependent only on the `core/agent` gateway; never import Pi SDK packages into the UI bundle. Read `docs/ARCHITECTURE.md` and `docs/SOURCE-MODULE-DESIGN.md` before moving code across these boundaries.

`tests/core/`, `tests/harness/`, `tests/ui/`, `tests/canvas/`, and `tests/workspace/` mirror the five source boundaries. `tests/e2e/` contains cross-module browser regressions, while `tests/fixtures/` contains shared test infrastructure. `docs/` holds product and design references. Runtime data belongs in ignored `.workspace/`, never in committed source.

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

Write TypeScript and React with two-space indentation, semicolons, and named components such as `ModelPanel`. Use PascalCase for components, camelCase for functions/state, and kebab-case for test IDs and CSS utility names. Keep shared contracts in `src/core/agent/protocol.ts`; keep Node/Pi-specific code out of UI modules. Follow ZenGrid and `.workspace/skills/emil-design-eng`: use easing tokens, transform/opacity transitions under 300 ms, pointer-gated hover states, and reduced-motion support.

## Testing Guidelines

Validate module behavior under the matching `tests/{core,harness,ui,canvas,workspace}/` boundary. Put only cross-module user flows under `tests/e2e/`, and add or update a test when fixing a regression. Tests should print clear pass/fail output and target local Vite ports. For UI changes, also verify keyboard focus, narrow layouts, Canvas behavior, and error/loading states.

## Commit & Pull Request Guidelines

History uses short imperative subjects (for example, `Add CLAUDE.md`). Keep commits focused and describe the user-visible change. PRs should include a concise summary, verification commands/results, linked issue when available, and screenshots or recordings for visual changes. Do not commit `.env`, API keys, generated runtime data, or workspace contents.

## Security & Configuration

Keep provider credentials server-side and out of `VITE_*` variables. Treat `.workspace/` and its settings JSON as local runtime configuration. Sanitize files and URLs passed from the UI before Core performs filesystem or network work.

## Agent Execution Principle

Exercise restraint: implement the smallest change that satisfies the agreed goal. Before starting work, clarify the goal, scope, acceptance criteria, and any meaningful trade-offs with the user. Do not expand the feature set, refactor adjacent areas, or make irreversible changes unless the user explicitly includes them in scope.
