# Architecture — Core vs UI/UX

This is the project's primary design philosophy. Every other doc is subordinate to it.

The codebase is split into two layers with a single, narrow contract between them.
**The Core owns the agent and the data. The UI/UX owns only presentation.** Neither
leaks into the other.

```
┌───────────────────────────────┐         ┌───────────────────────────────┐
│           UI / UX             │         │             Core              │
│         (src/, React)         │         │      (core/, framework-       │
│                               │  events │      agnostic + Node Pi)      │
│  view state · render · input  │ ◀────── │  agent · sessions · files      │
│        · interaction          │  SSE    │  domain model · types          │
└───────────────┬───────────────┘         └───────────────┬───────────────┘
                │                                         │ @earendil-works/pi-coding-agent
                │       the only contract:                │      (Node-only: fs, process,
                │       AgentClient (core/agent.ts)       │       bash/read/write tools)
                └─────────────────────────────────────────┘
```

## The two layers

### Core — `core/`
Owns everything that is true regardless of how it's displayed.

- **Domain model + types** (`core/types.ts`): `Session`, `Message`, `TrajStep`,
  `FileNode`, `Artifact`, `SessionSummary`. Pure types, no runtime.
- **Pure domain helpers** (`core/util.ts`): file-tree math, CSV parsing, path logic.
  No React, no Node, no Pi — usable anywhere.
- **The seam** (`core/agent.ts`): the `AgentClient` interface and the `AgentEvent`
  union. **This is the only thing the UI is allowed to know about the agent.**
- **The Pi runtime** (`core/pi/`, Node-only): wraps the Pi SDK, maps Pi's events to
  `AgentEvent`, captures files the agent writes, and exposes an HTTP + SSE transport.
  The browser **never** imports anything under `core/pi/`.

> The Core never imports React. The Core's browser-safe modules never import Node or Pi.
> The Node-only `core/pi/*` is excluded from the browser bundle entirely (verified by
> build: zero Pi symbols ship to the client).

### UI/UX — `src/`
Owns only what the user sees and how they interact.

- **Presentation**: React components, `styles.css` (ZenGrid), icons, the Markdown/CSV
  renderers.
- **View state** (`src/workspace.tsx`): which drawer is open, edit mode, active tab,
  workspace width, which files are open. **No domain truth** lives here — sessions,
  messages, and files all stream in from the Core.
- **The Core adapter** (`src/agentClient.ts`): the browser `AgentClient`. Opens the SSE
  stream, reduces `AgentEvent` into a live model, and binds it to React via
  `useSyncExternalStore`. This is the **only** file in the UI that knows `/api/*` exists.

> The UI/UX layer has two specs of its own: [DESIGN.md](./DESIGN.md) (visual) and
> [UX.md](./UX.md) (interaction). Both describe the UI/UX layer only.

## The contract: `AgentClient`

```ts
interface AgentClient {
  prompt(text: string): Promise<void>;
  saveFile(path: string, content: string): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  newSession(): Promise<void>;
  switchSession(id: string): Promise<void>;
  subscribe(fn: (e: AgentEvent) => void): () => void;
}
```

Everything the agent produces flows as an `AgentEvent` (`text_delta`, `tool_start/end`,
`file`, `agent_end`, `error`). The UI reduces these into messages, trajectory steps, and
files. To swap Pi for a different agent backend, implement this interface once — the UI
does not change.

## Data flow (live)

1. User types in the composer → UI calls `agentClient.prompt(text)` → `POST /api/prompt`.
2. The Node Core (`core/pi/runtime.ts`) calls `session.prompt(text)` on a Pi `AgentSession`.
3. Pi streams: assistant text deltas, tool executions, written files.
4. The Core maps each to an `AgentEvent` and writes it to the SSE stream (`GET /api/events`).
5. The browser `agentClient` reduces events into its store; React re-renders the
   conversation, the trajectory, and the workspace file tree as data arrives.

In **dev**, the Core mounts inside the Vite dev server as a plugin middleware
(`core/pi/vite-plugin.ts`) — one `npm run dev` runs both. In **prod**, `core/pi/server.ts`
serves the built UI (`dist/`) and the API from one Node process (`npm run start`).

## Why

- **Testable Core.** Domain logic has no React/Node/DOM coupling, so it's unit-testable
  and reusable.
- **Swappable agent.** Pi is an implementation detail behind `AgentClient`.
- **Clear ownership.** A bug in "the file tree is wrong" lives in the Core; a bug in "the
  drawer animation is wrong" lives in the UI/UX. There is no middle.
- **Security boundary.** The Anthropic key and the local filesystem exist only in the Node
  Core. The browser sees only the events the Core chooses to emit.

## Configuration

The Core reads server-side env (never exposed to the browser — no `VITE_` prefix):

| var | purpose | default |
|---|---|---|
| `PI_MODEL` | preferred `provider/model`; auto-falls-back to first authenticated | `deepseek/deepseek-v4-flash` |
| `PI_CWD` | directory the agent reads/writes | `./workspace` |
| `PORT` | prod server port | `4173` |
| `ANTHROPIC_API_KEY` | real `sk-ant-…` key (optional) | — |

See `.env.example`. The Pi SDK is installed via pnpm (npm fails on Windows due to the
SDK's deeply nested dependencies). Authentication comes from `pi login`
(`~/.pi/agent/auth.json`); on this machine that is **deepseek**.

> **Why not the Claude/GLM proxy?** Claude Code here routes through a GLM proxy
> (`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`). That token can't be reused: Pi's
> built-in anthropic provider hardcodes `https://api.anthropic.com` and ignores
> `ANTHROPIC_BASE_URL`. A `pi login` provider (deepseek) is the working path.
