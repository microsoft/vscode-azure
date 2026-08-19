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
| `AzureAccountDataProvider` (extension) | Yes | Accounts, tenants, subscriptions | `Infinity` | `onDidChange` on VS Code auth-session change (for the `microsoft` / `microsoft-sovereign-cloud` providers) and on `microsoft-sovereign-cloud` configuration change |
| `AcrDataProvider` | No | Service-specific resources and their virtual children | default | default TTL |
| `SettingsDataProvider` | No | Settings virtual-node leaves created by product providers | default | default TTL |
| `WebAppDataProvider` | No | Function App, App Service, and Logic App resources; composes their settings nodes | default | default TTL |
| `AzureResourceDataProvider` | No | Resource groups (under a subscription), and generic resources as the leaf fallback | default | default TTL |

`AzureAccountDataProvider` lazily signs in by requesting a token from the credential-factory DI service (`ICredentialFactory`, which defaults to `VsCodeExtensionCredential`). The credential defaults to `createIfNone`, so the first token request prompts interactive sign-in when no session exists. It then lists accounts → tenants → subscriptions itself, reading signed-in accounts via the VS Code `authentication` API and tenants/subscriptions via `SubscriptionClient`. Because it returns `Infinity` from `getTtl`, its results never go stale on their own — it fires `onDidChange` instead when auth or the sovereign-cloud setting changes. An auth session change fires a reconciling root re-list (`{ target: Roots }`) that re-lists accounts — preserving tenant/subscription caches under surviving accounts and evicting a signed-out account's subtree because it drops out of the new listing. (This event is noisy — it also fires on individual token acquisitions — but an unchanged account set reconciles to a no-op.) A sovereign-cloud configuration change fires a full `{ target: Everything }` since the endpoint itself changed.

### Subscription / tenant filtering

Tenant and subscription filtering both read `vscode-azure.selectedSubscriptions` (an array of `tenantId/subscriptionId` strings, written by the `Azure: Select Subscriptions` command; parsed by `readSubscriptionFilter` in `src/utils/subscriptionFilter.ts`). An empty list means no filtering. The two halves are enforced at **different layers**, because only one of them saves requests:

- **Tenants are filtered in the data layer**, by `AzureAccountDataProvider.getChildren`. Listing a tenant's subscriptions requires a tenant-scoped token, and acquiring one can surface an interactive sign-in prompt. Dropping the tenant before it ever becomes a node positively guarantees no token and no subscription request is issued for it. The data provider fires `onDidChange` with `{ target: Everything }` when the setting changes, so the tree re-lists.
- **Subscriptions are filtered in the view layer**, by `GenericAzureViewProvider.applyFilter`. A tenant's subscriptions all arrive in a single listing, so discarding some of them lower down would save nothing — it is purely a presentation choice. Node types other than subscriptions pass through untouched.

Because the data layer filters tenants, commands that need to see *past* the filter cannot drill the shared tree. `Azure: Select Subscriptions` and `Azure: Sign In` therefore inject `IAzureListingSource` — the unfiltered listings — rather than the data provider, so the filter can be widened again, not just narrowed.

### Listing cache

Both paths — the filtered tree and the unfiltered commands — share one `AzureListingCache` (`packages/azutils/src/auth/AzureListingCache.ts`, reusable by other extensions). It decorates an `IAzureListingSource` and caches **unfiltered truth**; the filter is applied on *read*, above the cache.

The cache is a container-owned singleton, not a member of any provider. `AzureAccountListingSource` (`src/tree/resources/AzureAccountListingSource.ts`) is the raw fetcher that talks to the `authentication` API and `SubscriptionClient`; `AzureListingCache` wraps it, and DI publishes the result under two identifiers. `IAzureListingCache` is the full surface, injected only by `AzureAccountDataProvider`, which owns invalidation because it is the thing watching for sign-in/out and environment changes. `IAzureListingSource` is a `toService` alias of the same instance exposing only the three listing methods, and is what every other consumer injects. That split is what makes sharing safe: a tenant the filter currently excludes is still a true tenant of that account, so keeping it costs nothing and pays off the moment the filter widens.

`CachedPagedListing` backs the two paged listings. It is lazy (it only pulls pages a reader actually asks for), resumes a partially-read listing instead of restarting it, single-flights concurrent pulls, and on error discards both the iterator and the pages already collected so a retry starts clean rather than replaying a truncated listing as if it were whole.

Invalidation is deliberately narrow:

| Change | Action |
| --- | --- |
| Sovereign cloud setting | `clear()` — the endpoints themselves changed |
| `signedInTenants` setting | `clear()` — manually-entered tenants are folded into tenant listings |
| `selectedSubscriptions` setting | **nothing** — a filter change makes no cached listing untrue |
| Account signed in / out | `refreshAccounts()`, plus `clearAccount(id)` per removed account |

The third row is the point of the cache: widening the filter costs no network at all when the tenant was already fetched — typically the case, since `Azure: Select Subscriptions` just enumerated everything to build its pick list. The last row is narrow for the same reason: a new account signing in does not make an existing account's tenants untrue.

Note that account *change detection* must bypass the memo. `reconcileAccountsOnSessionChange` calls `refreshAccounts()`, since asking the memoized `listAccounts()` whether the account set changed would always answer "no". `refreshAccounts()` reseeds the memo with what it fetched, so the root re-list that follows is served without a second call.

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
