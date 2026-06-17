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

`Account`, `Tenant`, and `Subscription` are the identity-layer node types, defined in `packages/azutils/src/auth/AzureSubscription.ts` (exported as `AzureAccount`, `AzureTenant`, `AzureSubscription`). They are produced by `AzureAccountDataProvider` (in the extension) and form the top three levels of the resources tree.

```typescript
type AzureAccount = vscode.AuthenticationSessionAccountInformation & {
    readonly environment: EnvironmentLike; // the cloud this account belongs to
};

interface AzureTenant extends WithRequired<TenantIdDescription, 'tenantId' | 'displayName'> {
    readonly environment: EnvironmentLike;
    readonly account: AzureAccount;
}

interface AzureSubscription extends WithRequired<Subscription, 'subscriptionId' | 'tenantId' | 'displayName'> {
    readonly environment: EnvironmentLike;
    readonly tenant: AzureTenant;
    readonly account: AzureAccount;
}
```

**No credential on the subscription.** Unlike the removed `@microsoft/vscode-azext-azureauth` model, `AzureSubscription` carries no credential or authentication object — only the `environment` (an [`EnvironmentLike`](#environmentlike)) plus ids/displayName/tenant/account. Tokens are produced on demand via the credential-factory DI service (`ICredentialFactory`), which defaults to `VsCodeExtensionCredential`. See [Azure Client Wrappers — DI Integration](azure-clients.md#di-integration).

## `EnvironmentLike`

`EnvironmentLike` (in `packages/azutils/src/auth/Environment.ts`) replaces the deprecated `Environment` type from `@azure/ms-rest-azure-env`. It captures only the endpoints the extension actually uses:

```typescript
interface EnvironmentLike {
    readonly name: string;
    readonly isCustomCloud: boolean;
    readonly resourceManagerEndpointUrl: string;
    readonly portalUrl: string;
    // string-in / string-out endpoint builders:
    storageEndpoint(...): string;
    containerRegistryEndpoint(...): string;
    azureWebSitesEndpoint(...): string;
}
```

Presets are provided for the three live clouds: `AzurePublicCloud`, `AzureUSGovernment`, and `AzureChinaCloud` (Azure Germany is deprecated and omitted). `getConfiguredAzureEnv(code)` reads the `microsoft-sovereign-cloud.{environment,customEnvironment}` setting to select the active cloud, and `getAuthProviderId(env)` maps it to the VS Code authentication provider id (`microsoft` or `microsoft-sovereign-cloud`). `createEnvironment` strips trailing slashes from the URL endpoints (`resourceManagerEndpointUrl`, `portalUrl`) so they match the Azure SDK convention and user-configured custom clouds are sanitized.

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

Non-ARM nodes created by providers for grouping or organization:

```typescript
interface VirtualResource {
    virtualType: string;      // e.g. 'repository', 'tag'
    virtualPath: string;      // path within parent resource
    azureResource: GenericResource; // the parent ARM resource
}
```

Used by service-specific providers (e.g. ACR) to represent sub-resources like container repositories that aren't top-level ARM resources.

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
