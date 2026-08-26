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
