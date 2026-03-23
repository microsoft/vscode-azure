# Instructions for Copilot

For detailed documentation on the project architecture and patterns, see the `docs/` folder:
* `docs/architecture.md` -- Package organization, dependency graph, activation flow
* `docs/tree-views.md` -- Data/view layer separation, providers, enrichment, caching, pagination, activity tree
* `docs/dependency-injection.md` -- Container setup, service identifiers, scoped execution, factory bindings
* `docs/commands.md` -- ManagedCommand pattern, registration, context values, prefixArgs
* `docs/conventions.md` -- Naming, imports, localization, ARM types, copyright headers
* `docs/wizard.md` -- PromptStep/ExecuteStep, back navigation, dynamic steps
* `docs/testing.md` -- Unit vs integration tests, mocking with `createMockVsCode()`, coverage
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
* Mark interface properties as `readonly` by default
* Use PascalCase for files containing classes/interfaces, camelCase for function-oriented files
* Label test cases with `(unit)` or `(integration)` **after** the name in the root `describe` description (e.g., `describe('AzureNodeId (unit)', ...)`)
* Include the Microsoft copyright header on every TypeScript/JavaScript file
* Use `void` prefix for intentionally un-awaited promises, unless they have a `.then()` with two arguments (for resolve and reject), or a `.catch()` handler
* Use scoped `eslint-disable` comments on specific lines, avoid file-wide unless it requires repeating the same disable many times
* Strings that will be seen by the user must use `IVsCode.l10n.t()` for localization (debug and trace output to the output channel is exempt from this requirement)
* Any time ARM resource types (`GenericResource.type`) or logical types (`GenericResource.logicalType`) are checked, they should be compared **case-insensitively** to a constant (e.g., `AcrResourceType`) rather than a string literal
* Commands that act on tree items should define a static `ContextValue` property. The view provider should use that in the tree item's `contextValue`. In `package.json`, the command's `when` clause should check for the context value with a regex (e.g., `viewItem =~ /\\bmyContextValue\\b/i`) rather than an equality check, to allow for multiple context values. The `\b` in the regex is important to prevent unintended matches (e.g., `myContextValue` matching `myContextValueWithSuffix`).


## Understanding the Data Model

The tree UI is split into two independent layers: a **data layer** and a **view layer**. Both layers live in `packages/utils/src/tree/` and use the same provider-dispatch pattern.

### Provider model

Both layers extend `ProviderRegistry`, which maintains an ordered list of providers. Each provider declares a `canHandle(resource)` type-guard; the registry dispatches to the first matching provider. Registration order matters -- more-specific providers must be registered before broader/fallback ones. Providers with `isRoot: true` are called with no argument to produce top-level (root) items.

### Data layer (`DataItemTree` + `DataProvider`)

* `DataItemTree<T>` is the single source of truth for data. It lazily loads children via registered `DataProvider<T>` implementations and caches them with a configurable TTL.
* Children are fetched on first access and re-fetched once stale (`staleAt` timestamp). Callers can force a refresh with `invalidate(resource)` or `invalidateAll()`.
* **Enrichment** -- after children are loaded, `DataItemTree` calls each provider's optional `enrich(resource)` method in the background. Enrichment mutates the resource in-place (keeping the same object reference) and fires `onDidChange` when done. Callers that need the enriched data can `await cache.whenEnriched(resource)`.
* A `NodeMap` provides O(1) key-based lookup and recursive subtree removal for cache eviction.

### View layer (`ViewItemTree` + `ViewProvider`)

* `ViewItemTree<TViewItem, TResource>` sits on top of a `DataItemTree` and implements VS Code's `TreeDataProvider`. It converts data-layer resources into view items via a `toViewItem` callback.
* Registered `ViewProvider`s control presentation: they may inject virtual nodes (groupings, headers, etc.), filter, reorder, or group children -- but may not modify the data layer.
* `ViewProvider` extends `DataProvider` but disallows `enrich` (`enrich?: never`). It adds a `getTreeItem(resource)` method that returns an `ITreeItem` for rendering.
* `ViewItemTree` tracks parent relationships internally so `getParent()` works for both real and virtual nodes.
* Changes in the data layer automatically propagate: `ViewItemTree` subscribes to `DataItemTree.onDidChange` and forwards the event as a view-level `onDidChangeTreeData` fire.

### Concrete Azure implementation

* `GenericAzureDataProvider` (extension layer) is a `DataProvider` that fetches Azure accounts, tenants, subscriptions, and resource groups via the Azure SDK.
* `GenericAzureViewProvider` (extension layer) is a `ViewProvider` that maps Azure resources to tree items with icons, context values, grouping strategies, etc.
* Service-specific providers (e.g. ACR) handle narrower resource types and are registered alongside the generic ones.


## How to Lint, Build, and Test

* Before submitting PRs, always lint, build, and test locally to catch errors early
* Run `npm run lint` to check for linting errors
* Run `npm run build` to compile TypeScript to JavaScript
* Run `npm run test` to execute tests
* Run `npm run testcov` to run tests with code coverage (via c8)
* For individual workspaces, use the above commands, adding `--workspace=<workspace-name>` to target a specific package


## Writing Tests

* Use `createMockCodeContext()` or `createMockVsCode()` from `@microsoft/vscode-azure-utils/testing` instead of hand-rolling `IVsCode`, `IExtensionContext`, or `ICodeContext` mocks. If the mock needs new capabilities, add them to `MockVsCode.ts` in the utils package.
* Use real `ActionExecutor` (with `NullTelemetryReporter`) instead of mocking `IActionExecutor`
* Use real `createActionContext()` instead of mocking `IActionContext`
* Use `NullTelemetryReporter` from `@microsoft/vscode-azure-utils/testing` (not from the main entry point)
* Use `mock.fn()` from `node:test` to track call counts and arguments — prefer over manual counters
* Use `respondToPrompts()` from the testing package to drive wizard / pick-step UI flows
* In azutils, use the shared fixtures in `src/test/mockAzure.ts` and `src/test/mockPipeline.ts` instead of creating local mocks
* For Azure environments, use `Environment.AzureCloud` from `@azure/ms-rest-azure-env` instead of hand-rolled environment objects
* Don't test that constants equal their literal values — those tests add no value
* Testing Azure SDK clients: use `MockHttpClient` injected via the `options` parameter on the client's `create()` method
