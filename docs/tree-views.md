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
| `invalidate(resource)` | Clear a resource's cached children |
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
    enrich?(resource: TResource): void | Promise<void>;                        // Background enrichment (mutate in-place)
    readonly isRoot?: boolean;                                                 // Whether this provider returns root-level items
}
```

`ChildResult<T>` can be either `T[]` (simple array) or `AsyncIterable<Page<T>>` (paginated).

### Enrichment Pattern

Resources can be enriched with additional data lazily after loading:

1. `DataItemTree` loads children and returns them immediately
2. For each child, it finds a matching provider and calls `enrich()` in the background
3. `enrich()` mutates the resource in-place (same object reference)
4. When enrichment completes, `onDidChange` fires so the view re-renders
5. Commands that need enriched data call `await cache.whenEnriched<EnrichedType>(resource)`

**Important:** Enrichment must not change any properties that contribute to the resource's `AzureNodeId` key (e.g. `id`, `name`, `type`, `subscription`). The key is computed once when the resource is added to the `NodeMap`, and changing key-contributing properties would make the resource unreachable in the cache.

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
