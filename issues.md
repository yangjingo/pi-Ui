# Known Issues and Incident Notes

## ISSUE-2026-08-27-01: standalone `pnpm bundle` failed after repository split

- **Status**: Fixed
- **Affected package**: `@aida/aida-ui-dsh`
- **Affected versions**: standalone plugin checkout before the 2026-08-27 build repair
- **Discovered during**: Settings dialog regression verification

### Symptom

Running the documented bundle command in `aida-ui-plugin` failed before any
artifact was emitted:

```powershell
pnpm run bundle
```

The first failure was:

```text
Error: Failed to load the config file.
Cannot find module 'C:\Users\y00842095\Desktop\agent\aidaNext\aida-dsh\tsdown.client.ts'
imported from ...\aida-ui-plugin\tsdown.config.ts
```

After removing that immediate import error, a clean type build also exposed
stale project references such as:

```text
../../../vendor/cordis
../../api/remotes/tsconfig.client.json
../locale
../runtime
../ui-conversation
```

These paths belonged to the old dsh monorepo layout and did not exist in the
standalone plugin checkout.

### Root cause

The plugin was extracted from an upstream monorepo package without completely
moving its build boundary:

1. `tsdown.config.ts` retained its old monorepo-relative import:

   ```ts
   import { clientBundle } from '../tsdown.client.ts'
   ```

   In the old repository, this resolved to the shared client build preset one
   directory above the package. In the standalone repository, it points outside
   the plugin and there is no such file.

2. `tsconfig.client.json` retained monorepo project references. A standalone
   checkout cannot resolve those packages through the old relative paths.

3. The old `bundle` script only ran `tsdown`. The package-local tsdown preset
   consumes TypeScript outputs from `lib/types`, so a clean checkout also needs
   `tsc -b tsconfig.client.json` first.

4. The standalone preset needs `lightningcss` to compile CSS Modules, but the
   plugin manifest did not declare it directly. In the old workspace it was
   available through the repository build environment, which hidden the missing
   dependency boundary.

### Investigation process

1. Reproduced the failure with Node 24 and the pinned pnpm 11.7.0 runner.
2. Inspected `tsdown.config.ts` and confirmed that the failed path was one
   directory outside the plugin.
3. Searched git history and confirmed that `tsdown.client.ts` was not a file
   deleted from this standalone repository; it was a shared monorepo build
   preset that had not been copied during the split.
4. Located the current upstream equivalent in `deepseek-harness`:
   `packages/client/tsdown.client.ts`.
5. Compared the upstream preset contract with the plugin's existing generated
   `lib/client.js`:
   - `window.__ModuleLoader__.load({ id, factory })` closure wrapper
   - externals resolved through the loader-provided `require`
   - CSS Modules compiled to deterministic hashed style injectors
   - package-specific `dsh.client.external` declarations
   - browser and Node artifacts emitted together
6. Removed the stale monorepo references from `tsconfig.client.json` and
   verified that the source type-checks using installed package types.
7. Added a plugin-local `tsdown.client.ts` instead of making the plugin depend
   on source files inside `deepseek-harness`. This preserves the project rule
   that the harness is only an integration environment.
8. Added `lightningcss@1.33.0` as an explicit dev dependency.
9. Changed `bundle` to run TypeScript before tsdown.
10. Rebuilt, packed, reinstalled the tarball in the dsh Web profile, and ran
    the Settings browser regression again.

### Fix

The build is now self-contained inside `aida-ui-plugin`:

- `tsdown.config.ts` imports `./tsdown.client.ts`.
- `tsdown.client.ts` reads the local package manifest and emits:
  - `lib/index.js`
  - `lib/invariant.js`
  - the browser ModuleLoader factory `lib/client.js`
- `tsconfig.client.json` no longer references nonexistent monorepo projects.
- `package.json` declares `lightningcss` and runs:

  ```powershell
  tsc -b tsconfig.client.json && tsdown
  ```

### Latent packaging defect found during repair

The previously shipped small `client.js` contained a dynamic chunk request such as:

```js
require("./mermaid.core-....cjs")
```

but the plugin tarball did not contain that chunk. The dynamic Mermaid runtime
would therefore be unavailable after a real package installation.

