# Resource Models

Azure resource models live in `packages/azutils/src/models/`. They define the type hierarchy used throughout the data and view layers.

## `AzureNode` Union Type

`AzureNode` is a discriminated union of all node types that can appear in the tree:

```
AzureNode = Account | Tenant | Subscription | ResourceGroup | VirtualGroup | GenericResource | VirtualResource
```

`ConcreteAzureNode` excludes `VirtualGroup` and is the type used by `DataItemTree`:

```
ConcreteAzureNode = Account | Tenant | Subscription | ResourceGroup | GenericResource | VirtualResource
```

### Type Guards

Each variant has a type guard function:

| Guard | Matches |
|-------|---------|
| `isAccount(node)` | Account nodes |
| `isTenant(node)` | Tenant nodes |
| `isSubscription(node)` | Subscription nodes |
| `isResourceGroup(node)` | ResourceGroup nodes |
| `isVirtualGroup(node)` | VirtualGroup nodes |
| `isGenericResource(node)` | GenericResource nodes |
| `isVirtualResource(node)` | VirtualResource nodes |

Additional helpers exported by `AzureNode.ts`:
- `getNodeType(node)` returns a consistent telemetry-oriented type string across all concrete node kinds
- `SubscriptionArmType` is the canonical ARM type constant for subscriptions (`Microsoft.Resources/subscriptions`)

## Account / Tenant / Subscription

`Account`, `Tenant`, and `Subscription` are the identity-layer node types, defined in `packages/azutils/src/auth/AzureSubscription.ts` (exported as `AzureAccount`, `AzureTenant`, `AzureSubscription`). They are produced by `AzureListingFetcher` (in azutils) and form the top three levels of the resources tree.

```typescript
type AzureAccount = vscode.AuthenticationSessionAccountInformation & {
    readonly environment: EnvironmentLike; // the cloud this account belongs to
};

interface AzureTenant extends WithRequired<TenantIdDescription, 'tenantId' | 'displayName'> {
    readonly environment: EnvironmentLike;
    readonly accountId: string;    // VS Code auth account id (kept verbatim)
}

interface AzureSubscription extends WithRequired<Subscription, 'subscriptionId' | 'tenantId' | 'displayName'> {
    readonly environment: EnvironmentLike;
    readonly accountId: string;    // VS Code auth account id (kept verbatim)
}
```

**Branded ids, not object embeds.** Tenants and subscriptions reference their owning account by `accountId` rather than embedding an `AzureAccount` object, and a subscription carries its `tenantId` directly rather than embedding an `AzureTenant`. This keeps every node a flat, immutable value object: re-listing one level (e.g. re-listing accounts after an auth-session change) never leaves stale embedded parent objects behind, and callers must not rely on reference equality against a shared account/tenant instance. The producer (`AzureListingFetcher`) lowercases `tenantId` and `subscriptionId` (case-insensitive GUIDs) but keeps `accountId` verbatim because it doubles as the VS Code `getSession` identity; case-insensitive cache keys are achieved by lowercasing `accountId`/`tenantId` inside `AzureNodeId.toString()` instead. The account's display label is **not** carried on tenants/subscriptions: `getSession` resolves the account by `id`, so the credential factory passes an empty `label`.

**A subscription's `tenantId` is the tenant it was *listed through*.** Azure lets one subscription be reachable through more than one tenant, so identity is the triple **(accountId, tenantId, subscriptionId)** — never `subscriptionId` alone. The same subscription reached through two tenants is two distinct nodes with two distinct `AzureNodeId`s. A caller that holds only ids builds an [`AzureSubscriptionTarget`](#azuresubscriptiontarget) rather than looking a node up, since a bare-id lookup would have to choose among nodes that are legitimately distinct — `findSubscriptionById` answers the narrower question "which tenant can reach this id", and any of them will do for minting a token.

