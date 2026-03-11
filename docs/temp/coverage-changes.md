# VS Code Extension Test Coverage — Change Report

## Problem

Running `vscode-test --coverage` on a bundled VS Code extension only showed coverage of `extension.bundle.mjs`, not the original source files. Two upstream issues prevented source map remapping from working:

1. **`@vscode/test-cli`** does not pass `excludeAfterRemap` to c8, so exclude patterns (e.g. `node_modules/**`) only apply to pre-remap script URLs, not remapped source paths.
2. **`c8`** uses the V8 `source-map-cache` when available, but Electron/VS Code caches a **trivial identity source map** (where the only source is the bundle itself) instead of the real linked `.map` file. This prevents v8-to-istanbul from reading the esbuild source map with all original sources.

## Upstream Changes

These patches must be re-applied to `node_modules` after `npm install` until the upstream packages are updated. The full file paths are:

- `node_modules/@vscode/test-cli/out/cli/coverage.mjs`
- `node_modules/c8/lib/report.js`

### 1. `node_modules/@vscode/test-cli/out/cli/coverage.mjs`

Add `excludeAfterRemap: true` to the c8 Report constructor so that exclude/include patterns apply to remapped source paths.

```diff
             const report = new Report({
                 tempDirectory: this.targetDir,
                 exclude: cfg.exclude,
                 include: cfg.include,
                 reporter: this.args.coverageReporter?.length
                     ? this.args.coverageReporter.map(String)
                     : defaultReporters,
                 reporterOptions,
                 reportsDirectory: this.args.coverageOutput || join(this.config.dir, 'coverage'),
                 src: this.getSourcesDirectories(),
                 all: cfg.includeAll,
                 excludeNodeModules: true,
+                excludeAfterRemap: true,
                 // not yet in the .d.ts for c8:
                 //@ts-ignore
                 mergeAsync: true,
             });
```

### 2. `node_modules/c8/lib/report.js` (`_getSourceMap` method)

Skip the `source-map-cache` entry when it contains a trivial identity mapping (single source pointing to itself). This lets v8-to-istanbul fall through to reading the linked `.map` file from disk.

```diff
     _getSourceMap(v8ScriptCov) {
         const sources = {}
         const sourceMapAndLineLengths = this.sourceMapCache[pathToFileURL(v8ScriptCov.url).href]
         if (sourceMapAndLineLengths) {
             // See: https://github.com/nodejs/node/pull/34305
             if (!sourceMapAndLineLengths.data) return
+
+            // If the source-map-cache contains a trivial identity mapping
+            // (only source is the file itself), skip it so that
+            // v8-to-istanbul can read richer source maps from disk.
+            const cachedSources = sourceMapAndLineLengths.data.sources
+            if (cachedSources && cachedSources.length === 1) {
+                const selfUrl = pathToFileURL(v8ScriptCov.url).href
+                if (cachedSources[0] === selfUrl || cachedSources[0] === v8ScriptCov.url) {
+                    return sources
+                }
+            }
+
             sources.sourceMap = {
                 sourcemap: sourceMapAndLineLengths.data
             }
```

## Local Changes (this repo)

### 1. `extensions/vscode-azure/esbuild.mjs`

Enable linked source maps so c8 can remap bundle coverage back to original sources.

```diff
 extensionConfig.alias = {
     ...extensionConfig.alias,
     '@microsoft/vscode-azure-utils': '../../packages/utils/src/index.ts',
     '@microsoft/vscode-azure-azutils': '../../packages/azutils/src/index.ts',
 };

+// Enable source maps so that c8 can remap bundle coverage back to original sources
+extensionConfig.sourcemap = 'linked';
+
 await autoEsbuildOrWatch({ extensionConfig, telemetryConfig });
```

### 2. `extensions/vscode-azure/package.json`

Add `testcov` script.

```diff
         "test": "vscode-test",
+        "testcov": "vscode-test --coverage --coverage-reporter=html --coverage-output=coverage"
     },
```

## How It Works

1. `esbuild` produces `dist/extension.bundle.mjs` + `dist/extension.bundle.mjs.map` with source paths pointing to all original `.ts` files
2. `vscode-test --coverage` sets `NODE_V8_COVERAGE` on the extension host, collecting V8 coverage data
3. c8 processes the V8 data; the identity source-map-cache fix causes it to read the linked `.map` file instead of the degenerate cached version
4. v8-to-istanbul remaps bundle coverage ranges back to individual source files
5. `excludeAfterRemap` ensures `node_modules/**` and other excludes apply to the remapped paths
6. Unit test coverage (from direct tsx imports) merges with integration test coverage (from the remapped bundle) into a single report per source file
