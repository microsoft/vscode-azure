# Instructions for Copilot

For detailed documentation on the project architecture and patterns, see the `docs/` folder:
* `docs/architecture.md` -- Package organization, dependency graph, activation flow
* `docs/tree-views.md` -- Data/view layer separation, providers, enrichment, caching, pagination, activity tree, resource icons
* `docs/dependency-injection.md` -- Container setup, service identifiers, scoped execution, factory bindings
* `docs/commands.md` -- ManagedCommand pattern, registration, context values, prefixArgs
* `docs/conventions.md` -- Naming, imports, localization, ARM types, copyright headers
* `docs/wizard.md` -- PromptStep/ExecuteStep, back navigation, dynamic steps
* `docs/resource-creation.md` -- AzdJob, wizard step sequence, scenario matrix, hydration, adding new resource types
* `docs/testing.md` -- Unit vs integration tests, mocking with `createMockVsCode()`, coverage
* `docs/tree-perf-gates.md` -- Tree performance regression gates: counters, scenario matrix, baselines
* `docs/resource-models.md` -- AzureNode union, GenericResource, AzureNodeId URI scheme
* `docs/telemetry.md` -- IActionContext, ActionExecutor, telemetry suppression
* `docs/build-and-dev.md` -- Build commands, esbuild, watch mode, linting, cleaning
* `docs/azure-clients.md` -- Azure SDK client wrappers, pipeline policies, factory functions, toPages


## General Instructions

* Use single quotes instead of double quotes for strings
* Use only ASCII characters in source
* Use `import type` for type-only imports
* Use `import * as vscode` for the VS Code API (the only namespace import)
* Prefer named exports; avoid default exports
* Use the `I`-prefix for DI service identifier interfaces (e.g., `IVsCode`)
* Use the following interfaces in place of the built-in `vscode` types when possible:
  - `IVsCode` instead of `vscode`
  - `IExtensionContext` instead of `vscode.ExtensionContext`
  - `IOutputChannel` instead of `vscode.OutputChannel`
  - `EventEmitter` instead of `vscode.EventEmitter`
  - `Disposable` instead of `vscode.Disposable`
* Mark interface properties as `readonly` by default, unless the property is intentionally mutable (e.g. set by a later step in a pipeline)
* Use PascalCase for files containing classes/interfaces, camelCase for function-oriented files
* Label test cases with `(unit)`, `(integration)`, or `(e2e)` **after** the name in the root `describe` description (e.g., `describe('AzureNodeId (unit)', ...)`)
* Include the Microsoft copyright header on every TypeScript/JavaScript file
* Use `void` prefix for intentionally un-awaited promises, unless they have a `.then()` with two arguments (for resolve and reject), or a `.catch()` handler
* Use scoped `eslint-disable` comments on specific lines, avoid file-wide unless it requires repeating the same disable many times
* Strings that will be seen by the user must use `IVsCode.l10n.t()` for localization (debug and trace output to the output channel is exempt from this requirement)
* Logging must follow `docs/conventions.md` (Logging section), and log messages must never include PII/secrets (tokens, auth secrets, user emails/display names, request/response bodies, or file contents)
* Never commit **raw telemetry query results** to the repo (e.g. Kusto/ADX output from `RawEventsVSCodeExt`: per-feature counts, user/machine counts, result-state tables, exported CSV/JSON). A **decision and its rationale are fine to commit** even when the rationale is telemetry-derived (e.g. "dropped: low external usage per telemetry"), but state it **qualitatively** — do not paste the counts, result tables, or raw rows. Query **text/links** (KQL, ADX deeplinks) are queries, not data, and may be committed. Keep raw telemetry output in session/scratch space only.
* When coercing a caught `unknown` error into a message string (for logging, telemetry, or display), use `stringifyError()` from `@microsoft/vscode-azure-utils` instead of hand-rolling an `error instanceof Error ? error.message : String(error)` check
* In product code, use `vscode.workspace.fs` and `vscode.Uri` instead of Node's `fs`/`fs/promises` and string paths. Use `Uri.fsPath` only when an API requires a string (e.g., `child_process` `cwd`). Use `vscode.workspace.fs.stat()` to check file existence (prefer over `workspace.findFiles()` which is workspace-scoped). Use `extensionContext.extensionUri` with `Uri.joinPath()` instead of `extensionContext.asAbsolutePath()`.
* Any time ARM resource types (`GenericResource.type`) or logical types (`GenericResource.logicalType`) are checked, they should be compared **case-insensitively** to a constant (e.g., `AcrResourceType`) rather than a string literal
* Azure SDK types used in client wrapper public APIs must be re-exported from the wrapper file in `packages/azutils/src/rest/clients/`. The extension and other consumers import these types from `@microsoft/vscode-azure-azutils`, never directly from `@azure/*` packages.
* Commands that act on tree items should define a static `ContextValue` property. The view provider should use that in the tree item's `contextValue`. In `package.json`, the command's `when` clause should check for the context value with a regex (e.g., `viewItem =~ /\\bmyContextValue\\b/i`) rather than an equality check, to allow for multiple context values. The `\b` in the regex is important to prevent unintended matches (e.g., `myContextValue` matching `myContextValueWithSuffix`).
* Resource icon SVGs in `packages/azutils/resources/azureIcons/` are resolved by convention: the filename **must** equal `<logicalType>.toLowerCase() + '.svg'`, with `/` acting as directory separators. A mismatch causes VS Code to silently show no icon. When adding a new resource type that shares an ARM type with other products (e.g., `Microsoft.Web/sites`), add a logical type constant and a `logicalType()` branch in `ResourceClient.ts`, then name the icon to match the new logical type. See `docs/tree-views.md` (Resource Icons) for the full convention.


