# Azure Client Wrappers

Azure SDK client wrappers live in `packages/azutils/src/rest/`. They provide typed, testable interfaces around Azure SDK clients with custom pipeline policies, lazy SDK imports, and pagination converted to `AsyncIterable<Page<T>>`.

## Factory Functions

Four factory functions in `createAzureClient.ts` create Azure SDK clients with custom pipeline policies injected:

| Function | SDK Style | Subscription-Scoped? |
|----------|-----------|---------------------|
| `createAzureClient` | Classic `ServiceClient` | No |
| `createAzureSubscriptionClient` | Classic `ServiceClient` | Yes |
| `createAzureRestClient` | REST-style `@azure-rest/core-client` | No |
| `createAzureRestSubscriptionClient` | REST-style `@azure-rest/core-client` | Yes |

All four accept `ICodeContext` and `IActionExecutor` (for telemetry context and user agent) and inject the same set of pipeline policies. Usage:

```typescript
// Classic SDK (constructor-based)
const client = createAzureSubscriptionClient(
    ctx, executor,
    ResourceManagementClient,     // SDK class constructor
    subscription.credential,
    subscription.subscriptionId,
);

// REST-style SDK (factory-function-based)
const context = createAzureRestSubscriptionClient(
    ctx, executor,
    createContainerRegistryManagement, // SDK factory function
    subscription.credential,
    subscription.subscriptionId,
);
```

## Pipeline Policies

Every client created through the factory functions gets five custom pipeline policies:

| Policy | Position | Description |
|--------|----------|-------------|
| `DedupeRequestPolicy` | perCall | Deduplicates concurrent identical GET requests using `InflightMap`. If two concurrent calls hit the same URL, the second reuses the first's response (with a cloned response object). Streaming requests are excluded. |
| `CorrelationIdPolicy` | perCall | Sets the `x-ms-correlation-request-id` header from the current `IActionContext.telemetry.properties.correlationId`, linking ARM requests back to the VS Code command or tree operation that initiated them. The context is looked up via `IActionExecutor.currentContext` (backed by `AsyncLocalStorage`), so policies don't need `IActionContext` passed explicitly — it's established by whichever scope wraps the call (command execution or `DataItemTree` provider call). |
| `AcceptLanguagePolicy` | perCall | Sets the `accept-language` header to VS Code's UI language (`vscode.env.language`), so ARM responses match the user's locale. |
| `MFAChallengePolicy` | perRetry | Handles 401 responses with a `WWW-Authenticate` header by requesting a stepped-up token. Records `challenge` and `challengeSuccess` telemetry properties. |
| `RemoveBOMPolicy` | perRetry | Strips a leading UTF-8 BOM (`U+FEFF`) from response body text, which some Azure endpoints include. |

The factory also sets a `userAgentPrefix` combining the extension's ID and version with any caller-provided prefix.

## Client Wrappers

Three concrete client classes wrap Azure SDK clients with typed interfaces:

### `ResourceClient`

Wraps `@azure/arm-resources` (`ResourceManagementClient`). Provides:

```typescript
interface IResourceClient {
    readonly resourceGroups: {
        list(options?): AsyncIterable<Page<ResourceGroup>>;
    };
    readonly resources: {
        listByResourceGroup(resourceGroupName, options?): AsyncIterable<Page<GenericResource>>;
    };
}
```

Key behaviors:
- **Lazy SDK import**: The `@azure/arm-resources` module is imported dynamically on first `create()` call and cached in a static field, keeping activation fast.
- **`attachMetadata()`**: After fetching resources from ARM, attaches `subscription` and `logicalType` properties to each resource, converting raw SDK types into `GenericResource`.
- **`logicalType()`**: Classifies `Microsoft.Web/sites` by `kind` into more specific logical types:
  - `Microsoft.Web/sites~functionapp` — Function Apps
  - `Microsoft.Web/sites~workflowapp` — Logic Apps (Standard)
  - `Microsoft.Web/sites~app` — App Service web apps

Exported type constants: `SiteType`, `FunctionAppLogicalType`, `WorkflowAppLogicalType`, `AppServiceLogicalType`.

### `DeploymentClient`

Wraps `@azure/arm-resourcesdeployments` using the REST-style SDK pattern (free functions + context, created via `createDeployments`). Provides:

```typescript
interface IDeploymentClient {
    readonly deployments: {
        getAtScope(scope, deploymentName, options?): Promise<DeploymentExtended>;
    };
    readonly deploymentOperations: {
        listAtScope(scope, deploymentName, options?): AsyncIterable<Page<DeploymentOperation>>;
    };
}
```

