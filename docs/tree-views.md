# Tree Views

The tree UI is split into two independent layers: a **data layer** and a **view layer**. Both use the same provider-dispatch pattern via `ProviderRegistry`.

## Data Layer

### `DataItemTree<T>`

The single source of truth for tree data. Lives in `packages/utils/src/tree/DataItemTree.ts`.

- **Lazy loading**: Children are fetched on first access via registered `DataProvider`s
- **Caching with TTL**: Results are cached and re-fetched once stale (default: 5 minutes, configured in `registerTrees.ts`)
- **Pagination**: Providers can return `AsyncIterable<Page<T>>` for paged results. The tree stores the iterator and pulls pages on demand via `loadMore()`/`loadAll()`
- **Enrichment**: After children load, the tree calls each provider's `enrich()` in the background, then fires `onDidChange` when done
- **Node map**: `NodeMap` provides O(1) key-based lookup and recursive subtree removal for cache eviction

Key methods:

| Method | Description |
|--------|-------------|
| `getChildren(resource?)` | Fetch and cache children (root if undefined) |
| `invalidate(resource, includeChildren?)` | Clear a resource's cached data (optionally invalidate children) |
| `invalidateAll()` | Clear the entire tree |
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
    readonly isRoot?: boolean;                                                 // Whether this provider returns root-level items
    readonly onDidChange?: Event<DataProviderChangeEvent<TResource>>;          // Provider-initiated change notifications
}
```

`ChildResult<T>` can be either `T[]` (simple array) or `AsyncIterable<Page<T>>` (paginated).

`DataProviderChangeEvent<T>` allows providers to push changes without going through invalidation:

```typescript
interface DataProviderChangeEvent<TResource> {
    readonly resource?: TResource;     // Undefined = root changed
    readonly includeChildren: boolean; // Whether to clear cached children too
}
```

`DataItemTree.registerProvider()` automatically subscribes to `onDidChange` if a provider exposes it. This is used by activity providers that need to push real-time status updates.

### Enrichment Pattern

Resources can be enriched with additional data lazily after loading:

1. `DataItemTree` loads children and returns them immediately
2. For each child, it finds a matching provider and calls `enrich()` in the background
3. `enrich()` mutates the resource in-place (same object reference)
4. When enrichment completes, `onDidChange` fires so the view re-renders
5. Commands that need enriched data call `await cache.whenEnriched<EnrichedType>(resource)`

**Important:** Enrichment must not change any properties that contribute to the resource's `AzureNodeId` key (e.g. `id`, `name`, `type`, `subscription`). The key is computed once when the resource is added to the `NodeMap`, and changing key-contributing properties would make the resource unreachable in the cache.

The `enrich()` return value controls child invalidation:
- Return `false` (or resolve to `false`) — only re-render the resource itself
- Return `true` (or resolve to `true`) — also clear the resource's cached children so they are re-fetched on next access

This is useful when enrichment discovers that the resource's children have changed (e.g. ARM deployment operations are fetched during enrichment of the deployment itself).

Example from `AcrDataProvider`:

```typescript
public async enrich(resource: ConcreteAzureNode): Promise<void> {
    // Fetch details via ARM API
    const registry = await getRegistries(client, resourceGroupName, resource.name);
    // Mutate in-place
    Object.assign(resource, { loginServer: registry.loginServer, sku: registry.sku });
}
```

## View Layer

### `ViewItemTree<TViewItem, TResource>`

Sits on top of a `DataItemTree` and implements VS Code's `TreeDataProvider`. Lives in `packages/utils/src/tree/ViewItemTree.ts`.

- Converts data-layer resources to view items via a `toViewItem` callback
- Tracks parent relationships internally so `getParent()` works for both real and virtual nodes
- Subscribes to `DataItemTree.onDidChange` and forwards as `onDidChangeTreeData`
- Automatically injects "Load More" nodes for paginated branches when configured

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

**Registration order matters** — specific providers must be registered before broader fallback providers:

```typescript
// In registerTrees.ts — AcrDataProvider before GenericAzureDataProvider
container.bind(IAzureViewDataProviders).to(AcrDataProvider);
container.bind(IAzureViewDataProviders).to(GenericAzureDataProvider); // fallback
```

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
| `CodeDeploymentDataProvider` | Yes | Tracks code deployments with nested child activities. |
| `GenericActivityDataProvider` | Yes | Tracks simple one-off activities (leaf nodes, no children). |

Activity providers are bound with `.toSelf().inSingletonScope()` first, then aliased with `.toService()` to the multi-binding identifier. This allows commands (e.g. `TrackArmDeployment`, `ClearActivities`) to inject specific providers directly while the tree still retrieves all providers collectively.

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
