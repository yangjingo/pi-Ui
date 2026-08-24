# AIDA UI Agent Guide

This repository is the source of truth for the DSH AIDA UI plugin. Keep AIDA-specific UI, host methods, documentation, and release assets here. Treat a DSH checkout as an integration target, not as a second implementation of the plugin.

## Required design skills

Before changing React UI, CSS, layout, icons, loading states, or transitions, read both repository-local skills:

- `.agent/taste-skill/SKILL.md`: use it for the audit-first design read, visual hierarchy, consistency checks, and anti-slop review.
- `.agent/amicro-design-system/SKILL.md`: use its micro-transition principles, motion easing, state-transition patterns, and reduced-motion discipline.

Apply the skills contextually. AIDA is a dense developer tool embedded in DSH, not an Amicro catalog or a marketing page. Existing DSH primitives, semantic `--dsw-*` tokens, typography, localization, and component behavior take precedence over the skills' example palettes, fonts, cards, haptics, or framework-specific snippets.

For normal AIDA work, declare this design read before editing:

> Conservative developer-tool refinement for frequent users. Preserve DSH's compact visual language. Use DESIGN_VARIANCE 3, MOTION_INTENSITY 2, and VISUAL_DENSITY 6.

## Design contract

Follow [`docs/design-language.md`](docs/design-language.md) for the complete contract. The CANVAS toolbar baseline is mandatory:

- Toolbar: `40px` high, `8px` horizontal padding, `6px` control gap.
- Labels: `12px`; icons: `14px`.
- Compact controls: `26px`; search and import controls: `28px`.
- Control radius: `4px`; input and grouped-control radius: `6px`.
- Use DSH primitive icons first. Do not draw replacement SVG paths or use emoji as controls.
- Keep Files, Trajectory, and Canvas preview toolbars visually aligned.

## React and motion

- Implement plugin UI in React and keep ownership inside React; do not move React-owned DOM nodes with imperative scripts.
- Animate state changes only when motion explains loading, hierarchy, continuity, or feedback.
- Prefer opacity and small transforms, normally `160-220ms`, with the Amicro easing `[0.16, 1, 0.3, 1]` where it fits DSH.
- Do not animate toolbar geometry, persistent layout dimensions, or routine hover position.
- Provide a static or near-instant fallback under `prefers-reduced-motion: reduce`.
- Avoid adding a motion dependency when CSS or an existing runtime primitive is sufficient.

## Localization and accessibility

- Every user-visible string, tooltip, `title`, `aria-label`, placeholder, empty state, and error message must use the plugin locale layer.
- Add Chinese and English keys together. Never fix one locale by hardcoding the other.
- Icon-only actions require an accessible label and tooltip.
- Preserve visible keyboard focus and native keyboard behavior.

## Integration boundaries

- Reuse the DSH `ui-trajectory` view inside CANVAS. Change its entry or containing toolbar only when necessary; do not fork or recreate Trajectory in AIDA.
- Prefer DSH slots, services, primitives, and semantic tokens over copied components.
- Keep plugin removal reversible: core conversation, session, workspace, and trajectory behavior must recover when `ui-aida` is removed.
- Deep-import optional icon modules when required by the DSH client bundler; avoid dependency patterns that introduce runtime externals drift.
- Update English and Chinese documentation whenever behavior or visible language changes.

## Working scope

- Canonical plugin: `C:\Users\yangjing\Project\dsh-plugin\aida-ui`
- DSH integration checkout: `C:\Users\yangjing\Project\dsh-aida-deploy`
- Local review URL: `http://127.0.0.1:3080`

Do not commit generated integration copies as independent AIDA source. Build and synchronize them only for DSH integration verification.

## Version synchronization

The plugin release version MUST track the official DSH platform version this
plugin is built against. Keep the numbers in sync, prerelease tags included.

- Source of truth: the DSH platform version resolved by the active profile
  (`@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` / `@deepseek-ai/dsh`).
- Rule: `version` in `package.json` equals the DSH platform version. When DSH
  moves to `0.1.1-rc.2`, the plugin bumps to `0.1.1-rc.2` in the same change.
- Release archives under `releases/` are named with the same version
  (`aida-aida-ui-dsh-<version>.tgz`).
- When the integration target moves, record the version-sync target, the
  compatibility changes, and any platform-side patches in `docs/PRD.md`.
- Never bump the plugin version ahead of the DSH platform it targets.