Used by `ArmDeploymentDataProvider` to track ARM deployment status and operations in the Activity view.

### `AcrClient`

Wraps `@azure/arm-containerregistry` using the REST-style SDK pattern (free functions + context). Provides:

```typescript
interface IAcrClient {
    readonly registries: {
        get(resourceGroupName, registryName, options?): Promise<Registry>;
    };
}
```

Unlike the other clients, ACR uses `createAzureRestSubscriptionClient` because the `@azure/arm-containerregistry` SDK follows the newer REST-style pattern with `createContainerRegistryManagement` and free function operations.

### `SubscriptionClient`

Wraps `@azure/arm-resources-subscriptions` using the REST-style SDK pattern (free functions + context, created via `createSubscription`). Provides:

```typescript
interface ISubscriptionClient {
    readonly subscriptions: {
        listLocations(subscriptionId, options?): Promise<Location[]>;
    };
}
```

Key behaviors:
- **Static location cache**: Location lists are cached by subscription ID in a static `Map` across all instances, since locations rarely change.
- Used by `ChooseLocationStep` to populate the location picker.

## `toPages`

Converts Azure SDK's `PagedAsyncIterableIterator` to the project-standard `AsyncIterable<Page<T>>`:

```typescript
function toPages<T>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
): AsyncIterable<Page<T>>;

// With item mapping (and optional classic-SDK continuation token helper)
function toPages<T, U>(
    iterator: PagedAsyncIterableIterator<T, T[]>,
    map: (item: T) => U,
    getContinuationToken?: (page: unknown) => string | undefined,
): AsyncIterable<Page<U>>;
```

Uses `.byPage()` for page-level iteration. By default `hasMore` is derived from the `continuationToken` property attached to each page array, which matches the modular REST-style SDK `ContinuablePage` shape (e.g. `@azure/arm-resources-subscriptions/api`, `@azure/arm-resourcesdeployments/api`).

For classic `ServiceClient`-style SDKs (e.g. `@azure/arm-resources`), the continuation token is stored in a `WeakMap` and accessed via the SDK's exported `getContinuationToken(page)` helper rather than on the page array. Pass that helper as the third argument -- `ResourceClient` does exactly this. The `map` parameter is also used by `ResourceClient` to call `attachMetadata()` on each resource.

## DI Integration

Client providers are registered as factory bindings in `extension.ts`:

```typescript
container.bind(IResourceClientProvider).toFactory(context => {
    const ctx = context.get(ICodeContext);
    const executor = context.get(IActionExecutor);
    return (subscription) => ResourceClient.create(ctx, executor, subscription);
});
```

The resulting type is `SyncFactory<IResourceClient, [AzureSubscription]>` — a function that takes a subscription and returns `IResourceClient` directly. This matches `ResourceClient.create(...)`, which is synchronous. The sibling `AsyncFactory<T, TArgs>` type is used for clients whose `create()` returns a promise. Both types live in `packages/utils/src/types/Factory.ts`. Commands and data providers inject the factory and call it with the relevant subscription:

```typescript
@inject(IResourceClientProvider) private readonly getResourceClient: IResourceClientProvider

// Later, in a method:
const client = this.getResourceClient(subscription);
const resources = client.resources.listByResourceGroup(rgName);
```

Each client wrapper exposes an interface (`IResourceClient`, `IDeploymentClient`, `ISubscriptionClient`, `IAcrClient`) that can be mocked in unit tests without needing the real Azure SDK.

## Type Re-exports

Client wrappers **re-export** any Azure SDK types that appear in their public API (return types, interface fields) so that consumers import them from the wrapper — never directly from `@azure/*` packages. This isolates the rest of the codebase from SDK changes.

```typescript
// In AcrClient.ts — re-export SDK types under stable names
export type Registry = SdkRegistry;
export type Sku = SdkSku;

// In SubscriptionClient.ts — direct re-export
export type { Location } from '@azure/arm-resources-subscriptions/models';
```

When adding a new client or exposing a new SDK type:

1. Import the SDK type in the client wrapper file
2. Re-export it (with an alias if the SDK name is awkward)
3. Re-export the client file from `packages/azutils/src/index.ts` (already done via `export * from './rest/clients/...'`)
4. Consumers import from `@microsoft/vscode-azure-azutils`, never from `@azure/*`

The extension has **zero direct `@azure/*` imports** — all Azure SDK access flows through these wrappers.
