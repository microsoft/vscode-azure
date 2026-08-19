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
| `invalidate(target)` | Mark matched nodes stale (re-fetched on next access) and fire `onDidChange`. See [Targets & selectors](#targets--selectors) |
| `remove(target)` | Evict matched nodes (and their subtrees) from the cache entirely, splicing them out of their parent. See [Targets & selectors](#targets--selectors) |
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

When a provider implements `getTtl`, `DataItemTree` uses its return value (in milliseconds) as the cache TTL for that resource's children instead of the tree-wide default; otherwise the default applies. It is consulted for both root (`getTtl()` with no argument) and branch (`getTtl(resource)`) loads. Returning `Infinity` makes the cached children never go stale — they only refresh on an explicit `invalidate` / `remove` or a provider `onDidChange`. The account/tenant/subscription data provider uses `Infinity` because account/tenant/subscription lists change only on auth or cloud-configuration events, which it signals via `onDidChange`.

#### Targets & selectors

`invalidate(target)` and `remove(target)` are the two entry points for cache mutation. Both accept the same `Target<T>` union (defined in `packages/utils/src/tree/Selector.ts`), so a single, broad surface covers every case:

| Target form | Meaning |
|-------------|---------|
| a bare resource `T` | matched by key, treated as `'subtree'` (the node and its descendants) |
| a `string` key | same, addressed by key |
| an array of resources/keys | each entry matched by key, `'subtree'` |
| `selfOnly(...resources/keys)` | matched by key, `'self'` — re-render the node's label only, keep its cached children |
| `subtreeOf(...resources/keys)` | matched by key, `'subtree'` — the explicit, named form of passing a bare resource |
| a `Selector<T>` — `(resource) => 'self' \| 'subtree' \| undefined` | a verdict predicate evaluated over every **loaded** node (e.g. `bySubscription(id)`) |
| `Roots` (sentinel) | reconciling root re-list: re-list the top level, preserve surviving roots' subtrees, evict departed roots. Use when the *set* of roots changed (sign-in/out, activity add/clear, workspace marker change) but the data under survivors is still valid |
| `Everything` (sentinel) | wipe the entire cache (all nodes, roots, enrichment promises) and fire a full refresh. Use only when a global precondition changed (e.g. sovereign cloud / page size) |

Key semantics:

- **`'self'` vs `'subtree'`** controls whether cached children are *evicted*. A `'subtree'` verdict wipes the matched node's whole cached subtree (re-fetched on next access) and stops descending — the apex absorbs everything beneath it. A `'self'` verdict keeps the cached children and keeps descending, so deeper nodes can still match independently.
- **Apex-only firing.** A selector walk fires `onDidChange` once per apex (a matched node with no matched ancestor), after the whole traversal completes. This keeps the event count minimal and is re-entrancy-safe. Prefer narrow targets (`Roots`, `bySubscription(id)`, a specific resource) over `Everything` so the view re-renders the smallest possible subtree.
- **`remove` vs `invalidate`.** `remove` evicts matched nodes and splices them out of their parent (firing the parent, or a single `undefined` full-refresh if any root was removed); `invalidate` keeps the node and re-fetches. `remove` does **not** accept the `Roots` / `Everything` sentinels — it throws.
- Pre-canned Azure selectors live in `packages/azutils/src/tree/azureSelectors.ts`: `byAccount(id)`, `bySubscription(id)`, `byResource(armId)`, `byType(type)` (all case-insensitive, all `'subtree'`). They key on fields populated from the listing, so they are safe to evaluate over partially-enriched nodes. Selectors run over **data-layer** resources only, never view-layer virtual grouping nodes.

`DataProviderChangeEvent<T>` lets providers push changes without holding a tree reference:

```typescript
interface DataProviderChangeEvent<TResource> {
    readonly target: Target<TResource>; // What changed (selector, resource, key, array, or a Roots / Everything sentinel)
    readonly remove?: boolean;          // When true, route to remove() instead of invalidate(); not valid for the sentinels
}
```

`DataItemTree.registerProvider()` automatically subscribes to `onDidChange` if a provider exposes it and routes each event's `target` to `invalidate` (or `remove` when `remove: true`). This is used by activity providers that push real-time status updates — e.g. a per-activity update fires `{ target: selfOnly(activity) }` (label only) or `{ target: activity }` (subtree), while adding or clearing root activities fires `{ target: Roots }`.

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

#### Capabilities attached by enrichment

Enrichment is also how a resource advertises a *capability* that is not derivable from its type alone. The website URL used by the Browse Website command works this way: the data provider that owns a resource attaches it via `setWebsiteUrl()` (in `src/tree/resources/websiteUrl.ts`), and view providers add the corresponding context value when `getWebsiteUrl()` returns a value.

A module-private symbol is used as the property key so the capability can never collide with an ARM property, and so it can be detected exactly instead of by re-checking the resource type. Making any new resource type browsable therefore requires no change to the command or to the generic view provider — only that its data provider call `setWebsiteUrl()` during `enrich()`. A resource type with a dedicated view provider must add the context value itself (via the shared `resourceContextValue()` helper in `src/tree/contextValueHelpers.ts`); everything else is covered by `GenericAzureViewProvider`.

Because the context value is derived from enriched state, a node rendered before enrichment lands simply lacks it; the `onDidChange` fired at step 4 re-renders the node with the capability present. `setWebsiteUrl()` also *clears* a previously attached URL when the resource stops reporting one, so a node cannot keep advertising a website that no longer resolves.

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

**Registration order matters** — specific providers must be registered before broader fallback providers. All resource providers, including the generic Azure root and fallback providers, are collected by `ProductRegistrar` in registration order:

```typescript
// Product registrations run in this order.
registerSettings(registrar);     // settings virtual nodes only, so it goes first
registerAcr(registrar);
registerFunctions(registrar);
registerGenericAzure(registrar); // root and fallback providers last
```

Each entry is a `ProviderEntry<T>`: either a bare class (bound directly to the collection identifier) or a `[primaryId, Class]` tuple (bound as a singleton under `primaryId` and aliased into the collection, so commands can `@inject(primaryId)` directly. See [Dependency Injection — Multi-Binding](dependency-injection.md#multi-binding-for-providers) for details.

Products add both sides of their resource presentation from their single entry
point with `registerResourceDataProvider()` and
`registerResourceViewProvider()`. The generic Azure registration is deliberately
last so its providers remain fallbacks.

### Composing children instead of competing for a resource

Because dispatch stops at the first match, **only one provider can serve a given resource**. Two providers that both want to contribute children to the same resource cannot both `canHandle` it.

The settings framework shows the resolution: `SettingsDataProvider` claims only the *virtual* settings nodes, never the owning resource. The product-specific provider injects its concrete adapter and calls the pure `getSettingsNodes(resource, adapter)` helper to compose those nodes into its own children.

The consequence to remember: **a product `DataProvider` that claims a resource takes it away from the generic provider** and owns all of that resource's children. Settings are an explicit capability of that provider rather than a second provider aggregated at runtime. See [Settings](settings.md).

## Azure Resources Tree Providers

The Azure resources tree composes three data providers. They split responsibility so each level can have its own caching and refresh semantics:

| Provider | Root? | Handles | TTL | Refresh trigger |
|----------|-------|---------|-----|-----------------|
| `AzureAccountDataProvider` (extension) | Yes | Accounts, tenants, subscriptions | `Infinity` | `onDidChange` on VS Code auth-session change (for the `microsoft` / `microsoft-sovereign-cloud` providers) and on `microsoft-sovereign-cloud`, `vscode-azure.signedInTenants`, or `vscode-azure.selectedSubscriptions` configuration change |
| `AcrDataProvider` | No | Service-specific resources and their virtual children | default | default TTL |
| `SettingsDataProvider` | No | Settings virtual-node leaves created by product providers | default | default TTL |
| `WebAppDataProvider` | No | Function App, App Service, and Logic App resources; composes their settings nodes | default | default TTL |
| `AzureResourceDataProvider` | No | Resource groups (under a subscription), and generic resources as the leaf fallback | default | default TTL |

`AzureAccountDataProvider` owns none of the listing itself. It is a thin adapter over the **Azure listing layer** in azutils (`packages/azutils/src/auth/listing/`), passing the extension's subscription filter on every read. Because it returns `Infinity` from `getTtl`, its results never go stale on their own — it fires `onDidChange` instead when auth, the sovereign-cloud setting, the manual-tenant setting, or the filter changes.

### The Azure listing layer (azutils)

Three pieces, deliberately named so a cached and an uncached thing can never be confused at an injection site:

| Piece | Verbs | Role |
|-------|-------|------|
| `AzureListingFetcher` | `fetchAccounts` / `fetchTenants` / `fetchSubscriptions` | **All** auth and ARM I/O, no caching. Reads signed-in accounts via the VS Code `authentication` API and tenants/subscriptions via `SubscriptionClient`, minting tokens through `ICredentialFactory`. Folds the manually-entered tenant ids from `vscode-azure.signedInTenants` into the tenant listing when conditional access blocks `tenants.list()` outright (the id doubles as a placeholder display name until a *silent* tenant-scoped token upgrades it). |
| `AzureListingStore` | `listing` / `cachedPages` / `evict` / `evictListing` / `clear` | The cache, **internal to the package**. One map from a *parent* key to that parent's `CachedPagedListing`. Keys are hierarchical and percent-encoded (`{accountId}`, `{accountId}/{tenantId}`) and compared case-insensitively, so eviction of a subtree is a prefix delete and an account id containing a `/` cannot masquerade as another account's descendant. A subscription reachable through two tenants is naturally an entry in each tenant's listing, with no special case. |
| `AzureListingCache` | `listAccounts` / `listTenants` / `listSubscriptions` / `walkSubscriptions` / `findSubscription` | The injected read surface (`IAzureListingCache`). One traversal that takes the tenant filter as a parameter. |

Only the fetcher and the cache are exported from the package barrel. The store holds unfiltered truth and knows nothing of the filter, so making it reachable from a consuming extension would put it one autocomplete entry away from the thing that *does* apply the filter -- and picking the wrong one silently defeats the guarantee that an excluded tenant is never requested. It stays private; `AzureListingCache` holds it as a private field.

Because the store holds *only* per-parent listings, there is no second index of nodes to keep in step and no way to reach a node except by descending through its ancestors. That is what makes the filter total rather than best-effort: a cached subscription in an excluded tenant is unreachable by construction, not by a check someone remembered to write.

Each parent's children are a `CachedPagedListing`: pages are pulled from the underlying iterator only as far as a reader asks, a later reader resumes the same iterator rather than restarting, and concurrent pulls of the same listing are single-flighted. A pull that throws **poisons the instance** -- every reader of it fails, including one that had already advanced past earlier pages, and the store swaps in a fresh instance on the next read. A retry therefore starts from scratch and can never splice a later attempt's tail onto an earlier attempt's head.

#### Worked example: a filtered read followed by an unfiltered one

An account with tenants A and B, and a filter admitting only A:

1. **The tree loads, filtered.** The accounts and tenants listings miss and are fetched; A *and* B are both cached, because caching happens below the filter. The filter then drops B on the way out, so the traversal never enters B's body and `fetchSubscriptions(B)` is never called -- no tenant-scoped token, no prompt. A's subscriptions are fetched and cached in full.
2. **`Select Subscriptions` runs, unfiltered.** The accounts, tenants, and A-subscriptions listings all hit and replay. Only `{account}/{B}` misses, because nobody ever asked for B's children.
3. **Exactly one new request.** Caching per *parent listing* rather than per query is what makes this a delta; caching "the result of the filtered walk" as one unit would make the unfiltered walk a total miss.

Changing the filter afterwards invalidates nothing at all -- every entry above is still true, and only the predicate changed.

### Subscription / tenant filtering

Two invariants govern the whole layer:

> The data tree is always filtered. No exceptions.
> The cache is unfiltered truth, and only filter-editing flows read it unfiltered.

The filter is extension-specific and stays in the extension: `createSubscriptionFilter(code)` in `src/utils/subscriptionFilter.ts` reads `vscode-azure.selectedSubscriptions` (an array of `tenantId/subscriptionId` strings, written by the `Azure: Select Subscriptions` command) and returns a `SelectedSubscriptionsFilter` with two predicates, or `undefined`. An empty list means "no filtering", **not** "admit nothing".

The two predicates are applied in different places, because they buy different things:

- **`admitsTenant`** is handed to the listing cache (as `AzureTenantFilter`) and applied as a **traversal-time skip** -- the traversal never enters an excluded tenant's body. That is what makes R1 a positive guarantee rather than an accident of lazy loading: an excluded tenant never has a tenant-scoped token minted, its subscriptions listed, or its display name enriched, which matters because minting that token can surface an interactive conditional-access prompt for a tenant the user deselected precisely to stop being nagged -- and even a silent request that *fails* costs tens of milliseconds.
- **`admitsSubscription`** is applied by `AzureAccountDataProvider` with `filterPages`, after the fact. By the time a subscription is in hand its tenant has already been listed and the token already minted, so skipping it saves nothing; it is purely about what the tree shows. Keeping it out of the cache keeps the cache's filter parameter to the one predicate that can actually prevent a request.

A consequence worth knowing: `findSubscription` is governed by `admitsTenant` only, so a deep link naming a *deselected* subscription in a *selected* tenant still resolves. That is deliberate -- resolving it costs nothing that was not already spent, and failing it would break deep links for no privacy or prompt benefit.

Everything fetched is cached regardless of why it was fetched, so a filtered read followed by an unfiltered read fetches only the delta. Filtering on *insert* is the trap: it would make the cached listing a filtered listing, and widening the filter would silently return the narrow answer.

`Azure: Select Subscriptions` and `Azure: Sign In` are the escape hatch — they read the same cache with no filter, because a command that edits the filter could otherwise only ever narrow it. Reachability failures during that walk are isolated per tenant and surfaced as a warning rather than aborting it.

`findSubscriptionById`-style resolution (deep links, deployments, azd) goes through `AzureListingCache.findSubscription`, which reads the cache directly rather than the tree, so resolution does not depend on what a view has loaded or how far a listing has paged. It runs in two phases: a **synchronous** descent through listings already in hand -- synchronous so that "this pass issues no request and mints no token" is enforced by the type system rather than by review -- and, only on a miss, the real async walk. Both phases descend through the same levels, so `admitsTenant` governs the lookup exactly as it governs the tree: a subscription in an excluded tenant does not resolve, the caller gets `undefined`, and the dependent feature degrades gracefully -- never an error, never a prompt. A bare subscription id can legitimately match more than one node, and the first in walk order wins; callers that care which pass a `tenantId`.

### Invalidation

Invalidate only what a change makes *untrue*:

| Change | Action | Why |
|--------|--------|-----|
| `microsoft-sovereign-cloud` setting | `cache.clear()` + `{ target: Everything }` | the endpoints themselves changed |
| `vscode-azure.signedInTenants` | `cache.clear()` + `{ target: Everything }` | manual tenants fold into tenant listings |
| `vscode-azure.selectedSubscriptions` (the filter) | `{ target: Everything }` only — **no cache eviction** | a filter change makes no cached listing untrue |
| Account signed out | `cache.clearAccount(id)` + `{ target: byAccount(id) }` | other accounts are unaffected |
| New account appears in a session change | `cache.refreshAccounts()` + `{ target: Roots }` | a new account does not falsify existing tenants |
| Interactive sign-in to a known account | `cache.refreshAccounts()` + `cache.clearAccount(id)` + `{ target: byAccount(id) }` | the sign-in can have authorized tenants that were invisible before, so what was listed under it is not merely stale but untrue |

Sign-out and post-sign-in are the same eviction -- everything under one account -- so they are the same verb. What distinguishes them is only what is invalidated in the tree afterwards.

Auth-session changes are noisy (they also fire on individual token acquisitions), so the provider reconciles: it asks `refreshAccounts()` for the current account set and does nothing when it is unchanged. That call must **bypass** the memoized accounts listing — a memoized `listAccounts()` could only ever answer "no change" — and it reseeds the memo, so the re-list that follows is free.

Reconciling calls `authentication.getAccounts()`, which itself raises `onDidChangeSessions`. `AzureAccountDataProvider` therefore ignores session events for a short window around its own reconcile; without it the reconcile would re-trigger itself forever. The window is deliberately narrow -- it covers only the provider's own echo, so an event provoked by anything else costs at most one reconcile that finds the account set unchanged and stops. The extension-facing `AuthenticationSessionsChangeEvent` carries only the provider id (no added/removed lists), so there is no way to tell an echo from a real change by inspecting the event.

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
| `AzdWorkspaceDataProvider` | Yes | Discovers azd projects from the shared workspace index (`IWorkspaceIndexService`), which tags every `azure.yaml`. Enumerates services via `IAzdService.show` (which shells out to `azd show --output json`). Caching is handled by the surrounding `DataItemTree` TTL. |
| `FunctionsWorkspaceDataProvider` | Yes | Detects Azure Functions projects from the shared workspace index (`IWorkspaceIndexService`), which tags every `host.json`. |
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
| `vscode-azure/workspace/refresh` | View title | `IWorkspaceViewDataTree.invalidate(Everything)` |
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

### Resource-type group presentation

Resource-type grouping keeps `GenericResource.logicalType` as the stable group
identity and node key. `GenericAzureViewProvider` owns the mapping from logical
types to localized group labels. It resolves group icons directly from the
logical type using the convention above. Unknown logical types retain their raw
type label and generic `symbol-namespace` icon.

To add group presentation for a supported service:

1. Ensure the resource has a stable logical type and matching icon file.
2. Add a case-insensitive branch to the resource-type label mapping in
   `GenericAzureViewProvider`. Localize the display name with `IVsCode.l10n.t()`.
3. Test the localized label, convention-based icon path, and generic fallback.

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
