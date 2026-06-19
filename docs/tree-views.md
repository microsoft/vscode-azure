# Tree Views

The tree UI is split into two independent layers: a **data layer** and a **view layer**. Both use the same provider-dispatch pattern via `ProviderRegistry`.

## Data Layer

### `DataItemTree<T>`

The single source of truth for tree data. Lives in `packages/utils/src/tree/DataItemTree.ts`.

- **Lazy loading**: Children are fetched on first access via registered `DataProvider`s
- **Caching with TTL**: Results are cached and re-fetched once stale. The default TTL is configured in `registerTrees.ts` (5 minutes for the resources tree), but a provider may override it per-resource via `getTtl` (see below) — e.g. the account/tenant/subscription provider returns `Infinity`
- **Pagination**: Providers can return `AsyncIterable<Page<T>>` for paged results. The tree stores the iterator and pulls pages on demand via `loadMore()`/`loadAll()`
- **Enrichment**: After children load, the tree calls each provider's `enrich()` in the background, then fires `onDidChange` when done
- **Telemetry scoping**: Every `getChildren()`, `enrich()`, and page-load call is wrapped in `callWithTelemetryAndErrorHandling`, establishing an `IActionContext` on the async call stack via `AsyncLocalStorage`. Pipeline policies (e.g. `CorrelationIdPolicy`) pick up this context automatically without any changes to provider or client signatures. See [Telemetry](telemetry.md).
- **Node map**: `NodeMap` provides O(1) key-based lookup and recursive subtree removal for cache eviction

Key methods:

