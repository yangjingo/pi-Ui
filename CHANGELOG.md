# Changelog

## 0.1.2-alpha.5 — 2026-08-30

- Added `docs/dsh-plugin-embed.md` as the authoritative DSH-plugin embedding
  contract for footer entry order, center takeover, icon backgrounds, motion,
  and AIDA atmosphere ownership; linked it from the design language and docs
  index.
- Added the visible Host startup banner for the AIDA UI deployment, matching
  the `aida-welink` loading convention and reporting the package version,
  atmosphere asset route, and Workspace file API.

## 0.1.2-alpha.4 — 2026-08-30

- Added the plugin-owned `/aida-ui-assets/*` static route with a one-deep,
  extension-allowlisted resolver, restoring the v2 AIDA atmosphere without
  depending on artwork copied into the upstream DSH web static root.
- Added the two requested pet packs (`burger-king-refined` / 堡你满意 and
  `flamingo-refined` / 鹤法摸鱼) beside the existing `healing-whale-hit` /
  鲸得起打. `aida-install-pets` installs all three runtime packs; the legacy
  `aida-install-whale` command remains compatible.
- For local DSH `0.1.2` integration, the profile now uses the companion fork
  at `../aida-pets-plugin`: upstream pet `0.3.3` is patched from the retired
  `dsh-client-runtime` module graph to `dsh-client-store`, then restored as
  the default `healing-whale-hit` companion.
- Replaced the English blank-session headline `Into the Unknown` with the
  AIDA logo/title lockup plus `DELIVERY INTELLIGENCE`, while retaining the
  existing localized Chinese headline behavior.
- Bundled the Host half from live `src/index.ts` so newly added host routes can
  no longer be silently omitted when stale generated type output is present.

## 0.1.2-alpha.3 — 2026-08-29

- Compatible with deepseek-harness `dsh-v0.1.2-alpha.1`.
- Removed the optional third-party `@linxin666/dsh-pet` runtime from the bundle;
   it still requires the retired `dsh-client-runtime` module.
- Replaced the deployment-hosted background image dependency with a bundled CSS
  atmosphere, eliminating `/aida-background.png` 404 noise on upstream DSH builds.
- Replaced removed `dsh-client-runtime` imports with the new split client modules:
  `dsh-client-store`, `dsh-client-ui-renderer`, `dsh-client-ui-chat`, and
  `dsh-client-ui-conversation`.
- Updated settings access from the removed connection API envelope to `ctx.remote`.
- Updated Canvas tool-result extraction for the new Conversation records shape.
- Preserved the AIDA Canvas, brand, workspace mention, trajectory relocation,
  and intranet-models behaviors; all 238 client tests pass.

All notable changes to `@aida/aida-ui-dsh` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Merge the `aida-dsh-pets` feature line into this repository:
  - Compose the official `@linxin666/dsh-pet` runtime and ship the single
    `healing-whale-hit` sprite pack (`鲸得起打`). `aida-install-whale` installs
    the pack into `$DSH_HOME/pets` and seeds it as the default pet selection
    (an explicit user choice of another pet is preserved).
  - Replace the atmosphere background with the v2 artwork
    (`assets/aida-background.png` / `assets/aida-background-v2.png`, served from
    the web deployment static root).
  - Standalone test infrastructure: repository-local `tsconfig.base*.json`,
    `vitest.config.ts` (dsh-source aliases + single React instance), and the
    whale-pack test suite (223 unit tests total across the plugin).

### Changed

- Canvas: restore the balanced conversation/details split (fullscreen stays
  opt-in via the header toggle) and keep the collapsed sidebar track aligned.
- Chrome: relocate the duplicate session-header session-log action into the
  Canvas trajectory toolbar while keeping the native action visible.
- Drop the dsh `ui-trajectory` re-export patch dependency: the client bundle
  carries its own relocated `TrajectoryView`, so `deepseek-harness` remains
  upstream-clean. `integration/ui-trajectory-public-exports.patch` is kept as
  historical reference only.

### Security

- Whale artwork remains a separately governed bundled asset (see
  `assets/pets/healing-whale-hit/NOTICE.md`).

### Fixed

- Build: restore the standalone plugin bundle pipeline. The repository split
  had left `tsdown.config.ts` pointing at a missing monorepo preset and kept
  stale project references in `tsconfig.client.json`. The plugin now carries
  its own ModuleLoader/CSS-Modules tsdown preset, declares `lightningcss`, and
  runs TypeScript before bundling. The browser artifact also inlines the lazy
  Mermaid runtime, fixing the old emitted-chunk reference that the plugin
  package did not ship.
- Chrome: hide the full host composer seat while the settings dialog is open.
  The previous state guard hid only `composerStack`; the active-phase
  `composerSeat` parent still painted its fade gradient, leaving an empty
  footer band behind the modal. The state selector now targets the parent and
  uses visibility rather than display so the underlying layout does not shift.
- Chrome: re-fix the settings dialog being trapped inside the sidebar column.
  A stale deployed bundle had re-introduced `backdrop-filter` on
  `[class*='_sidebarCol']`, which creates a containing block and pins the
  `position: fixed` overlay to the sidebar. The shipped bundle removes that
  declaration again; the host's native mask restores full-viewport coverage on
  its own once the containing block is gone.
- Chrome: keep the native settings mask untouched. The temporary brand override
  raised the mask above the host panel and increased its blur, which blurred
  the dialog itself. Once the full composer seat is hidden, that override is
  unnecessary; the host continues to provide its native dim layer and 2px
  background blur with the panel above the mask.

## [0.1.0-rc.11] - 2026-08-25

### Added

- Compose the official `@linxin666/dsh-pet` runtime with AIDA and ship the single `healing-whale-hit` sprite pack.
- Add the `aida-install-whale` archive command, source validation, isolated installer tests, and live Pet runtime verification.
- Add a sanitized, reproducible browser-capture workspace and five whale-enabled slide screenshots under `docs/slides/demos`.

### Changed

- Restore Canvas from fullscreen into a balanced conversation/details split and keep the collapsed sidebar track aligned.
- Keep the native session-log action in the Canvas Trajectory toolbar while hiding the duplicate session-header action.
- Expand the product deck to cover the Pet runtime, archive installation, and removable plugin boundary.

### Security

- Restrict the public screenshot fixture to synthetic content and fail capture when known private markers appear in visible UI text.
- Document the whale artwork as a separately governed bundled asset rather than applying the repository MIT license to it.

[0.1.0-rc.11]: https://github.com/yangjingo/pi-Ui/releases/tag/v0.1.0-rc.11