## Understanding the Data Model

The tree UI is split into two independent layers: a **data layer** and a **view layer**. Both layers live in `packages/utils/src/tree/` and use the same provider-dispatch pattern.

### Provider model

Both layers extend `ProviderRegistry`, which maintains an ordered list of providers. Each provider declares a `canHandle(resource)` type-guard; the registry dispatches to the first matching provider. Registration order matters -- more-specific providers must be registered before broader/fallback ones. Providers with `isRoot: true` are called with no argument to produce top-level (root) items.

### Data layer (`DataItemTree` + `DataProvider`)

* `DataItemTree<T>` is the single source of truth for data. It lazily loads children via registered `DataProvider<T>` implementations and caches them with a configurable TTL.
* Children are fetched on first access and re-fetched once stale (`staleAt` timestamp). Callers force a refresh through one of two methods that share a `Target<T>` surface: `invalidate(target)` (mark matched nodes stale and re-fetch on next access) and `remove(target)` (evict matched nodes and splice them out). A target may be a bare resource/key/array (matched by key, subtree scope), `selfOnly(...)` / `subtreeOf(...)`, a `Selector<T>` verdict predicate (e.g. `bySubscription(id)`), or the `Roots` / `Everything` sentinels. Prefer the narrowest target that's correct (`Roots` or a selector over `Everything`). See `docs/tree-views.md` (Targets & selectors).
* **Enrichment** -- after children are loaded, `DataItemTree` calls each provider's optional `enrich(resource)` method in the background. Enrichment mutates the resource in-place (keeping the same object reference) and fires `onDidChange` when done. Callers that need the enriched data can `await cache.whenEnriched(resource)`.
* A `NodeMap` provides O(1) key-based lookup and recursive subtree removal for cache eviction.

### View layer (`ViewItemTree` + `ViewProvider`)

* `ViewItemTree<TViewItem, TResource>` sits on top of a `DataItemTree` and implements VS Code's `TreeDataProvider`. It converts data-layer resources into view items via a `toViewItem` callback.
* Registered `ViewProvider`s control presentation: they may inject virtual nodes (groupings, headers, etc.), filter, reorder, or group children -- but may not modify the data layer.
* `ViewProvider` extends `DataProvider` but disallows `enrich` (`enrich?: never`). It adds a `getTreeItem(resource)` method that returns an `ITreeItem` for rendering.
* `ViewItemTree` tracks parent relationships internally so `getParent()` works for both real and virtual nodes.
* Changes in the data layer automatically propagate: `ViewItemTree` subscribes to `DataItemTree.onDidChange` and forwards the event as a view-level `onDidChangeTreeData` fire.

### Concrete Azure implementation

* `AzureResourceDataProvider` (extension layer) is a `DataProvider` that fetches resource groups and their resources via the Azure SDK.
* `GenericAzureViewProvider` (extension layer) is a `ViewProvider` that maps Azure resources to tree items with icons, context values, grouping strategies, etc.
* Service-specific providers (e.g. ACR) handle narrower resource types and are registered alongside the generic ones.

