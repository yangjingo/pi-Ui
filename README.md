<div align="center">

# Pi UI

**Minimal interface. Serious agent work.**

A local-first, business-adaptable workspace for Pi agents.<br />
Bring your own brand, language, Harness, and Skills—without weakening the runtime boundary.

[![npm version](https://img.shields.io/npm/v/%40whyj%2Fpi-ui?style=flat-square&label=npm&color=343434)](https://www.npmjs.com/package/@whyj/pi-ui)
![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-343434?style=flat-square)
![Local first](https://img.shields.io/badge/runtime-local--first-65A30D?style=flat-square)

[Highlights](#why-pi-ui) · [Quick deploy](#deploy-in-one-command) · [Design principles](#restraint-means-appearing-only-when-needed) · [Development](./docs/DEVELOPMENT.md) · [HTML deck](./docs/slides/index.html)

</div>

<p align="center">
  <img src="./docs/assets/readme/conversation-canvas.gif" width="800" alt="Pi UI conversation and Canvas linkage demo" />
</p>

<p align="center"><sub>Conversation preserves context. Canvas opens a real, theme-matched HTML artifact for inspection. Every linkage is triggered by an explicit user action.</sub></p>

## Why Pi UI

| Highlight | What it changes for the user | The boundary that keeps it trustworthy |
| --- | --- | --- |
| **Contract-first agent work** | Complex tasks begin from an explicit Goal Contract and end with a completion audit | Exact `intentId + revision + contractHash` confirmation before execution |
| **Conversation ↔ Canvas** | Follow the run on the left; inspect raw evidence and finished artifacts on the right | Canvas changes only after a user action—never through implicit synchronization |
| **Skill lifecycle, not a marketplace** | Turn a strong result into a reusable local capability | Draft → validation turn → naming discussion → controlled `skill_package` |
| **One local-first package** | Install the browser UI, Core runtime, Harnesses, and CLI together | Loopback-only Core, same-origin API checks, and server-side credentials |

The hero is captured from the running Pi UI—not a marketing mock. Its Canvas renders the same offline [inspection brief](./docs/demos/inspection-brief.html) that ships with these docs.

## Deploy in one command

From the project you want Pi UI to work in:

```bash
cd /path/to/your-project
npx --yes @whyj/pi-ui@latest install
```

That command creates an ignored `.workspace/`, starts the browser UI and Core API, and opens `http://127.0.0.1:4173`. No global install or public server is required. Press `Ctrl+C` to stop; run `npx --yes @whyj/pi-ui@latest start` to return.

> [!NOTE]
> Already have Pi on this machine? First launch can explicitly inherit its configured models, authentication, and historical Sessions while keeping the original Session JSONL read-only.

## One minimal UI. A workspace your business can define.

Pi UI is neither an overloaded chat window nor a product screen coupled directly to the Pi SDK. It is a quiet desktop workbench with one strict boundary: the browser talks only to the `core/agent` gateway, while Node Core owns the Pi SDK, credentials, and local filesystem.

Your product adapts the experience through stable contracts:

| Layer | Your product defines | Pi UI preserves |
| --- | --- | --- |
| Brand and visual language | `dark`, `zengrid`, or `aida`; brand; locale; complete semantic tokens | One component model, interaction contract, and accessibility baseline |
| Agent constraints | Context, File, Goal, and Skill Harnesses | Replaceable, testable authorization, persistence, audit, and completion checks |
| Business capabilities | Workspace Skills and controlled `skill_package` flows | Local-first discovery, lazy expansion, validation before contribution, no implicit overwrite |
| Artifact experience | Canvas renderers and the Workspace facade | One safe data path across conversations, files, trajectories, and artifacts |

The result is a UI foundation that can live inside different products without giving up its architecture, accessibility, or Pi identity.

## The workflows that matter

### 01 · Harness turns “please do the right thing” into a verifiable contract

A complex task does not start merely because someone types `/goal`. Goal Harness first persists a UserIntent and Goal Contract. Core permits goal creation only after the user confirms the exact `intentId + revision + contractHash`. Completion then passes through a structured audit covering every agreed deliverable, acceptance criterion, constraint, non-goal, and verification step.

See the contract flow and running UI in the [Goal Harness walkthrough (slide 04)](./docs/slides/index.html#slide-04).

- **Context Harness** keeps a stable context prefix, deterministic Tool/Skill ordering, and cache-usage evidence.
- **File Harness** provides browser-safe file access, Session isolation, and controlled write boundaries.
- **Goal Harness** aligns intent before execution and keeps background Goals independent from foreground navigation.
- **Skill Harness** generates and validates a Session-local candidate before it can enter the Workspace Skill root.

### 02 · Follow on the left. Inspect on the right.

Conversation follows the run: ordinary Sessions show a compact trajectory, while Goal Sessions let process recede and results lead. Canvas inspects raw Tool input/output, opens artifacts, previews files, and provides an explicit fullscreen focus mode.

The two sides share context without secretly synchronizing:

- Click a trajectory step to read its latest raw input and output in Canvas.
- Click a final artifact to open the matching renderer.
- Start at a balanced 50/50 split; persist user resizing; let `Esc` exit fullscreen without closing the preview.
- Abort old downloads and clear transient state when switching Sessions, so late responses cannot pollute the new Session.

Both “what the agent did” and “what the artifact is now” remain visible, inspectable, and ready for continued work.

### 03 · Skill Hub is a capability pipeline, not a marketplace pop-up

Skill Hub manages only the current Workspace's local Skills. Catalog reads stay lightweight, full packages load only when opened, and dependency environments are fingerprinted and reused at Workspace scope instead of being copied into every Session.

See the complete validation and packaging sequence in the [Skill Hub walkthrough (slide 06)](./docs/slides/index.html#slide-06).

A strong Agent turn can become a reusable Skill, but the path is deliberately staged:

`Completed turn → Session draft → @SKILL.md validation turn → Name discussion + skill_package`

There is no copied chain of thought, no unconfirmed publishing, and no browser-side remote installation endpoint. Capabilities become reusable without bypassing the trust boundary.

## Restraint means appearing only when needed

Pi UI's primary design principle is **progressive disclosure**: the user chooses the depth; the interface does not compete for attention.

- Workspace begins collapsed and opens only through an artifact, trajectory, or explicit panel action.
- Raw Tool input/output never floods Conversation; detailed run evidence belongs in Canvas.
- Secondary answer actions sit behind one hover/focus `···`; compact metrics read `TTFT · TPOT · TPS · IN · OUT · CACHE`.
- Flat hierarchy uses backgrounds, borders, and spacing—not decorative shadows or glow.
- Ordinary feedback stays below 300ms and uses interruptible `transform`/`opacity` transitions with complete `prefers-reduced-motion` support.
- The product is desktop-only; browser zoom preserves the same fluid two-column model instead of turning it into a mobile drawer.

These are product decisions, not missing features: content leads, structure recedes, and every persistent animation must correspond to real running work.

## Deployment and operations

Node.js 20 or newer is required. The one-command path above is the fastest start; for regular use, install the CLI globally:

```bash
npm install --global @whyj/pi-ui
piUi install
piUi doctor
```

If Pi already exists on the machine, first launch can inherit models, authentication, and historical Sessions from `~/.pi/agent`. Continuing a historical Session creates an application-owned private fork and never rewrites the source JSONL.

### Common commands

```bash
piUi start                           # Start again
piUi doctor --json                   # Machine-readable diagnostics
piUi start --cwd ./work --port 4317  # Choose Workspace and port
piUi --help
```

### Define theme, locale, and brand at deployment time

Startup configuration is injected before React mounts. It does not require a rebuild and is not stored in browser localStorage:

```powershell
$env:PI_UI_THEME = 'dark'       # dark (default), zengrid, or aida
$env:PI_UI_LANGUAGE = 'en'      # en (default), zh, or zh-CN
$env:PI_UI_BRAND = 'pi'         # pi or aida
piUi start
```

Build and run from source:

```bash
pnpm install
pnpm build
pnpm start
```

> [!IMPORTANT]
> Pi UI is currently a local desktop workbench, not a public SaaS server. Core accepts only `127.0.0.1`, `localhost`, or `::1`, and browser API calls must pass same-origin validation. Because there is no remote authentication boundary, `0.0.0.0`, LAN, and public-host listening are intentionally rejected.

## Development

Repository boundaries, deliberate trade-offs, source commands, and verification guidance now live in the dedicated [Pi UI development guide](./docs/DEVELOPMENT.md). For the underlying product contracts, see [Architecture](./docs/ARCHITECTURE.md), [UX Principles](./docs/UX.md), and [Design System](./docs/DESIGN.md).

---

<div align="center">

**Pi Cooks. You Look busy.**

</div>