| Method | Description |
|--------|-------------|
| `getChildren(resource?)` | Fetch and cache children (root if undefined) |
| `invalidate(resource, includeChildren?)` | Clear a resource's cached data (optionally invalidate children) |
| `invalidateAll()` | Clear the entire tree |
| `invalidateRoot()` | Reconciling root re-list (preserve survivors' subtrees, evict departed roots) |
| `whenEnriched<T>(resource)` | Await background enrichment completion |
| `hasMore(resource)` | Whether more pages are available |
| `loadMore(resource)` | Pull the next page |
| `loadAll(resource)` | Pull all remaining pages |
| `get(key)` | O(1) lookup by key |

### `DataProvider<T>`

Interface for data fetching. Lives in `packages/utils/src/tree/DataProvider.ts`.

```typescript
interface DataProvider<TResource> {
    canHandle(resource: unknown): resource is TResource;                        // Type guard
    getChildren(resource?: TResource): ProviderResult<ChildResult<TResource>>; // Fetch children
    enrich?(resource: TResource): boolean | Promise<boolean>;                  // Background enrichment (mutate in-place); return true to invalidate children
    getTtl?(resource?: TResource): number;                                     // Per-resource cache TTL in ms (overrides DataItemTree default)
    readonly isRoot?: boolean;                                                 // Whether this provider returns root-level items
    readonly onDidChange?: Event<DataProviderChangeEvent<TResource>>;          // Provider-initiated change notifications
}
```

`ChildResult<T>` can be either `T[]` (simple array) or `AsyncIterable<Page<T>>` (paginated).

#### `getTtl`

When a provider implements `getTtl`, `DataItemTree` uses its return value (in milliseconds) as the cache TTL for that resource's children instead of the tree-wide default; otherwise the default applies. It is consulted for both root (`getTtl()` with no argument) and branch (`getTtl(resource)`) loads. Returning `Infinity` makes the cached children never go stale — they only refresh on explicit `invalidate`/`invalidateAll` or a provider `onDidChange`. The account/tenant/subscription data provider uses `Infinity` because account/tenant/subscription lists change only on auth or cloud-configuration events, which it signals via `onDidChange`.

`DataProviderChangeEvent<T>` allows providers to push changes without going through invalidation:

```typescript
interface DataProviderChangeEvent<TResource> {
    readonly resource?: TResource;     // Undefined = root changed
    readonly includeChildren: boolean; // Whether to clear cached children too
}
```

`DataItemTree.registerProvider()` automatically subscribes to `onDidChange` if a provider exposes it. This is used by activity providers that need to push real-time status updates. A root-level change (`resource` undefined) with `includeChildren: false` is interpreted as a **reconciling root re-list** (`invalidateRoot`) rather than a full wipe.

`AzureAccountDataProvider` returns `Infinity` from `getTtl`, so its account/tenant/subscription listings never go stale on their own. On an auth session change it fires `{ resource: undefined, includeChildren: false }` to trigger a reconciling root re-list — re-listing accounts while preserving tenant/subscription subtrees under surviving accounts, and evicting a signed-out account's subtree because it drops out of the new listing. (This event is noisy — it also fires on individual token acquisitions — but an unchanged account set reconciles to a no-op.) On a sovereign-cloud configuration change it fires a full `invalidateAll()` because the configured endpoint itself changed.

### Enrichment Pattern

Resources can be enriched with additional data lazily after loading:

1. `DataItemTree` loads children and returns them immediately
2. For each child, it finds a matching provider and calls `enrich()` in the background
3. `enrich()` mutates the resource in-place (same object reference)
4. When enrichment completes, `onDidChange` fires so the view re-renders
5. Commands that need enriched data call `await cache.whenEnriched<EnrichedType>(resource)`

**Important:** Enrichment must not change any properties that contribute to the resource's `AzureNodeId` key (for generic resources, effectively `id` plus subscription identity fields used by `AzureNodeId.from`, such as account id and tenant id). The key is computed once when the resource is added to the `NodeMap`, and changing key-contributing properties would make the resource unreachable in the cache.

The `enrich()` return value controls child invalidation:
- Return `false` (or resolve to `false`) — only re-render the resource itself
- Return `true` (or resolve to `true`) — also clear the resource's cached children so they are re-fetched on next access

This is useful when enrichment discovers that the resource's children have changed (e.g. ARM deployment operations are fetched during enrichment of the deployment itself).

Example from `AcrDataProvider`:

```typescript
public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
    // Fetch details via ARM API
    const registry = await client.registries.get(resourceGroupName, resource.name);
    // Mutate in-place
    Object.assign(resource, { loginServer: registry.loginServer, sku: registry.sku });
    return false;
}
```

## View Layer

### `ViewItemTree<TViewItem, TResource>`

Sits on top of a `DataItemTree` and implements VS Code's `TreeDataProvider`. Lives in `packages/utils/src/tree/ViewItemTree.ts`.

- Converts data-layer resources to view items via a `toViewItem` callback
- Tracks parent relationships internally so `getParent()` works for both real and virtual nodes
- Subscribes to `DataItemTree.onDidChange` and forwards as `onDidChangeTreeData`
- Automatically injects "Load More" nodes for paginated branches when configured
- **Telemetry scoping**: `getChildren()`, `getTreeItem()`, and `getParent()` are wrapped in `callWithTelemetryAndErrorHandling` with `suppress: 'onSuccess'` and `rethrow: true`, so only failures emit telemetry. This also establishes an `IActionContext` on the async stack for any downstream work.

### `ViewProvider<TViewItem>`

Extends `DataProvider` but **forbids `enrich`** (`enrich?: never`). Adds `getTreeItem()` for rendering. Lives in `packages/utils/src/tree/ViewProvider.ts`.

```typescript
interface ViewProvider<TViewItem> extends DataProvider<TViewItem> {
    enrich?: never;  // View providers must not modify data
    getTreeItem(resource: TViewItem): ITreeItem | Promise<ITreeItem>;
    getParent?(resource: TViewItem): ProviderResult<TViewItem>;
}
```

View providers control presentation without modifying the data layer. They may:
- Inject virtual nodes (groupings, headers)
- Filter, reorder, or group children
- Provide icons, labels, descriptions, tooltips, context values

## Provider Dispatch

Both layers extend `ProviderRegistry`, which maintains an ordered list of providers. `findProvider(resource)` returns the **first** provider whose `canHandle(resource)` returns `true`.

**Registration order matters** — specific providers must be registered before broader fallback providers. In `registerTrees.ts`, each tree is configured via a `TreeConfig` object whose `dataProviders` and `viewProviders` arrays are processed in order:

```typescript
// In registerTrees.ts — resources tree dataProviders, most specific first
dataProviders: [
    AcrDataProvider,
    [IFunctionAppDataProvider, FunctionAppDataProvider],   // singleton+alias tuple
    [IAzureAccountDataProvider, AzureAccountDataProvider], // accounts/tenants/subscriptions (root)
    AzureResourceDataProvider,                            // resource groups + resources (fallback)
],
```

Each entry is a `ProviderEntry<T>`: either a bare class (bound directly to the collection identifier) or a `[primaryId, Class]` tuple (bound as a singleton under `primaryId` and aliased into the collection, so commands can `@inject(primaryId)` directly. See [Dependency Injection — Multi-Binding](dependency-injection.md#multi-binding-for-providers) for details.

## Azure Resources Tree Providers

The Azure resources tree composes three data providers. They split responsibility so each level can have its own caching and refresh semantics:

| Provider | Root? | Handles | TTL | Refresh trigger |
|----------|-------|---------|-----|-----------------|
| `AzureAccountDataProvider` (extension) | Yes | Accounts, tenants, subscriptions | `Infinity` | `onDidChange` on VS Code auth-session change (for the `microsoft` / `microsoft-sovereign-cloud` providers) and on `microsoft-sovereign-cloud` configuration change |
| `AcrDataProvider` / `FunctionAppDataProvider` | No | Service-specific resources and their virtual children | default | default TTL |
| `AzureResourceDataProvider` | No | Resource groups (under a subscription) and generic resources (under a resource group) | default | default TTL |

`AzureAccountDataProvider` lazily signs in by requesting a token from the credential-factory DI service (`ICredentialFactory`, which defaults to `VsCodeExtensionCredential`). The credential defaults to `createIfNone`, so the first token request prompts interactive sign-in when no session exists. It then lists accounts → tenants → subscriptions itself, reading signed-in accounts via the VS Code `authentication` API and tenants/subscriptions via `SubscriptionClient`. Because it returns `Infinity` from `getTtl`, its results never go stale on their own — it fires `onDidChange` instead when auth or the sovereign-cloud setting changes. An auth session change fires a reconciling root re-list (`{ resource: undefined, includeChildren: false }`) that re-lists accounts while preserving tenant/subscription caches under surviving accounts; a sovereign-cloud configuration change fires a full `invalidateAll()` since the endpoint itself changed.

### Subscription / tenant filtering

Tenant and subscription filtering is a **view-layer** concern, implemented in `GenericAzureViewProvider.applyFilter`. It reads `azureResourceGroups.selectedSubscriptions` (an array of `tenantId/subscriptionId` strings, the same setting `vscode-azext-azureauth` used). When the list is empty, no filtering applies. Otherwise, tenant nodes survive only when their `tenantId` is in the filter, and subscription nodes only when their `subscriptionId` is. Other node types pass through.

Because the tree loads lazily, a filtered-out tenant is never expanded, so its subscriptions are never requested from Azure. The data layer may still cache subscriptions that don't pass the filter when they arrive in the *same* response as ones that do (e.g. two subscriptions in one tenant) — that's acceptable since it costs no extra request. The view provider fires `onDidChange` when the filter setting changes so the tree re-renders.

## Workspace (Local) Tree

A tree view in the same container as the resources tree shows
items that live "locally" rather than in Azure. It uses the same
`DataItemTree` / `ViewItemTree` infrastructure as the resources tree
but with a short 60-second TTL so newly-added marker files
(`azure.yaml`, `host.json`, ...) are picked up quickly.

### Workspace Node Model

All workspace items implement a small, common interface and are
discriminated by `type`:

```typescript
interface WorkspaceNode {
    readonly id: string;       // stable key, also used as VS Code TreeItem.id
    readonly type: WorkspaceNodeType;
    readonly label: string;
    readonly resourceUri?: vscode.Uri; // file/folder on disk, drives "Reveal in Explorer"
}
type WorkspaceNodeType =
    | 'azdProject' | 'azdService'
    | 'functionsProject'
    | 'emulatorsGroup' | 'emulator';
```

Each domain (azd, functions, emulators) owns its own concrete variant
plus a matching pair of providers. There is **no shared mega-provider**
— providers stay narrow so adding a new domain only adds new files.

### Workspace Data Providers

| Provider | Root? | Description |
|----------|-------|-------------|
| `AzdWorkspaceDataProvider` | Yes | Discovers azd projects via a single `IAzdService.findAzureYaml` call across the workspace, mapping results to their containing workspace folders. Enumerates services via `IAzdService.show` (which shells out to `azd show --output json`). Caching is handled by the surrounding `DataItemTree` TTL. |
| `FunctionsWorkspaceDataProvider` | Yes | Detects an Azure Functions project from a top-level `host.json`. |
| `EmulatorsWorkspaceDataProvider` | Yes | Surfaces a fixed "Emulators" group with stubbed entries for Azurite and Functions Core Tools. |

All three are `isRoot: true`, so they each contribute their detected
items to the root in registration order (azd, functions, emulators).
Non-root dispatch goes through the standard `canHandle` mechanism —
each provider's guard accepts only its own variants.

### Workspace View Providers

| Provider | Key prefix | Description |
|----------|-----------|-------------|
| `AzdWorkspaceViewProvider` | `azwr://azdProject/`, `azwr://azdService/` | azd icon for projects, package icon for services. |
| `FunctionsWorkspaceViewProvider` | `azwr://functionsProject/` | Function App resource-type icon. |
| `EmulatorsWorkspaceViewProvider` | `azwr://emulatorsGroup`, `azwr://emulator/` | Server-environment icon for the group, debug-disconnect for entries. |

View providers dispatch by key prefix or exact id (the data-layer ids embed the
discriminator), keeping their `canHandle` checks self-contained.

### Workspace Commands

| Command | Context value | Behaviour |
|---------|---------------|-----------|
| `vscode-azure/workspace/refresh` | View title | `IWorkspaceViewDataTree.invalidateAll()` |
| `vscode-azure/workspace/revealInExplorer` | `revealInExplorer` (any node with `resourceUri`) | Forwards to VS Code's built-in `revealInExplorer` command. |

## Activity Tree

A second tree view tracks long-running operations (ARM deployments, code deployments, generic activities). It uses the same `DataItemTree` / `ViewItemTree` infrastructure as the resources tree but with `Infinity` TTL — providers manage freshness via polling and the `onDidChange` event.

### Activity Model

Activities implement a common interface:

```typescript
interface Activity {
    readonly id: string;
    readonly type: ActivityType;     // 'armDeployment' | 'armDeploymentOperation' | 'codeDeployment' | 'generic'
    readonly status: ActivityStatus; // 'NotStarted' | 'InProgress' | 'Canceled' | 'Completed' | 'Failed'
    readonly title: string;
    readonly description?: string;
    readonly startTime: number;
    readonly endTime?: number;
}
```

### Activity Data Providers

| Provider | Root? | Description |
|----------|-------|-------------|
| `ArmDeploymentDataProvider` | Yes | Tracks ARM deployments. Polls for status and fetches deployment operations during enrichment. |
| `CodeDeploymentDataProvider` | Yes | Tracks code deployments (e.g. `azd deploy`). `trackDeployment()` returns a `CodeDeploymentHandle` for controlling lifecycle and adding children. The handle exposes `complete(status, error?)` and `addChild(title, status?)` — the provider owns all mutations and fires change events internally. |
| `GenericActivityDataProvider` | Yes | Tracks simple one-off activities (leaf nodes, no children). |

Activity providers are registered as `[primaryId, Class]` tuples in the `dataProviders` array, which binds each as a singleton under its own identifier and aliases it into the collection. This allows commands (e.g. `ClearActivities`) to inject specific providers directly while the tree still retrieves all providers collectively:

```typescript
dataProviders: [
    [IArmDeploymentDataProvider, ArmDeploymentDataProvider],
    [ICodeDeploymentDataProvider, CodeDeploymentDataProvider],
    [IGenericActivityDataProvider, GenericActivityDataProvider],
],
```

### Activity View Providers

| Provider | Description |
|----------|-------------|
| `ArmDeploymentViewProvider` | Handles ARM deployment and operation nodes with nested children. |
| `ActivityViewProvider` | Fallback: handles all other activity types. Renders status icons (loading/pass/error/circle-slash). |

## Load More / Pagination

When a `DataProvider` returns `AsyncIterable<Page<T>>`, the tree supports incremental loading:

1. First `getChildren()` call pulls the first page and stores the iterator
2. `ViewItemTree` appends a synthetic "Load More" node if `hasMore()` is true
3. Clicking "Load More" calls `viewItemTree.loadMore()`, which triggers the data layer to pull the next page
4. The view re-renders automatically via the change event chain

The `LoadMore` command handles this interaction, and `LoadMoreOptions` configures the appearance of the synthetic node.

## Resource Icons

Tree items for Azure resources display product-specific SVG icons. The icon for a given resource is resolved at runtime by `getResourceTypeIconUri()` in `extensions/vscode-azure/src/tree/iconPath.ts`, which builds a file URI from the resource's **logical type** (or ARM type for non-resource nodes like subscriptions and resource groups).

### Convention

The icon file path is derived mechanically from the type string:

```
<logicalType>.toLowerCase() + '.svg'
```

The `/` in the type becomes a directory separator, and `~` separates kind suffixes. For example:

| Type / Logical Type | Icon path |
|----------------------|-----------|
| `Microsoft.Web/sites~functionapp` | `microsoft.web/sites~functionapp.svg` |
| `Microsoft.ContainerRegistry/registries` | `microsoft.containerregistry/registries.svg` |
| `Microsoft.Resources/subscriptions` | `microsoft.resources/subscriptions.svg` |
| `Microsoft.DocumentDB/databaseAccounts~cosmosdb` | `microsoft.documentdb/databaseaccounts~cosmosdb.svg` |

**This naming convention is load-bearing.** If the icon filename does not match the lowercased logical type, the icon silently fails to load and VS Code shows no icon for that tree item.

### Source location

Icon SVGs live in `packages/azutils/resources/azureIcons/`, organized into subfolders by provider namespace (e.g. `microsoft.web/`, `microsoft.containerregistry/`). The esbuild copy plugin copies them into `dist/azureIcons/` at build time, so they are bundled with the extension.

### Logical types

Most resources use their raw ARM `type` as the icon key. However, some ARM types cover multiple visually-distinct products (e.g. `Microsoft.Web/sites` includes both Function Apps and App Services). For these, `logicalType()` in `ResourceClient.ts` appends a `~<kind>` suffix based on the resource's `kind` field. The full set of logical type constants is exported from `@microsoft/vscode-azure-azutils`:

| Constant | Value | Disambiguates |
|----------|-------|---------------|
| `FunctionAppLogicalType` | `Microsoft.Web/sites~functionapp` | Function Apps |
| `LogicAppLogicalType` | `Microsoft.Web/sites~workflowapp` | Logic Apps (Standard) |
| `AppServiceLogicalType` | `Microsoft.Web/sites~app` | App Service web apps |
| `AIServicesLogicalType` | `Microsoft.CognitiveServices/accounts~aiservices` | AI Foundry |
| `CosmosDBMongoLogicalType` | `Microsoft.DocumentDB/databaseAccounts~mongodb` | Cosmos DB for MongoDB |
| `CosmosDBLogicalType` | `Microsoft.DocumentDB/databaseAccounts~cosmosdb` | Cosmos DB (non-MongoDB) |
| `AIFoundryProjectLogicalType` | `Microsoft.MachineLearningServices/workspaces~project` | AI Foundry projects |
| `DurableTaskHubLogicalType` | `Microsoft.DurableTask/schedulers/taskHubs` | Durable Task Hubs |

### Adding a new icon

1. Drop an SVG file into the matching subfolder of `packages/azutils/resources/azureIcons/`. The filename **must** be `<logicalType>.toLowerCase() + '.svg'`.
2. If the ARM type needs kind-based disambiguation, add a logical type constant and a branch to `logicalType()` in `ResourceClient.ts`.
3. No view provider changes are needed — `GenericAzureViewProvider` already passes `resource.logicalType` to `getResourceTypeIconUri()`.

## Putting It Together

```
┌──────────────────────────────────────────────────┐
│  VS Code TreeView                                │
│    ↕ getChildren / getTreeItem / getParent       │
│  ViewItemTree                                    │
│    ↕ delegates to ViewProviders                  │
│  ViewProvider (AcrViewProvider, GenericAzure...) │
│    ↕ reads from                                  │
│  DataItemTree (cache + enrichment + pagination)  │
│    ↕ delegates to DataProviders                  │
│  DataProvider (AcrDataProvider, GenericAzure...) │
│    ↕ fetches from                                │
│  Azure SDK / REST APIs                           │
└──────────────────────────────────────────────────┘
```