The repaired browser build keeps all lazy client code in the single
ModuleLoader artifact and inlines Mermaid. `lib/client.js` grows to about
7.2 MB, but the plugin no longer references an unregistered and unpackaged
chunk. This is required by the dsh client module system: emitted sibling chunks
are not automatically registered in the module table.

The deprecated Rolldown warning for `inlineDynamicImports` is currently
accepted. The suggested top-level `codeSplitting: false` alternative was
tested and did not produce a single CJS artifact in this setup; it emitted many
unregistrable chunks instead.

### Verification

- `pnpm run bundle` exits successfully.
- Generated artifacts:
  - `lib/index.js`
  - `lib/invariant.js`
  - `lib/client.js`
- `pnpm pack` succeeds.
- The tarball contains `lib/client.js` and no unregistered local `.cjs` chunk.
- Full plugin suite: 13 files, 237 tests passed.
- The rebuilt package was installed in the dsh Web profile.
- Browser verification had no console errors.
- Settings verification retained the expected behavior:
  - native mask remains `blur(2px)` and `z-index: auto`
  - settings panel remains `z-index: 1` and hit-testable
  - `composerSeat` hides while the dialog is open and restores after Escape

### Regression guards

- `tests/build-pipeline.spec.ts` checks that:
  - the bundle script compiles types before tsdown
  - `lightningcss` is explicitly declared
  - tsdown references stay plugin-local
  - stale monorepo project references do not return
- `tests/brand-chrome-css.spec.ts` checks that the shipped browser bundle does
  not reference an unpackaged local `.cjs` chunk.

## ISSUE-2026-08-27-02: Settings dialog was blurred by the plugin mask override

- **Status**: Fixed
- **Affected package**: `@aida/aida-ui-dsh`
- **Affected surface**: Settings modal and center-column composer seat
- **Discovered during**: manual verification of the Settings footer fix

### Symptom

After hiding the empty `composerSeat`, the Settings panel itself appeared
blurred. The underlying page was blurred more heavily than the host design, and
the modal text and controls were no longer crisp.

### Root cause

The host Settings structure is:

```text
.overlay  position: fixed; z-index: 1000
  .mask   position: absolute; z-index: auto; backdrop-filter: var(--dsw-mask-blur)
  .panel  position: relative; z-index: 1
```

The theme defines `--dsw-mask-blur: blur(2px)`, and the mask is intentionally
below the panel.

The temporary AIDA override selected the host mask and applied:

```css
[class*='_footArea'] [class*='_mask'] {
  z-index: 30 !important;
  background-color: rgba(15, 23, 42, 0.35) !important;
  backdrop-filter: blur(6px) !important;
}
```

That created two problems:

1. `z-index: 30` moved the mask above the Settings panel (`z-index: 1`).
2. `backdrop-filter` filters everything painted behind the element. Once the
   mask was above the panel, the panel became part of the mask's backdrop and
   was blurred too.

The override had been intended to keep the composer below the Settings overlay.
It became unnecessary after the plugin began hiding the complete `composerSeat`
while the dialog was open.

### Fix

The plugin no longer emits any `_mask` rule and does not override either host
mask token. The host keeps its native relationship:

- mask: `z-index: auto`, `backdrop-filter: var(--dsw-mask-blur)`
- panel: `z-index: 1`
- theme token: `--dsw-mask-blur: blur(2px)`

### Verification

Browser checks confirmed:

- mask computed style is `blur(2px)`
- mask `z-index` is `auto`
- panel `z-index` is `1`
- the panel center is hit-testable inside the dialog
- only the background outside the panel is blurred
- `composerSeat` remains hidden while Settings is open and restores after Escape
- no browser console errors

### Regression guards

`tests/brand-chrome-css.spec.ts` now asserts all of the following:

- AIDA source CSS has no `_mask` rule.
- The shipped bundle has no `_mask` selector or mask token override.
- The host Settings CSS keeps `.overlay` fixed at `z-index: 1000`.
- The host mask uses `var(--dsw-alias-bg-mask-1)` and `var(--dsw-mask-blur)`.
- The host panel stays relative with `z-index: 1`.
- The host theme defines `--dsw-mask-blur: blur(2px)`.
