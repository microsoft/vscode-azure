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

## `GenericResource`

The base interface for all ARM resources (including resource groups):

```typescript
interface GenericResource {
    id: string;           // ARM resource ID
    name: string;         // Resource name
    type: string;         // ARM resource type (e.g. 'Microsoft.ContainerRegistry/registries')
    location: string;
    tags?: Record<string, string>;
    kind?: string;
    subscription: AzureSubscription;
    logicalType: string;  // Enriched type for more specific categorization (set by attachMetadata)
}
```

Key points:
- `attachMetadata()` adds `subscription` and `logicalType` to raw REST API responses
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

An opaque, URI-based identifier for resources using the `azr://` scheme. Lives in `packages/azutils/src/models/AzureNodeId.ts`.

### URI Format

```
azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}
azr://{accountId}@{portalHost}/tenants/{tenantId}/{armResourceId}#/{virtualType}/{virtualPath}
```

Examples:

| Node Type | URI |
|-----------|-----|
| Account | `azr://{accountId}@{portalHost}` |
| Tenant | `azr://{accountId}@{portalHost}/tenants/{tenantId}` |
| Subscription | `azr://{accountId}@{portalHost}/tenants/{tenantId}/subscriptions/{subId}` |
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
