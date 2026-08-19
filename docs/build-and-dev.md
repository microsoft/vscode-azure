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

Only the **builds** have dedicated watch scripts, each named `<script>:watch`:

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

These are also the VS Code build tasks in `.vscode/tasks.json`; each task just runs the corresponding script, so errors appear live in the Problems panel.

The extension builds (both esbuild and the type-check) resolve the packages to their `src/*.ts` source directly — esbuild via its `alias` config and `tsc` via the `paths` mapping in `extensions/vscode-azure/tsconfig.json` — so the extension watches already pick up package source edits without a rebuild of `dist/`. Run a package's own build watcher when you want to type-check that package in isolation — it covers the whole package (including files not reachable from the extension, such as its tests), which the extension's check watch does not.

There is no lint watch. The package `test` scripts are plain `mocha`, so `--watch` is accepted — but it silently does nothing useful here: Mocha's `--extension` defaults to `["js","cjs","mjs"]` while these specs are `.ts`, so no source edit ever triggers a re-run. If you want a test watch, `--extension ts` is required:

```bash
pnpm --filter @microsoft/vscode-azure-utils run test -- --watch --extension ts
```

The extension's `vscode-test` runner has no watch mode at all.

## Running against mock data

The **Extension: Run (Mock Data)** launch configuration sets `AZURE_MOCK_DATA=1`, which makes `main.js` apply [`test/override/mock.ts`](../extensions/vscode-azure/test/override/mock.ts) to the container after `setUpContainer` but before activation. It runs in its own `Azure Mock Data` settings profile, so a personal subscription filter cannot hide the mock data.

The overrides are deliberately shallow: they rebind the lowest thing that issues I/O -- the `IAzureListingFetcher`, the resource/ACR clients, and the `ICredentialFactory` -- and leave the listing cache, the subscription filter, and the whole tree above them real. Mock mode therefore exercises the same code paths as a live session, including flows that read the cache directly such as `Azure: Select Subscriptions`.

Two accounts are signed in, covering both shapes the account -> tenant -> subscription hierarchy comes in:

| Account | What it demonstrates |
|---------|----------------------|
| `Mock Account` | The ordinary path: a tenant that enumerates, holding one subscription with resource groups and resources beneath it. |
| `Mock Account (Conditional Access)` | An account whose `tenants.list()` is blocked. It appears signed in but empty, which is what sends a user to `Azure: Sign In` -> **type a tenant ID**. The entered id is persisted to `vscode-azure.signedInTenants`, folded back into the account's tenant listing, and given a subscription of its own, so the whole manual-tenant path can be walked without an Azure account. |

Because the mock credential factory has no cached session behind it, silent acquisition fails -- so a manually-entered tenant keeps showing its id as its display name rather than being enriched to its real name. That is the same outcome as a real session that conditional access still will not let list tenants.

The fixtures behind all of this (`createMockAzureListingFetcher`, `createMockCredentialFactory`) come from `@microsoft/vscode-azure-azutils/testing` and are the same ones the automated tests use, so a scenario worth clicking through is usually also worth asserting -- see `test/commands/auth/manualTenantSignIn.test.ts`.

## Sharing the VS Code test download across worktrees

The extension's test runner downloads a full VS Code build (~1 GB) into `extensions/vscode-azure/.vscode-test`, and every new clone or `git worktree` re-downloads it. There is no config knob — `@vscode/test-electron` resolves its cache as `<cwd>/.vscode-test` and `@vscode/test-cli` never passes a `cachePath` — so the only lever is to link that path somewhere shared:

```bash
pnpm run link-test-cache
```

Run it once per worktree, *before* the first test run. It links `.vscode-test` to a machine-wide cache (default `<homedir>/.vscode-test-cache`, override with `VSCODE_TEST_CACHE_DIR`). It is idempotent and refuses to clobber a real `.vscode-test` directory — move that to the shared location first to keep the existing download.

Two caveats: `.vscode-test` also holds the `--user-data-dir` and `--extensions-dir`, so linked worktrees share one VS Code profile and shouldn't run tests concurrently. And this is deliberately not in `postinstall`, since it writes outside the repo and is pointless on CI.

## Linting

```bash
pnpm run lint                                         # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run lint  # Single workspace
```

Uses ESLint with strict type-checked configuration from `@microsoft/vscode-azext-eng/eslint`.

The `lint` script passes `--cache`, so ESLint re-checks only files that changed since the last run. The cache lives in a gitignored `.eslintcache` per workspace and is removed by `pnpm run clean`. Editing `eslint.config.mjs` correctly invalidates it, but the cache is per file with no cross-file dependency tracking — under the type-checked rules, a diagnostic in `B.ts` that depends on types from `A.ts` can be missed when only `A.ts` changed. Treat the pre-PR full run as the authority.

### Faster lint iteration

Beyond the cache:

- **Filter to specific files/dirs.** Pass paths through the workspace script (after `--`) so ESLint only lints what you touched instead of the whole package:

  ```bash
  # Lint a single file (or a directory) in one package
  pnpm --filter @microsoft/vscode-azure-utils run lint -- src/tree/DataItemTree.ts
  pnpm --filter vscode-azure run lint -- src/commands
  ```

  There is a fixed per-invocation floor (ESLint startup plus building the TypeScript program for type-aware rules), so linting one file is not much cheaper than linting a cached package. Prefer scoping to the *workspace* you changed over micro-filtering to single files.

- **Run workspaces in parallel.** The root `pnpm run lint` already fans out across the three workspaces (`pnpm -r --parallel run lint`), so a full lint runs them concurrently rather than in series.

Do a final full `pnpm run lint` before opening a PR, since path-filtered and cached runs can miss issues in files you didn't touch this pass.

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