### Tree registration (`registerTrees.ts`)

All trees are wired up declaratively via `registerTree()` which takes a `TreeConfig<TData>` object. Providers are listed as `ProviderEntry<T>` arrays -- either a bare class (simple binding) or a `[primaryId, Class]` tuple (singleton under `primaryId`, aliased into the collection for direct `@inject`). Order in the array determines dispatch priority. To add a new tree provider, add the class to the appropriate `dataProviders` or `viewProviders` array in `registerTrees.ts` -- before the generic fallback.


## Writing JSDocs

* Add JSDoc comments to exported symbols (classes, interfaces, types, functions, and notable members) so consumers can understand intent and contracts without reading the implementation. Internal/private helpers only need JSDoc when their behavior is non-obvious.
* Focus on **why / contract / side effects** -- preconditions, postconditions, thrown errors, lifetime/ownership, threading, caching, and mutation behavior. Don't restate what the signature already says.
* Reference other symbols with `{@linkcode Symbol}` (or `{@linkcode Namespace.Symbol DisplayName}` for qualified names, e.g. `{@linkcode vscode.TreeView TreeView}`, `{@linkcode vscode.TreeDataProvider.getChildren TreeDataProvider.getChildren}`). Prefer `{@linkcode ...}` over plain backticks whenever the target is an actual importable/reachable symbol, because it renders as code **and** gives you a clickable cross-reference in hover/IntelliSense.
* Use plain backticks (`` `...` ``) for things that are **not** resolvable symbols: file names (`main.js`), environment variables (`AZURE_MOCK_DATA=1`), CLI flags, JSON keys, shell commands, and literal code fragments.
* Use standard tags where appropriate: `@param`, `@returns`, `@throws`, `@example`, `@remarks`, `@see`, `@deprecated`. Don't add a `@param`/`@returns` tag that just repeats the type -- omit it or add meaningful prose.
* Keep claims in JSDoc **honest and verifiable** against the code. If a file still imports `vscode` for types, don't claim it "doesn't depend on vscode" -- qualify it (e.g. "no runtime/value-side dependency; the import is type-only and erased at compile time").
* When documenting an `@example`, make sure the example package / API actually matches the function's contract (e.g. don't show a class-based SDK as an example for a REST-style helper).
* Prefer a single concise summary line, followed by a blank line and more detail if needed. Wrap long paragraphs at a reasonable width for readability in hover tooltips.
* Don't duplicate the copyright header as JSDoc; the file header comment is separate from symbol-level documentation.


## How to Lint, Build, and Test

* Before submitting PRs, always lint, build, and test locally to catch errors early
* Run `pnpm run lint` to check for linting errors
* Run `pnpm run build` to compile TypeScript to JavaScript
* Run `pnpm run test` to execute tests
* Run `pnpm run testcov` to run tests with code coverage (via c8)
* For individual workspaces, use the above commands with a `--filter <package-name>` flag (e.g. `pnpm --filter @microsoft/vscode-azure-utils run test`) to target a specific package
* **Scope validation to the workspace you changed.** A change confined to `packages/utils` does not need the extension's test suite (which launches VS Code) or the other packages' lints. Run the full `pnpm run lint`/`build`/`test` sweep once before submitting, not after every edit.
* `lint` passes `--cache`, so repeat runs are much cheaper. There is a fixed per-invocation floor regardless, so prefer one lint of the changed workspace over several single-file lints.
* Only the **builds** have dedicated watch scripts (`build:watch` for `utils`/`azutils`, `build:check:watch` and `build:esbuild:watch` for the extension). There is no lint watch, and bare `mocha --watch` does nothing useful in this repo because Mocha only watches `.js`/`.cjs`/`.mjs` by default while the specs are `.ts` — pass `--extension ts` if you want a test watch.
* The extension has no test watch and no useful test filtering — most of its runtime is the VS Code launch, not the tests, so `--grep` saves very little.
* In a fresh clone or worktree, the extension's first test run downloads ~1 GB of VS Code into `extensions/vscode-azure/.vscode-test`. Run `pnpm run link-test-cache` once beforehand to share that download across worktrees; linked worktrees share one VS Code profile, so don't run their tests concurrently.


## Managing Dependencies

