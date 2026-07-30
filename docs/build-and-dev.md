# Build & Development

## Prerequisites

- Node.js (see `.nvmrc` or `engines` in `package.json`)
- pnpm (activated via Corepack: run `corepack enable` to use the version pinned in `package.json`'s `packageManager` field)

## Setup

```bash
pnpm install
```

This runs the `postinstall` script automatically.

## Monorepo Structure

The project uses pnpm workspaces, defined in `pnpm-workspace.yaml`:

```yaml
packages:
  - packages/utils
  - packages/azutils
  - extensions/vscode-azure
```

Root-level scripts delegate to all workspaces:

```bash
pnpm run lint    # -> pnpm -r --parallel run lint
pnpm run build   # -> pnpm -r run build
pnpm run test    # -> pnpm -r run test
pnpm run clean   # -> pnpm -r --parallel run clean
```

Target a specific workspace with `--filter` (by package name):

```bash
pnpm --filter @microsoft/vscode-azure-utils run build
pnpm --filter vscode-azure run test
```

## Building

### Packages (`utils`, `azutils`)

Packages compile TypeScript to JavaScript using **`tsc`** from TypeScript 7 (the native Go
compiler):

```bash
pnpm --filter @microsoft/vscode-azure-utils run build     # tsc
pnpm --filter @microsoft/vscode-azure-azutils run build   # tsc
```

Output goes to `dist/esm/`.

### Extension

The extension uses **esbuild** to bundle all source (including packages) into a single file, plus a separate type-check pass:

```bash
pnpm --filter vscode-azure run build
# Runs two commands in series:
#   build:esbuild — node esbuild.mjs (produces dist/extension.bundle.js)
#   build:check   — tsc --noEmit (type checking only)
```

#### TypeScript toolchain (`tsc` vs. typescript-eslint)

The build compiler is TypeScript 7, pulled in as an npm alias in the root `package.json`:

```jsonc
"@typescript/native": "npm:typescript@7.0.2"  // provides the native `tsc` used by the build scripts
```

TypeScript 7.0 ships the fast native compiler but **not** a programmatic compiler API (that arrives
in 7.1). Type-aware linting via `typescript-eslint` still needs the TypeScript 6.x-compatible API, so
it keeps using its own `typescript` peer dependency (a 5.x/6.x line, resolved locally by pnpm). pnpm
resolves that peer by package *name*, so if a package literally named `typescript` were provided at
the workspace root, the linter would resolve its peer from that and load the API-less TypeScript 7.
The alias sidesteps this: the 7.0 compiler is installed under a *different* name (`@typescript/native`)
so it provides `tsc` without occupying the `typescript` name. For the same reason, `typescript` is
intentionally **not** in `pnpm-workspace.yaml`'s `publicHoistPattern` and is **not** declared as a
top-level dependency. The result: `tsc` is TypeScript 7, while `typescript-eslint` transparently uses
its own compatible TypeScript. No action is needed to keep the two in sync.

> **Future cleanup:** this alias-and-no-hoist arrangement is only needed because TypeScript 7.0 has no
> compiler API. Once TypeScript 7.1 ships its new API *and* `typescript-eslint` releases a version that
> uses it, this workaround can be removed: drop the `@typescript/native` alias and simply declare
> `"typescript"` at the appropriate version (re-adding it to `publicHoistPattern` if desired), since the
> build compiler and the linter's compiler would then be the same package again.

> Because TypeScript 7.0.2 was published very recently, `typescript` (and its platform-specific binary
> sub-packages) are temporarily listed in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Those
> entries can be removed once the release ages past the 7-day minimum-release-age policy.

#### esbuild Configuration

`esbuild.mjs` uses shared configs from `@microsoft/vscode-azext-eng/esbuild`:

```javascript
const { extensionConfig, telemetryConfig } = autoSelectEsbuildConfig();

extensionConfig.alias = {
    ...extensionConfig.alias,
    '@microsoft/vscode-azure-utils': '../../packages/utils/src/index.ts',
    '@microsoft/vscode-azure-azutils': '../../packages/azutils/src/index.ts',
};

await autoEsbuildOrWatch({ extensionConfig, telemetryConfig });
```

- `autoSelectEsbuildConfig()` returns both an `extensionConfig` and a `telemetryConfig` (for the separate telemetry bundle). Output is CommonJS (`.js`), which the CJS `main.js` entry point loads with `require()`.
- `autoEsbuildOrWatch` builds in production mode by default, or enters watch mode when `--watch` is passed on the command line.
- The `alias` configuration resolves local package imports to their source files so esbuild bundles them directly.

## Watch Mode / Iterative Development

Watch mode exists only for the **builds**, and mostly for the VS Code UI rather than for speed. Each build watch is an npm script named `<script>:watch`:

```bash
# Extension: type checking in watch mode (tsc --noEmit --watch)
# This is the default VS Code build task ("Extension: Check+Watch").
pnpm --filter vscode-azure run build:check:watch

# Extension: esbuild bundle in watch mode ("Extension: ESBuild+Watch")
pnpm --filter vscode-azure run build:esbuild:watch

# Library packages: tsc in watch mode ("utils: Build+Watch" / "azutils: Build+Watch")
pnpm --filter @microsoft/vscode-azure-utils run build:watch
pnpm --filter @microsoft/vscode-azure-azutils run build:watch
```

These are also the VS Code build tasks in `.vscode/tasks.json`; each task just runs the corresponding script. They are most useful for the live problem-matcher integration (errors appear in the Problems panel as you type).

The extension builds (both esbuild and the type-check) resolve the packages to their `src/*.ts` source directly — esbuild via its `alias` config and `tsc` via the `paths` mapping in `extensions/vscode-azure/tsconfig.json` — so the extension watches already pick up package source edits without a rebuild of `dist/`. Run a package's own build watcher when you want to type-check that package in isolation — it covers the whole package (including files not reachable from the extension, such as its tests), which the extension's check watch does not.

### Why there is no lint or test watch

Both are technically possible (wrapping the binary in `node --watch`, since ESLint has no watch flag and Mocha's own `--watch` silently reports `0 passing` under this repo's ESM setup), but measurement showed they are not worth the complexity:

- **`node --watch` restarts a fresh process on every change**, so it re-runs the *entire* lint or suite. It saves only the pnpm/shell startup — for the extension, a watch re-run measured ~7.2s against ~8.5s for a one-shot run.
- **`--cache` beats it outright.** The ESLint cache is a file on disk, so it works for ordinary one-shot runs and *is* genuinely incremental: the same extension lint drops to ~2.3s when nothing changed and ~4-5s when one file changed. A watch, by restarting, can never benefit from it.
- **The builds are already fast enough** that watching them is a convenience, not a speed-up: a cold `pnpm run build` for the whole monorepo is ~3.5s, and individual package builds are sub-second.

So for lint, just run the (cached) `lint` script; see [Linting](#linting). For tests, run the package's `test` script directly — the packages' suites are 2-4s.

### No watch available for

- **Extension tests** — the extension's `test` script is `vscode-test` (`@vscode/test-cli`), which launches a full VS Code instance and has no re-running watch mode. Run `pnpm --filter vscode-azure run test` instead. Note that most of the ~7s runtime is the VS Code launch, not the tests (682 tests run in about a second), so `--grep` saves very little.


## Linting

```bash
pnpm run lint                                         # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run lint  # Single workspace
```

Uses ESLint with strict type-checked configuration from `@microsoft/vscode-azext-eng/eslint`.

The `lint` script passes `--cache`, so ESLint re-checks only files that changed since the last run. This is the main lever on lint time: a full extension lint is ~8s cold, ~2.3s when nothing changed, and ~4-5s when a single file changed. The cache lives in a gitignored `.eslintcache` per workspace and is removed by `pnpm run clean`.

Caching is safe to leave on by default — ESLint keys the cache on the resolved config as well as file contents, so editing `eslint.config.mjs` (or enabling a rule) correctly invalidates every entry rather than reporting a stale pass. There is no need to drop `--cache` for a pre-PR run.

### Faster lint iteration

Beyond the cache:

- **Filter to specific files/dirs.** Pass paths through the workspace script (after `--`) so ESLint only lints what you touched instead of the whole package:

  ```bash
  # Lint a single file (or a directory) in one package
  pnpm --filter @microsoft/vscode-azure-utils run lint -- src/tree/DataItemTree.ts
  pnpm --filter vscode-azure run lint -- src/commands
  ```

  Note there is a floor of roughly 2-4s per invocation: ESLint startup plus building the TypeScript program for type-aware rules. Linting one file is not much cheaper than linting a cached package, so prefer scoping to the *workspace* you actually changed over micro-filtering to single files.

- **Run workspaces in parallel.** The root `pnpm run lint` already fans out across the three workspaces (`pnpm -r --parallel run lint`), so a full lint runs them concurrently rather than in series.

Do a final full `pnpm run lint` before opening a PR, since path-filtered runs can miss issues in files you didn't touch this pass.

## Cleaning

```bash
pnpm run clean                                         # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run clean  # Single workspace
```

Removes `dist/` and `coverage/` folders. Each workspace calls the shared `scripts/clean.mjs` script.

## Testing

```bash
pnpm run test                                            # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run test     # Single workspace
pnpm --filter @microsoft/vscode-azure-utils run testcov  # With coverage (c8)
pnpm --filter vscode-azure run testcov                   # With coverage (vscode-test)
```

See [Testing](testing.md) for details on test runners and coverage.

## Packaging

```bash
pnpm --filter vscode-azure run package                   # vsce package
pnpm --filter @microsoft/vscode-azure-utils run package  # pnpm pack
```

## Extension Entry Point

The extension entry point is `main.js` (CommonJS), which measures bundle load time and delegates to the esbuild bundle:

```javascript
const perfStats = { loadStartTime: Date.now(), loadEndTime: undefined };
const extension = require('./dist/extension.bundle.js');

exports.activate = async function activate(ctx) {
    return await extension.activateInternal(ctx, perfStats);
}

perfStats.loadEndTime = Date.now();
```

This separation allows accurate measurement of the bundle loading time for telemetry.
