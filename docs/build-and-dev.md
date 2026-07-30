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

For fast, iterative work, prefer the **watch scripts** over re-running a full `pnpm run build` / `pnpm run lint` / `pnpm run test` after every edit. Every watch is exposed as a `*:watch` npm script, so they are all reachable the same way:

```bash
pnpm --filter <package> run <script>:watch
```

| Workspace | Build | Lint | Test |
| --- | --- | --- | --- |
| `@microsoft/vscode-azure-utils` | `build:watch` | `lint:watch` | `test:watch` |
| `@microsoft/vscode-azure-azutils` | `build:watch` | `lint:watch` | `test:watch` |
| `vscode-azure` (extension) | `build:check:watch`, `build:esbuild:watch` | `lint:watch` | *(none — see below)* |

The build watches are also available as VS Code build tasks in `.vscode/tasks.json` (`Extension: Check+Watch` is the default build task); each task just runs the corresponding `*:watch` script. The lint and test watches are command-line only.

Run the watches that match what you are changing — they catch different classes of problem and are not redundant:

| Watch | Catches | Misses |
| --- | --- | --- |
| Build (`tsc`) | Type errors, in ~1s | Anything that type-checks but behaves wrong |
| Lint | Style and type-aware rules (e.g. unsafe `any` fallout) | Runtime/logic bugs |
| Test | Logic and runtime bugs | Nothing type- or style-specific |

A pure logic bug (say, dropping an `&& value !== ''` guard) type-checks and lints cleanly — only the test watch turns red. Conversely, `node --experimental-transform-types` strips types *without* checking them, so a type error still runs and usually surfaces as a pile of confusing runtime test failures; when the test watch goes red, check the build watch first, since a single type error is often the real cause.

### Build watches

```bash
# Extension: type checking in watch mode (tsc --noEmit --watch)
# Most useful for catching type errors while editing. This is the default
# VS Code build task ("Extension: Check+Watch").
pnpm --filter vscode-azure run build:check:watch

# Extension: esbuild bundle in watch mode ("Extension: ESBuild+Watch")
pnpm --filter vscode-azure run build:esbuild:watch

# Library packages: tsc in watch mode ("utils: Build+Watch" / "azutils: Build+Watch")
pnpm --filter @microsoft/vscode-azure-utils run build:watch
pnpm --filter @microsoft/vscode-azure-azutils run build:watch
```

The extension builds (both esbuild and the type-check) resolve the packages to their `src/*.ts` source directly — esbuild via its `alias` config and `tsc` via the `paths` mapping in `extensions/vscode-azure/tsconfig.json` — so the extension watches already pick up package source edits without a rebuild of `dist/`. Run a package's own build watcher when you want to type-check that package in isolation — it covers the whole package (including files not reachable from the extension, such as its tests), which the extension's check watch does not.

### Lint watch

```bash
pnpm --filter @microsoft/vscode-azure-utils run lint:watch
pnpm --filter @microsoft/vscode-azure-azutils run lint:watch
pnpm --filter vscode-azure run lint:watch
```

ESLint has no native watch mode, so these scripts wrap the ESLint binary in `node --watch`, which re-runs the whole lint in a fresh process whenever a file under `src/` or `test/` changes. Each run is a full lint of the package (a few seconds), and the output is the normal ESLint report, so a clean run prints nothing.

> The scripts reference the binary as `../../node_modules/eslint/bin/eslint.js` because `node --watch` needs a real JS entry point rather than a `.bin` shim. That path is stable because `*eslint*` (and `mocha`, used below) are listed in `publicHoistPattern` in `pnpm-workspace.yaml`, so they always resolve to the repo-root `node_modules`.

### Test watch (packages only)

```bash
pnpm --filter @microsoft/vscode-azure-utils run test:watch
pnpm --filter @microsoft/vscode-azure-azutils run test:watch
```

These use the same `node --watch` wrapper around Mocha's binary. Because the wrapper invokes `mocha` itself (not `_mocha`), Mocha still reads its configuration from the `"mocha"` key in the package's `package.json`, so the specs and `node-option` settings stay in one place. There is no build step: Mocha runs the `.ts` sources directly via `node --experimental-transform-types`.

The watch scripts override the reporter with `--reporter dot`, which keeps a passing run to a few lines instead of the ~26 KB the default `spec` reporter emits for the full suite, while still printing complete assertion diffs and stack traces for failures. The one-shot `test` and `testcov` scripts keep the default reporter.

> **Do not use Mocha's own `--watch` flag here.** Mocha's watch mode cannot invalidate the ESM module graph, so the re-runs silently collect no tests and report `0 passing` — which looks like a green run. Restarting the process with `node --watch` avoids this entirely.

`azutils` tests import `@microsoft/vscode-azure-utils/testing` from the `utils` package's `dist/`, so build `utils` at least once (or run its `build:watch`) before starting the `azutils` test watch.

### No watch available for

- **Extension tests** — the extension's `test` script is `vscode-test` (`@vscode/test-cli`), which launches a full VS Code instance and has no re-running watch mode. Run `pnpm --filter vscode-azure run test` instead.


## Linting

```bash
pnpm run lint                                         # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run lint  # Single workspace
```

Uses ESLint with strict type-checked configuration from `@microsoft/vscode-azext-eng/eslint`.

### Faster lint iteration

Prefer `lint:watch` (see [Lint watch](#lint-watch)) while iterating. For one-off runs, you can also shorten the feedback loop:

- **Filter to specific files/dirs.** Pass paths through the workspace script (after `--`) so ESLint only lints what you touched instead of the whole package. This is the biggest win while iterating on a few files:

  ```bash
  # Lint a single file (or a directory) in one package
  pnpm --filter @microsoft/vscode-azure-utils run lint -- src/tree/DataItemTree.ts
  pnpm --filter vscode-azure run lint -- src/commands
  ```

- **Run workspaces in parallel.** The root `pnpm run lint` already fans out across the three workspaces (`pnpm -r --parallel run lint`), so a full lint runs them concurrently rather than in series.
- **Cache results.** Add `--cache` so ESLint only re-checks files that changed since the last run:

  ```bash
  pnpm --filter @microsoft/vscode-azure-utils run lint -- --cache
  ```

Do a final full `pnpm run lint` before opening a PR, since filtered/cached runs can miss issues in files you didn't touch this pass.

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