**No credential on the subscription.** `AzureSubscription` carries no credential or authentication object — only the `environment` (an [`EnvironmentLike`](#environmentlike)) plus ids/displayName/account-id. Tokens are produced on demand via the credential-factory DI service (`ICredentialFactory`), which defaults to `VsCodeExtensionCredential`. See [Azure Client Wrappers — DI Integration](azure-clients.md#di-integration).

## `AzureSubscriptionTarget`

The least a caller must know to issue subscription-scoped ARM requests:

```ts
interface AzureSubscriptionTarget {
    readonly subscriptionId: string;
    readonly environment: EnvironmentLike;
    readonly tenantId?: string;
    readonly accountId?: string;
}
```

Every `AzureSubscription` is one. The looser shape exists because talking to a subscription and having *listed* one are different requirements, and only the clients that hand the subscription back out (`ResourceClient`, which stamps it onto every `GenericResource` so the tree can build node ids) need the listed object. Everything else needs an endpoint and a token.

That is what lets a caller holding only ids — an azd environment naming `AZURE_SUBSCRIPTION_ID`, a tracked ARM deployment — construct its target directly rather than resolving a node. The `environment` is not information it has to find: it is the ambient configured cloud. `AZURE_TENANT_ID` is optional, though, and a target missing it is a target that talks to the wrong tenant, so such a caller resolves the tenant first via `ISubscriptionResolver` ([Tree Views](tree-views.md#subscription--tenant-filtering)).

`tenantId` pins the token's authority; without it the credential mints a home-tenant token that ARM will reject for a subscription outside it, so supply it whenever it is known. `accountId` only chooses *which* signed-in account to use, and matters solely when two of them reach the same tenant; absent it, VS Code picks.

Client providers are generic in this shape (see [Azure Client Wrappers](azure-clients.md)), so each provider's identifier declares which it needs and the DI registration is the same either way.

## `EnvironmentLike`

`EnvironmentLike` (in `packages/azutils/src/auth/Environment.ts`) is the extension's cloud-endpoint model. It captures only the endpoints the extension actually uses:

```typescript
interface EnvironmentLike {
    readonly name: string;
    readonly isCustomCloud: boolean;
    readonly resourceManagerEndpointUrl: string;
    readonly resourceManagerDefaultScope: string; // `<resourceManagerEndpointUrl>/.default`
    readonly portalUrl: string;
    // string-in / string-out endpoint builders:
    storageEndpoint(...): string;
    containerRegistryEndpoint(...): string;
    azureWebSitesEndpoint(...): string;
}
```

Presets are provided for the three live clouds: `AzurePublicCloud`, `AzureUSGovernment`, and `AzureChinaCloud`. `getConfiguredAzureEnv(code)` reads the `microsoft-sovereign-cloud.{environment,customEnvironment}` setting to select the active cloud, and `getAuthProviderId(env)` maps it to the VS Code authentication provider id (`microsoft` or `microsoft-sovereign-cloud`). `createEnvironment` strips trailing slashes from the URL endpoints (`resourceManagerEndpointUrl`, `portalUrl`) so they match the Azure SDK convention and user-configured custom clouds are sanitized. It also derives `resourceManagerDefaultScope` (the pre-built `<resourceManagerEndpointUrl>/.default` token scope) from the stripped endpoint, so call sites should read that property instead of hand-building the scope.

## `GenericResource`

The base interface for all ARM resources (including resource groups):

```typescript
interface GenericResource extends WithRequired<SdkGenericResource, 'id' | 'name' | 'type' | 'location'> {
    readonly subscription: AzureSubscription;
    readonly logicalType: string;
}
```

Key points:
- `attachMetadata()` adds `subscription` and `logicalType` to raw REST API responses
- `logicalType(...)` (used by `attachMetadata()`) normalizes selected ARM types based on `type` and `kind` (for example, Function Apps vs App Service, Cosmos Mongo vs Cosmos DB)
- ARM resource types must be compared **case-insensitively** against constants (see [Conventions](conventions.md))

## `VirtualResource`

A non-ARM node created by a provider to represent a sub-resource that is not itself a
top-level ARM resource -- container repositories and tags under an ACR registry, for
example. It is identified by a provider-defined `virtualType` discriminator plus a
`virtualPath` within its parent, and holds a reference to the owning
`GenericResource`.

A virtual node may optionally carry its own `portalUrl` for the cases where the portal
has a genuinely distinct page for it; when unset, "Open in Portal" falls back to the
parent resource. Because that URL is carried in the node's `AzureNodeId`, it must be
derived deterministically from the node's own data -- see the JSDoc on
`packages/azutils/src/models/VirtualResource.ts` for the full constraints.

## `VirtualGroup` and `ResourceGroup`

Grouping nodes for organizing resources in the tree:

```typescript
type GroupingStrategy = 'location' | 'resourceType' | 'armTag' | 'resourceGroup';

interface GroupingBase {
    readonly subscription: AzureSubscription;
    readonly groupingStrategy: GroupingStrategy;
    readonly groupingValue: string;
}

type VirtualGroup = GroupingBase & { readonly groupingStrategy: Exclude<GroupingStrategy, 'resourceGroup'> };
type ResourceGroup = GroupingBase & { readonly groupingStrategy: 'resourceGroup' } & GenericResource;
```

`VirtualGroup` explicitly excludes `'resourceGroup'` from its discriminant — resource groups are handled by the `ResourceGroup` type instead. `ResourceGroup` extends both `GroupingBase` and `GenericResource` since resource groups are themselves ARM resources.

## `AzureNodeId`

An opaque, URI-based identifier for nodes using the `azr://` scheme. Lives in `packages/azutils/src/models/AzureNodeId.ts`.

### URI Format

```
azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}
azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subscriptionId}/~{groupingStrategy}/{groupingValue}
azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}#/{virtualType}/{virtualPath}
```

Examples:

| Node Type | URI |
|-----------|-----|
| Account | `azr://{accountId}@{portalHost}` |
| Tenant | `azr://{accountId}@{portalHost}/tenants/{tenantId}` |
| Subscription | `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subId}` |
| Resource Group | `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subId}/resourceGroups/{rg}` |
| Virtual Grouping | `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subId}/~{groupingStrategy}/{groupingValue}` |
| Resource | `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subId}/resourceGroups/{rg}/providers/{type}/{name}` |
| Virtual | `.../{armResourceId}#/{virtualType}/{virtualPath}` |

### Usage

```typescript
// Create from a resource
const id = AzureNodeId.from(resource);

// Use as unique key
const key = id.toString();

// Parse from string (cached for performance)
const parsed = AzureNodeId.parse(key);
```

`AzureNodeId` is used as the key function for `DataItemTree` and `ViewItemTree`, providing a consistent, unique identifier for every node in the tree.

It also exposes helpers for working with node IDs after parsing, including:
- node-kind predicates (`isAccountNodeId`, `isTenantNodeId`, `isSubscriptionNodeId`, `isResourceGroupNodeId`, `isVirtualGroupNodeId`, `isGenericResourceNodeId`, `isVirtualResourceNodeId`)
- `parentNodeId()` for ARM-structural parent traversal
- `toPortalUrl()` for subscription/resource/resource-group portal links