* This is a pnpm workspace; its configuration lives in `pnpm-workspace.yaml`.
* When a dependency is used by more than one workspace package, add it to the pnpm `catalog:` in `pnpm-workspace.yaml` and reference it from each `package.json` with the `"catalog:"` specifier. This keeps every package on a single, consistent version.
* Keep dependencies that are only used by a single package as a direct version specifier in that package's `package.json` -- don't add them to the catalog, since a catalog entry provides no dedup benefit for a single consumer.
* After changing any dependency versions or catalog entries, run `pnpm install` to update `pnpm-lock.yaml`, then build to confirm nothing broke.


## Writing Tests

* **Prefer existing test helpers over hand-rolling.** Before writing any fixture, mock, or drain/collect loop, look for an existing helper in the two testing barrels (`@microsoft/vscode-azure-utils/testing` and `@microsoft/vscode-azure-azutils/testing`) and use it. Duplicating or re-authoring near-identical fixtures is the single most common test smell in this repo -- search first, then reuse.
* **Entity fixtures (azutils)** -- build mock Azure resources with the shared `make*` factories instead of object literals: `makeAccount`, `makeTenant`, `makeSubscription`, `makeResourceGroup`, `makeGenericResource`, `makeVirtualGroup`, `makeVirtualResource`, and `makeCredential` (all from `@microsoft/vscode-azure-azutils/testing`, defined in `src/test/mockAzure.ts`). Each takes a `Partial<...>` overrides argument -- pass only the fields your test cares about.
* **Tree / provider fixtures (azutils)** -- don't hand-roll a `getChildren`/`hasMore`/`loadMore` object. Use `createMockDataItemTree`, `createMockHierarchicalDataItemTree`, `createMockPagedDataItemTree`, or `createMockViewItemTree` (from `src/test/tree/mockTree.ts`), and `createMockAccountDataProvider` / `createMockSubscriptionClient` for provider/client stand-ins.
* **Paging / async-iterable drains (utils)** -- use `collectPages` (drain a `ChildResult`/`getChildren` result into `Page[]`), `collectPageItems` (drain + flatten pages to items), or `collectAsync` (drain any `AsyncIterable`) from `@microsoft/vscode-azure-utils/testing`. Do not re-write the `for await (const page of ...) { ... }` loop inline.
* **When a helper doesn't exist yet:** if the same fixture/mock/loop pattern appears more than once, extract a single shared helper into the appropriate testing barrel rather than copying it -- entity/tree fixtures belong in azutils (`mockAzure.ts` / `mockTree.ts`), generic primitives (settings, async-iterable, action-context helpers) belong in utils. Export it from that package's `testing.ts` barrel. Extending an existing helper additively is preferred over adding a parallel near-duplicate.
* **Prefer Node's `mock` framework over hand-rolled mocking.** Use `mock.fn()` (optionally wrapping a real implementation, e.g. `mock.fn(createDefaultCredentialFactory(code))`) and `mock.method(obj, 'name', impl)` to stub and to record calls. Assert via `.mock.calls` / `.mock.callCount()` rather than manual counter variables, closures over an `inputs` array, or bespoke stub objects. Call `mock.restoreAll()` in `afterEach` when you patch with `mock.method`.
* Use `createMockCodeContext()` or `createMockVsCode()` from `@microsoft/vscode-azure-utils/testing` instead of hand-rolling `IVsCode`, `IExtensionContext`, or `ICodeContext` mocks. If the mock needs new capabilities, add them to `MockVsCode.ts` in the utils package.
* Use `withSettings(mockResult, overrides, callback)` from `@microsoft/vscode-azure-utils/testing` to seed configuration for the duration of a test (arrange side), instead of raw `mock.settings.set(...)`.
* Use real `ActionExecutor` (with `NullTelemetryReporter`) instead of mocking `IActionExecutor`
* Use real `createActionContext()` instead of mocking `IActionContext`
* Use `NullTelemetryReporter` from `@microsoft/vscode-azure-utils/testing` (not from the main entry point)
* Use `respondToPrompts()` from the testing package to drive wizard / pick-step UI flows
* In azutils, use the shared fixtures in `test/mockAzure.ts` and `test/mockPipeline.ts` instead of creating local mocks
* For Azure environments, use `Environment.AzureCloud` from `@azure/ms-rest-azure-env` instead of hand-rolled environment objects
* Don't test that constants equal their literal values — those tests add no value
* Testing Azure SDK clients: use `MockHttpClient` injected via the `options` parameter on the client's `create()` method

