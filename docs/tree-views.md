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

The shape of an `enrich()` implementation is always the same: fetch the detail
the listing did not include, copy it onto the *existing* object, and report
whether children are affected.

```typescript
public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
    const details = await client.registries.get(resourceGroupName, resource.name);
    Object.assign(resource, { loginServer: details.loginServer }); // never replace the object
    return false;                                                  // label-only re-render
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

### `ViewProvider<TResource>`

Extends `DataProvider` but **forbids both `enrich` and `getTtl`** (`enrich?: never`, `getTtl?: never`) — caching and mutation are data-layer concerns. It narrows `getChildren()` to return a plain array (never a paginated `AsyncIterable`) and adds `getTreeItem()` for rendering, plus an optional `getParent()` that enables `TreeView.reveal()` for nodes that have not been loaded yet. See [ViewProvider.ts](../packages/utils/src/tree/ViewProvider.ts) for the full interface.

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
| `AzureAccountDataProvider` (extension) | Yes | Accounts, tenants, subscriptions | `Infinity` | `onDidChange` on VS Code auth-session change (for the `microsoft` / `microsoft-sovereign-cloud` providers) and on `microsoft-sovereign-cloud`, `vscode-azure.signedInTenants`, or `vscode-azure.selectedSubscriptions` configuration change. Since nothing goes stale on its own, `Azure: Refresh` is the only thing that re-lists |
| `AcrDataProvider` | No | Service-specific resources and their virtual children | default | default TTL |
| `SettingsDataProvider` | No | Settings virtual-node leaves created by product providers | default | default TTL |
| `WebAppDataProvider` | No | Function App, App Service, and Logic App resources; composes their settings nodes | default | default TTL |
| `AzureResourceDataProvider` | No | Resource groups (under a subscription), and generic resources as the leaf fallback | default | default TTL |

`AzureAccountDataProvider` owns none of the listing itself. It is a thin adapter over the **Azure listing layer** in azutils (`packages/azutils/src/auth/listing/`), passing the extension's subscription filter on every read. Because it returns `Infinity` from `getTtl`, its results never go stale on their own — it fires `onDidChange` instead when auth, the sovereign-cloud setting, the manual-tenant setting, or the filter changes.

### The Azure listing layer (azutils)

Three pieces, deliberately named so a cached and an uncached thing can never be confused at an injection site:

| Piece | Verbs | Role |
|-------|-------|------|
| `AzureListingFetcher` | `fetchAccounts` / `fetchTenants` / `fetchSubscriptions` | **All** auth and ARM I/O, no caching. Reads signed-in accounts via the VS Code `authentication` API and tenants/subscriptions via `SubscriptionClient`, minting tokens through `ICredentialFactory`. Acquires the tenant token *before* listing subscriptions and raises `NotSignedInError` when there is none, rather than letting the request go out unauthenticated and surface a 401 that reads like a real fault. That probe is pinned `silent`, so it can only ever answer "is there already a session" — a caller that forgot to establish a silent scope gets `NotSignedInError` rather than an interactive prompt raised by an enumeration it did not ask to be interactive; the subscription listing itself uses an unpinned credential and so prompts exactly as the caller intended. `fetchTenants` is pinned `silent` throughout, since enumerating an account is never something the user asked to be interactive. A failure **propagates**; degrading here is what the layer above is for. |
| `AzureListingStore` | `accounts` / `cachedAccounts` / `evictAccounts` / `listing` / `evictListing` / `clear` | The cache, **internal to the package**. The accounts are held apart from the keyed listings because they are not one: they arrive unpaged from a local `getAccounts()` call, and alone among the cached sets they are read against the *ambient* configured cloud rather than against a node that already knows which cloud it came from, so there is no environment to lead a key with. Everything below them is one map from a *parent* key to that parent's `CachedPagedListing`. Keys are hierarchical and percent-encoded (`{env}/{accountId}`, `{env}/{accountId}/{tenantId}`) and compared case-insensitively, so an account id containing a `/` cannot masquerade as another account's descendant, and listings taken against two clouds coexist instead of colliding. A subscription reachable through two tenants is naturally an entry in each tenant's listing, with no special case. There is no prefix delete: nothing evicts a subtree, so the operation does not exist. |
| `AzureListingCache` | `listAccounts` / `listTenants` / `listSubscriptions` / `walkSubscriptions` / `walkCachedSubscriptions` / `reenumerate*` / `clear` | The injected read surface (`IAzureListingCache`). Two ways in over one cache: `listTenants`/`listSubscriptions` for a consumer that shows a filtered view (the filter is a parameter of `listTenants` alone), and `walkSubscriptions` — unfiltered by construction — for the flows that *edit* the filter or need a subscription the filter may exclude. `walkCachedSubscriptions` is the synchronous peek at what has already been paid for, so a lookup can answer without a request. Also the merge point for the manually-named tenants from `vscode-azure.signedInTenants` — merged on *read*, over whatever the account listed, so adding or removing one re-fetches nothing. A named tenant carries its id as a placeholder display name until a *silent* tenant-scoped token upgrades it. |

Only the fetcher and the cache are exported from the package barrel. The store holds unfiltered truth and knows nothing of the filter, so making it reachable from a consuming extension would put it one autocomplete entry away from the thing that *does* apply the filter -- and picking the wrong one silently defeats the guarantee that an excluded tenant is never requested. It stays private; `AzureListingCache` holds it as a private field.

Because the store holds *only* per-parent listings, there is no second index of nodes to keep in step and no way to reach a node except by descending through its ancestors. That is what makes the filter total rather than best-effort: a cached subscription in an excluded tenant is unreachable by construction, not by a check someone remembered to write.

Each parent's children are a `CachedPagedListing`: pages are pulled from the underlying iterator only as far as a reader asks, a later reader resumes the same iterator rather than restarting, and concurrent pulls of the same listing are single-flighted. A pull that throws **poisons the instance** -- every reader of it fails, including one that had already advanced past earlier pages, and the store swaps in a fresh instance on the next read. A retry therefore starts from scratch and can never splice a later attempt's tail onto an earlier attempt's head.

That poisoning is why a failed tenant listing must throw rather than degrade to an empty one. A yielded empty page is indistinguishable from an account that genuinely has no tenants: the listing would be recorded as *complete*, `hasFailed` would stay false, and every later read would replay it. Since no eviction verb targets an account's tenant listing -- `reenumerateSubscriptions` builds a tenant-scoped key and `reenumerateAccounts` deliberately keeps everything below the accounts -- a single network blip during the first expand would blank that account until an explicit `Azure: Refresh`, with nothing to tell the user that a refresh is what they need.

Degrading is therefore `AzureListingCache`'s job, one level up, where it can be done without lying to the cache. `listedTenants` catches the failure, reports it through `onFailure`, and ends the stream, which lets `withAdditionalTenants` still emit its terminal page -- so an account whose enumeration conditional access blocks outright keeps exactly the manually-named tenants that are the fallback for it. The listing underneath stays poisoned, so the next read retries. That retry cannot prompt, because `fetchTenants` is pinned silent.

#### Worked example: a filtered read followed by an unfiltered one

An account with tenants A and B, and a filter admitting only A:

1. **The tree loads, filtered.** The accounts and tenants listings miss and are fetched; A *and* B are both cached, because caching happens below the filter. `listTenants` then drops B on the way out, so B is never handed to the code that would drill it and `fetchSubscriptions(B)` is never called -- no tenant-scoped token, no prompt. A's subscriptions are fetched and cached in full.
2. **`Select Subscriptions` runs, unfiltered.** It walks the same cache. The accounts, tenants, and A-subscriptions listings all hit and replay. Only `{account}/{B}` misses, because nobody ever asked for B's children.
3. **Exactly one new request.** Caching per *parent listing* rather than per query is what makes this a delta; caching "the result of the filtered read" as one unit would make the unfiltered walk a total miss.

Changing the filter afterwards invalidates nothing at all -- every entry above is still true, and only the predicate changed. Nor does naming or un-naming a tenant, for the same reason: both are applied on read.

### Subscription / tenant filtering

Two invariants govern the whole layer:

> The data tree is always filtered. No exceptions.
> The cache is unfiltered truth, and only filter-editing flows read it unfiltered.

The filter is extension-specific and stays in the extension: `createSubscriptionFilter(code)` in `src/utils/subscriptionFilter.ts` reads `vscode-azure.selectedSubscriptions` (an array of `tenantId/subscriptionId` strings, written by the `Azure: Select Subscriptions` command) and returns a `SelectedSubscriptionsFilter` with two predicates, or `undefined`. An empty list means "no filtering", **not** "admit nothing".

The two predicates are applied in different places, because they buy different things:

- **`admitsTenant`** is handed to `listTenants` (as `AzureTenantFilter`) and applied as a **traversal-time skip** -- an excluded tenant is dropped before it can be returned to a caller that would drill it. That is what makes the guarantee positive rather than an accident of lazy loading: an excluded tenant never has a tenant-scoped token minted, its subscriptions listed, or its display name enriched, which matters because minting that token can surface an interactive conditional-access prompt for a tenant the user deselected precisely to stop being nagged -- and even a silent request that *fails* costs tens of milliseconds.
- **`admitsSubscription`** is applied by `AzureAccountDataProvider` with `filterPages`, after the fact. By the time a subscription is in hand its tenant has already been listed and the token already minted, so skipping it saves nothing; it is purely about what the tree shows. Keeping it out of the cache keeps the cache's filter parameter to the one predicate that can actually prevent a request.

Everything fetched is cached regardless of why it was fetched, so a filtered read followed by an unfiltered read fetches only the delta. Filtering on *insert* is the trap: it would make the cached listing a filtered listing, and widening the filter would silently return the narrow answer.

`Azure: Select Subscriptions` and `Azure: Sign In` are the escape hatch — they read the same cache with no filter, because a command that edits the filter could otherwise only ever narrow it. Reachability failures during that walk are isolated per tenant and surfaced rather than aborting it, and they are **classified**: a tenant that simply has no session raises `NotSignedInError` and is reported as "sign in to reach these", while anything else is reported as a fault. The distinction matters because the first case is the norm — an account with access to many tenants has usually signed in to a few — and warning about it every time would train the user to ignore the warning.

Because that walk is going to drain every tenant anyway, it passes `concurrency` to `walkSubscriptions`, which lists that many tenants at once while yielding in exactly the sequential order. Walks default to `concurrency: 1` and both current consumers raise it to `DiscoveryConcurrency`. A window of `n` keeps up to `n - 1` tenants in flight *past* the one being read, so even a consumer that stops early lists tenants it never consumes — but those listings are cached rather than discarded, so the residual cost is a conditional-access step-up on a tenant whose session needs one, not a wasted request. The tree never uses the walk at all — it descends `listTenants`/`listSubscriptions` an expand at a time, and nobody expands fast enough to serialize on anything.

`findSubscriptionById(cache, id)` is the one lookup by bare id, and it is a walk rather than an index: it scans what is already cached, then falls back to `walkSubscriptions`, returning the first `AzureSubscription` whose id matches case-insensitively. The cache-first pass matters because the walk visits tenants in listing order, so a tenant the user has already browsed would otherwise still wait behind every uncached tenant ahead of it. It exists because a subscription id alone does not say which tenant owns it, and ARM answers a home-tenant token presented for a subscription in another tenant with a 401 — so a caller holding only an id (an azd environment, whose `AZURE_TENANT_ID` is optional) cannot build a working `AzureSubscriptionTarget` without it. It is **unfiltered**: the filter governs what the tree shows, which is no reason to be unable to authenticate to a subscription the user just deployed into. It cannot prompt, since each tenant listing probes silently for a session first, and it returns `undefined` for an id no signed-in account reaches — an ordinary outcome its callers degrade on. In the extension it is bound to `ISubscriptionResolver` so consumers that merely need a tenant never touch the cache themselves.

### Invalidation

A listing is expensive to earn (a token and a round trip per tenant) and rarely wrong: what tenants an account can reach, and what subscriptions a tenant holds, change on the order of months. So the layer discards as little as it can, and the default answer is **nothing**. Hiding data is preferred to evicting it; leaked memory in a session costs far less than re-earning a listing the user is about to look at again.

Three distinct verbs, in increasing cost:

| Verb | Cost | Meaning |
|------|------|---------|
| Nothing | free | the change is applied on *read*, above the cache — a filter, or the manually-named tenants merged over each account's tenant listing |
| `reenumerate*` | one listing | one listing's membership may have changed. Lossless for everything beneath it: the store is flat and path-keyed, so re-listing an account's tenants returns them under the same keys and their subscriptions re-attach untouched. Only a genuinely new child costs a fetch |
| `clear()` | everything | only when the user asked for it |

| Change | Cache action | Tree | Why |
|--------|--------------|------|-----|
| `microsoft-sovereign-cloud` setting | `reenumerateAccounts()` | `Everything` | the accounts listing is the one read against the *ambient* cloud. Everything below it is keyed by environment, so the two clouds' listings coexist rather than collide, and switching back is free |
| `vscode-azure.signedInTenants` | **nothing** | `Everything` | manually-named tenants are merged above the cache on every read, so naming or un-naming one falsifies no listing |
| `vscode-azure.selectedSubscriptions` (the filter) | **nothing** | `Everything` | a filter change makes no cached listing untrue |
| Account signed out | **nothing** | remove those accounts' nodes | the account has left the accounts listing, and a node is only reachable by descending the listing that produced it, so everything under it is already unreachable. Keeping it makes the re-sign-in that usually follows a token expiry instant |
| New account appears in a session change | `reenumerateAccounts()` | `Roots` | a new account does not falsify existing tenants |
| Sign-in to a newly-named tenant | **nothing** | (the configuration listener) | the tenant appears via the merge with nothing re-listed; its subscriptions are simply a miss when something first drills in |
| Sign-in to an already-reachable tenant | `reenumerateSubscriptions(tenant)` | `byAccount(id)` | the session may have authorized subscriptions that were invisible when that tenant was last listed. It says nothing about any *other* tenant, or about what tenants the account can reach |
| `Azure: Refresh` | `clear()` | `Everything` | the one place that discards outright. `getTtl()` is `Infinity`, so nothing else ever re-lists — a refresh that skipped the listings could never pick up a newly created subscription |

Auth-session changes are noisy (they also fire on individual token acquisitions), so the provider reconciles: it re-reads the current account set and does nothing when it is unchanged. That read must **bypass** the memoized accounts listing — a memoized `listAccounts()` could only ever answer "no change" — so it calls `reenumerateAccounts()` first, which discards the memo and lets the following `listAccounts()` reseed it, making the re-list that follows free.

Reconciling calls `authentication.getAccounts()`, which itself *could* raise `onDidChangeSessions`. `AzureAccountDataProvider` therefore ignores session events for a short window around its own reconcile; without it the reconcile might re-trigger itself forever. The window is deliberately narrow -- it covers only the provider's own echo, so an event provoked by anything else costs at most one reconcile that finds the account set unchanged and stops.

## Workspace (Local) Tree

A tree view in the same container as the resources tree shows
items that live "locally" rather than in Azure. It uses the same
`DataItemTree` / `ViewItemTree` infrastructure as the resources tree
but with a short 60-second TTL so newly-added marker files
(`azure.yaml`, `host.json`, ...) are picked up quickly.

### Workspace Node Model

All workspace items implement a small, common interface
([`WorkspaceNode`](../extensions/vscode-azure/src/tree/workspace/WorkspaceNode.ts)): a stable `id` that doubles as both the
cache key and the VS Code `TreeItem.id`, a display `label`, a `type`
discriminator, and an optional `resourceUri` naming the file or folder on disk
that the node stands for (which is what makes "Reveal in Explorer" work).

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

Activities implement a common interface
([`Activity`](../extensions/vscode-azure/src/tree/activity/Activity.ts)): a stable `id`, a `type` discriminator, a
mutable `status`, a title and optional description, and start/end timestamps.
`status` is mutable because a provider advances it in place and then fires
`onDidChange` — the node identity has to survive the transition.

### Activity Data Providers

| Provider | Root? | Description |
|----------|-------|-------------|
| `ArmDeploymentDataProvider` | Yes | Tracks ARM deployments. Polls for status and fetches deployment operations during enrichment. |
| `CodeDeploymentDataProvider` | Yes | Tracks code deployments (e.g. `azd deploy`). `trackDeployment()` returns a `CodeDeploymentHandle` for controlling lifecycle and adding children. The handle exposes `complete(status, error?)` and `addChild(title, status?)` — the provider owns all mutations and fires change events internally. |
| `GenericActivityDataProvider` | Yes | Tracks simple one-off activities (leaf nodes, no children). |

Activity providers are registered as `[primaryId, Class]` tuples in the `dataProviders` array, which binds each as a singleton under its own identifier and aliases it into the collection. This allows commands (e.g. `ClearActivities`) to inject a specific provider directly while the tree still retrieves all providers collectively. See [Dependency Injection — Multi-Binding](dependency-injection.md#multi-binding-for-providers).

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
types with bundled icons to localized, product-specific group labels (for
example, `Microsoft.App/containerApps` appears as "Container Apps"). It resolves
group icons directly from the logical type using the convention above. Unknown
logical types retain their raw type label and generic `symbol-namespace` icon.

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
