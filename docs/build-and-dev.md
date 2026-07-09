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

Packages compile TypeScript to JavaScript using **tsgo** (native TypeScript compiler):

```bash
pnpm --filter @microsoft/vscode-azure-utils run build     # tsgo
pnpm --filter @microsoft/vscode-azure-azutils run build   # tsgo
```

Output goes to `dist/esm/`.

### Extension

The extension uses **esbuild** to bundle all source (including packages) into a single file, plus a separate type-check pass:

```bash
pnpm --filter vscode-azure run build
# Runs two commands in series:
#   build:esbuild — node esbuild.mjs (produces dist/extension.bundle.js)
#   build:check   — tsgo --noEmit (type checking only)
```

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

For fast, iterative work, prefer the **watch tasks** over re-running a full `pnpm run build` after every edit. Each watch task simply appends `-- --watch` to an existing build script, so the underlying compiler stays resident and only recompiles what changed.

> These watch tasks live in `.vscode/tasks.json` (each is an `isBackground: true` build task) and are **not** exposed as npm scripts, so they are easy to miss. Run them from the command line as shown below, or via VS Code's **Run Build Task** (`Extension: Check+Watch` is the default build task).

### Build watches

```bash
# Extension: type checking in watch mode (tsgo --noEmit --watch)
# Most useful for catching type errors while editing. This is the default
# VS Code build task ("Extension: Check+Watch").
pnpm --filter vscode-azure run build:check -- --watch

# Extension: esbuild bundle in watch mode ("Extension: ESBuild+Watch")
pnpm --filter vscode-azure run build:esbuild -- --watch

# Library packages: tsgo in watch mode ("utils: Build+Watch" / "azutils: Build+Watch")
pnpm --filter @microsoft/vscode-azure-utils run build -- --watch
pnpm --filter @microsoft/vscode-azure-azutils run build -- --watch
```

The extension consumes the packages' built output, so when you change a package, run **that package's** watcher too (in addition to the extension watches).

### Test watch (packages only)

The `utils` and `azutils` packages support a Mocha watch mode:

```bash
pnpm --filter @microsoft/vscode-azure-utils run test -- --watch
pnpm --filter @microsoft/vscode-azure-azutils run test -- --watch
```

This works because Mocha is configured (under the `"mocha"` key in each package's `package.json`) to run the `.ts` sources directly via `node --experimental-transform-types` (spec `src/test/**/*.test.ts`). There is no separate build step, so Mocha re-runs the suite whenever a source or test file changes.

### No watch available for

- **Lint** — the `lint` script is plain `eslint --max-warnings 0`; ESLint has no native `--watch` flag and no watch wrapper is installed. Run `pnpm run lint` manually.
- **Extension tests** — the extension's `test` script is `vscode-test` (`@vscode/test-cli`), which has no re-running watch mode. Run the full `pnpm --filter vscode-azure run test` instead.

## Linting

```bash
pnpm run lint                                         # All workspaces
pnpm --filter @microsoft/vscode-azure-utils run lint  # Single workspace
```

Uses ESLint with strict type-checked configuration from `@microsoft/vscode-azext-eng/eslint`.

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
