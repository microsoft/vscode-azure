# Instructions for Copilot


## General Instructions

* Use single quotes instead of double quotes for strings
* Use only ASCII characters in source
* Use `import type` for type-only imports
* Use `import * as vscode` for the VS Code API (the only namespace import)
* Prefer named exports; avoid default exports
* Use the `I`-prefix for DI service identifier interfaces (e.g., `IActionContext`)
* Use the following interfaces in place of the built-in `vscode` types when possible:
  - `IVsCode` instead of `vscode`
  - `IExtensionContext` instead of `vscode.ExtensionContext`
  - `IOutputChannel` instead of `vscode.OutputChannel`
  - `EventEmitter` instead of `vscode.EventEmitter`
  - `Disposable` instead of `vscode.Disposable`
* Mark interface properties as `readonly` by default
* Use PascalCase for files containing classes/interfaces, camelCase for function-oriented files
* Label test cases with `(unit)` or `(integration)` in the root `describe` description
* Include the Microsoft copyright header on every TypeScript/JavaScript file
* Use `void` prefix for intentionally un-awaited promises
* Use scoped `eslint-disable` comments on specific lines, never file-wide
* Strings that will be seen by the user must use `vscode.l10n.t()` for localization (debug and trace output to the output channel is exempt from this requirement)


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
* For individual workspaces, use the above commands, adding `--workspace=<workspace-name>` to target a specific package
