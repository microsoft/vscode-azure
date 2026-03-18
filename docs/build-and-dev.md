# Build & Development

## Prerequisites

- Node.js (see `.nvmrc` or `engines` in `package.json`)
- npm (comes with Node.js; workspace support required)

## Setup

```bash
npm install
```

This runs the `postinstall` script automatically.

## Monorepo Structure

The project uses npm workspaces:

```json
"workspaces": [
    "packages/utils",
    "packages/azutils",
    "extensions/vscode-azure"
]
```

Root-level scripts delegate to all workspaces:

```bash
npm run lint    # → npm run --workspaces lint
npm run build   # → npm run --workspaces build
npm run test    # → npm run --workspaces test
npm run clean   # → npm run --workspaces clean
```

Target a specific workspace with `--workspace`:

```bash
npm run build --workspace=packages/utils
npm run test --workspace=extensions/vscode-azure
```

## Building

### Packages (`utils`, `azutils`)

Packages compile TypeScript to JavaScript using **tsgo** (native TypeScript compiler):

```bash
npm run build --workspace=packages/utils     # tsgo
npm run build --workspace=packages/azutils   # tsgo
```

Output goes to `dist/esm/`.

### Extension

The extension uses **esbuild** to bundle all source (including packages) into a single file, plus a separate type-check pass:

```bash
npm run build --workspace=extensions/vscode-azure
# Runs two commands in series:
#   build:esbuild — node esbuild.mjs (produces dist/extension.bundle.mjs)
#   build:check   — tsgo --noEmit (type checking only)
```

#### esbuild Configuration

`esbuild.mjs` uses shared configs from `@microsoft/vscode-azext-eng/esbuild`:

```javascript
const { extensionConfig, telemetryConfig } = autoSelectEsbuildConfig(true);

extensionConfig.alias = {
    ...extensionConfig.alias,
    '@microsoft/vscode-azure-utils': '../../packages/utils/src/index.ts',
    '@microsoft/vscode-azure-azutils': '../../packages/azutils/src/index.ts',
};

await autoEsbuildOrWatch({ extensionConfig, telemetryConfig });
```

- `autoSelectEsbuildConfig(true)` returns both an `extensionConfig` and a `telemetryConfig` (for the separate telemetry bundle). The `true` argument enables ESM output.
- `autoEsbuildOrWatch` builds in production mode by default, or enters watch mode when `--watch` is passed on the command line.
- The `alias` configuration resolves local package imports to their source files so esbuild bundles them directly.

## Watch Mode

For development, run the watch mode build tasks:

```bash
# Extension: esbuild in watch mode
npm run --workspace=extensions/vscode-azure build:esbuild -- --watch

# Extension: type checking in watch mode
npm run --workspace=extensions/vscode-azure build:check -- --watch

# Package: type checking in watch mode
npm run --workspace=packages/utils build -- --watch
```

VS Code tasks are preconfigured in `.vscode/tasks.json` for these.

## Linting

```bash
npm run lint                            # All workspaces
npm run lint --workspace=packages/utils # Single workspace
```

Uses ESLint with strict type-checked configuration from `@microsoft/vscode-azext-eng/eslint`.

## Cleaning

```bash
npm run clean                            # All workspaces
npm run clean --workspace=packages/utils # Single workspace
```

Removes `dist/`, `coverage/`, and `.nyc_output/` folders. Each workspace calls the shared `scripts/clean.mjs` script.

## Testing

```bash
npm run test                                    # All workspaces
npm run test --workspace=packages/utils         # Single workspace
npm run testcov --workspace=packages/utils      # With coverage (nyc)
npm run testcov --workspace=extensions/vscode-azure # With coverage (vscode-test)
```

See [Testing](testing.md) for details on test runners and coverage.

## Packaging

```bash
npm run package --workspace=extensions/vscode-azure  # vsce package
npm run package --workspace=packages/utils           # npm pack
```

## Extension Entry Point

The extension entry point is `main.mjs`, which measures bundle load time and delegates to the esbuild bundle:

```javascript
const perfStats = { loadStartTime: Date.now(), loadEndTime: undefined };
const extension = await import('./dist/extension.bundle.mjs');

export async function activate(ctx) {
    return await extension.activateInternal(ctx, perfStats);
}

perfStats.loadEndTime = Date.now();
```

This separation allows accurate measurement of the bundle loading time for telemetry.
