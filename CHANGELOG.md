# Changelog

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
