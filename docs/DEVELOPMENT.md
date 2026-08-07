# Pi UI development guide

Pi UI ships as one npm package while preserving five explicit source boundaries. This guide collects the repository structure, deliberate product trade-offs, and the commands used to develop and verify the package.

For the contracts behind these decisions, read [Architecture](./ARCHITECTURE.md), [UX Principles](./UX.md), and [Design System](./DESIGN.md).

## One package, five explicit boundaries

<p align="center">
  <img src="./assets/pi-ui-architecture.svg" width="100%" alt="Pi UI five-module architecture and browser-to-Node trust boundary" />
</p>

The primary dependency directions are `canvas → workspace → core/agent`, `canvas → ui`, and `core/pi → harness`.

- `core`: Agent loop, browser gateway, protocol, Node transport, and Pi runtime.
- `harness`: replaceable Context, File, Goal, and Skill constraints with persistence.
- `ui`: semantic tokens, themes, locale, formatting, and business-state-free primitives.
- `canvas`: application panels, file/trajectory renderers, inspection, and editing.
- `workspace`: files, models, Skills, Sessions, and browser application state.

These boundaries isolate reasons to change while shipping as one `@whyj/pi-ui` package: `dist/` contains the browser UI, `dist-node/` contains Node Core, Harness, and runtime, and `bin/pi-ui.js` remains a thin CLI entry.

## Deliberate trade-offs

| We choose | We give up | Why |
| --- | --- | --- |
| Loopback-only Core + same-origin checks | Unauthenticated remote access | Credentials, Pi SDK, and filesystem stay inside the Node trust boundary |
| Explicit click-driven linkage | Automatic focus stealing and implicit synchronization | Users always know why Canvas changed |
| Progressive disclosure | Permanent toolbars, badges, and metric walls | Long-running Agent work needs a low cognitive load |
| Desktop-only with zoom support | Phone, touch, and mobile-drawer layouts | Preserve one dense, predictable two-column work model |
| Local Skill Hub with validation before contribution | Built-in remote marketplace and one-click publish | Reusable capability must not bypass review and naming confirmation |
| One npm package | Five independently versioned packages | Module boundaries should not transfer integration complexity to adopters |

The same trade-offs are summarized visually in the browser-native [Pi UI HTML deck](./slides/index.html#slide-09).

## Development and verification

Use pnpm on Windows to avoid exceeding dependency path limits in the Pi SDK:

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test:modules
pnpm test:canvas
pnpm test:e2e
pnpm build
```

Runtime data belongs only in `.workspace/`. Never commit `.env`, API keys, generated runtime data, or Workspace contents, and never expose provider credentials through a `VITE_*` variable.
