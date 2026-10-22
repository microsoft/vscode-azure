# Azure Client Wrappers

Azure SDK client wrappers live in `packages/azutils/src/rest/`. They provide typed, testable interfaces around Azure SDK clients with custom pipeline policies, lazy SDK imports, and pagination converted to `AsyncIterable<Page<T>>`.

## Factory Functions

Two REST-style factory functions in `createAzureClient.ts` create Azure SDK clients with custom pipeline policies injected:

| Function | SDK Style | Subscription-Scoped? |
|----------|-----------|---------------------|
| `createArmRestClient` | REST-style `@azure-rest/core-client` | No |
| `createArmRestSubscriptionClient` | REST-style `@azure-rest/core-client` | Yes |

Both accept `ICodeContext`, `IActionExecutor` (for telemetry context and user agent), and a `TokenCredential`, and inject the same set of pipeline policies. Both also take an optional trailing `dedupeIdentity` that gives `DedupeRequestPolicy` a stable account/tenant key; when omitted, deduplication is scoped to clients that share the same `credential` instance. Client construction is lightweight: consumers should create a client at the point of use rather than cache clients by subscription.

### Credential Handling

Both functions take an explicit `TokenCredential` (produced by the credential-factory DI service `ICredentialFactory`, which by default builds a `VsCodeExtensionCredential`). The subscription-scoped factory also takes the `AzureSubscription` itself, and the non-subscription factory takes an `EnvironmentLike` — each factory derives the subscription ID and/or ARM endpoint internally, so callers don't compute endpoints:

```typescript
// Subscription-scoped REST client — pass the AzureSubscription
const client = createArmRestSubscriptionClient(
    ctx, executor,
    createContainerRegistryManagement,
    credential,     // TokenCredential from ICredentialFactory
    subscription,   // AzureSubscription (empty subscriptionId throws TypeError)
    options,        // optional ClientOptions
);

// Non-subscription REST client — pass the environment
const context = createArmRestClient(
    ctx, executor,
    createSubscription,
    credential,     // TokenCredential
    environment,    // EnvironmentLike (its resourceManagerEndpointUrl is used)
    options,        // optional ClientOptions
);
```

**Endpoint behavior:** The factories set the SDK endpoint to `environment.resourceManagerEndpointUrl` — taken from `subscription.environment` for the subscription-scoped factory, or from the supplied `environment` for the non-subscription one. Endpoints are already stored without a trailing slash (`createEnvironment` strips them, which also sanitizes user-configured custom clouds), so the factory forwards the value as-is. For token acquisition, `EnvironmentLike` also exposes a derived `resourceManagerDefaultScope` (the pre-built `<resourceManagerEndpointUrl>/.default` scope) so callers don't hand-build the `.default` scope. The subscription-scoped factory also extracts `subscription.subscriptionId` (throwing a `TypeError` if it is empty). Concrete client wrappers (`ResourceClient`, `SubscriptionClient`, etc.) simply forward their `AzureSubscription`/`EnvironmentLike` to the factory.

**CAE / MFA step-up:** Conditional Access Evaluation and MFA step-up challenges are handled by the SDK's built-in `bearerTokenAuthenticationPolicy` together with `VsCodeExtensionCredential`. The credential reads `GetTokenOptions.claims` and forwards them to VS Code's `getSession` as a synthetic `WWW-Authenticate` / claims challenge. There is no custom MFA policy.

**Wrong-tenant 401:** ARM answers a token minted for the wrong tenant with a `401` whose `WWW-Authenticate` challenge names the authority that would have worked. `TenantChallengePolicy` reads it and retries the request once with a token for that tenant, acquired **silently** (`TenantChallengeCredential.getTokenSilentlyForTenant`); if no session can supply one the original `401` is returned, never a prompt. It acts only on a `Bearer` challenge with `error="invalid_token"` and no `claims`, whose `authorization_uri` is an `https` URI on one of `EnvironmentLike.loginHosts` with a GUID tenant, naming a tenant other than the one already tried, for a request body that can be replayed. The URI is never followed; only the tenant id is extracted. After a successful retry the credential reports the tenant (and the subscription id from the request path) to `SubscriptionTenantHints`, which `findSubscriptionById` consults before walking every tenant.

### User Agent Prefix

All factory functions set a `userAgentPrefix` that includes the extension's ID and version. If the caller supplies its own `userAgentOptions.userAgentPrefix`, the two are concatenated -- e.g. `my-publisher.my-extension/1.0.0 CustomClient/2.0.0`.

### Custom Policies

Callers can provide custom pipeline policies via `options.additionalPolicies`. These are preserved and placed **before** the standard factory policies, so a caller policy sees a request first on the way out.

## Pipeline Policies

Every client created through the factory functions gets three custom pipeline policies, and ARM clients whose credential implements `TenantChallengeCredential` get a fourth:

| Policy | Position | Description |
|--------|----------|-------------|
| `DedupeRequestPolicy` | perCall | Deduplicates concurrent equivalent GET operations across independently created clients. In-flight state is transient and partitioned by Azure identity plus selected response-affecting headers. Streaming and abortable requests are excluded. |
| `CorrelationIdPolicy` | perCall | Sets the `x-ms-correlation-request-id` header from the current `IActionContext.telemetry.properties.correlationId`, linking ARM requests back to the VS Code command or tree operation that initiated them. The context is looked up via `IActionExecutor.currentContext` (backed by `AsyncLocalStorage`), so policies don't need `IActionContext` passed explicitly — it's established by whichever scope wraps the call (command execution or `DataItemTree` provider call). |
| `AcceptLanguagePolicy` | perCall | Sets the `accept-language` header to VS Code's UI language (`vscode.env.language`), so ARM responses match the user's locale. |
| `TenantChallengePolicy` | perRetry | ARM clients only. Retries a wrong-tenant `401` once with a silently acquired token for the tenant the `WWW-Authenticate` challenge names. Runs after the SDK's bearer policy so it can replace the `Authorization` header that policy set. |

Authentication (including CAE/MFA step-up) is handled by the SDK's built-in `bearerTokenAuthenticationPolicy`, which is wired up by the SDK's own credential plumbing from the supplied `TokenCredential` — not added by these factories.

The factory also sets a `userAgentPrefix` combining the extension's ID and version with any caller-provided prefix.

### Client Lifetime and Request Deduplication

Do not cache Azure management clients to reuse pipelines or deduplicate requests. The standard factory installs `DedupeRequestPolicy` as a per-call policy, and all policy instances share only currently in-flight requests. Equivalent concurrent GETs can therefore coalesce even when each caller creates its own client.

The dedupe key includes a lowercased Azure account-and-tenant partition, the request URL, and selected headers that affect the returned representation (such as `Accept`, `Accept-Language`, range, and conditional headers). Clients scoped to the same account and tenant share a partition across instances. When no stable Azure identity is available, clients created with the same credential object share an object-identity partition. Clients created with response-affecting options, such as custom transports, policies, retry settings, or credentials, use a client-local partition. Harmless options such as logging, telemetry, and user-agent customization preserve cross-client deduplication. Authentication, observability, and unrelated headers are ignored, so token rotation does not prevent deduplication. Anonymous policy instances share their own partition. Completed requests, responses, credentials, and clients are not retained. Callers that need durable data caching should cache the resulting domain data explicitly rather than extending client lifetime.

## Client Wrappers

The concrete wrappers live in `packages/azutils/src/rest/clients/`. Each exposes an
interface (`IResourceClient`, `IDeploymentClient`, `ISubscriptionClient`, `IAcrClient`,
`IWebAppClient`, `IFunctionsHostClient`, `ILogsQueryClient`) that can be mocked in
unit tests without the real Azure SDK; read the wrapper file for the current
operation surface.

| Wrapper | Azure SDK | Scoped by | Consumed by |
|---------|-----------|-----------|-------------|
| `ResourceClient` | `@azure/arm-resources` | Subscription | Resource listing, live resource reads, and deletion |
| `DeploymentClient` | `@azure/arm-resourcesdeployments` | Subscription | `ArmDeploymentDataProvider`, for deployment status and operations |
| `AcrClient` | `@azure/arm-containerregistry` | Subscription | ACR data provider and commands |
| `WebAppClient` | `@azure/arm-appservice` | Subscription | Web App / Function App / Logic App nodes and their settings |
| `FunctionsHostClient` | Shared data-plane REST pipeline | Local host port or remote HTTPS origin | Function metadata, host readiness, and invocation |
| `LogsQueryClient` | Shared data-plane REST pipeline | Subscription cloud and identity | Resource-context and workspace log queries |
| `SubscriptionClient` | `@azure/arm-resources-subscriptions` | `EnvironmentLike` | `AzureAccountDataProvider`, plus `ChooseLocationStep` |

`SubscriptionClient` is scoped by environment rather than by subscription because
listing tenants and subscriptions happens *before* any specific subscription is
known. Its `listLocations` result is cached by subscription ID in a static `Map`
shared across instances, since locations rarely change; the tenant and subscription
listings return `AsyncIterable<Page<T>>` (via [`toPages`](#topages)) so a large
tenant set streams into the tree lazily instead of being buffered.

### `FunctionsHostClient` and host admin operations

`FunctionsHostClient` accepts a local Core Tools port or a remote HTTPS origin with
an asynchronous `getMasterKey` callback. Creation does not start a host or fetch
keys. Local requests use `127.0.0.1`; remote requests obtain the master key lazily
and send it in the `x-functions-key` header. Redirects are disabled.

`listFunctions()` returns the complete, unpaged host collection, `getStatus()`
reads host readiness, and `invoke()` queues execution without waiting for the
function to finish. Invocation strings are passed through; other inputs are
JSON-serialized into the host's string-valued `input` field. Serialization errors
or values that produce no JSON text reject before authentication or transport.
Operations accept cancellation and transport options, reject
non-2xx responses, and validate metadata and status response shapes.

### `ResourceClient` and resource metadata

`ResourceClient` is the one wrapper that does more than pass calls through. As
resources come back from ARM, `attachMetadata()` turns raw SDK types into
`GenericResource` by attaching `subscription` and `logicalType` -- it is passed to
[`toPages`](#topages) as the per-item `map`, so every page is normalized on the way out.

`resources.getById(resourceId, resourceType, options?)` reads live provider-specific
properties and attaches the same metadata. It resolves the resource type's supported
API version through the existing provider-metadata cache. Request options, including
an abort signal, are forwarded to the resource GET. Consumers import the operation's
SDK options from the wrapper's public exports.

`logicalType()` is where an ARM type that covers several visually distinct products
gets split -- `Microsoft.Web/sites` becomes a Function App, Logic App, or App Service
depending on the resource's `kind`. The resulting constants (`SiteType`,
`FunctionAppLogicalType`, `LogicAppLogicalType`, `AppServiceLogicalType`, and the
Cosmos DB / AI Foundry / Durable Task equivalents) are exported from the same file and
are what icon resolution and resource-type grouping key off. See
[Tree Views — Resource Icons](tree-views.md#resource-icons).

`getResourceTypePresentation()` in `src/tree/ResourceTypePresentation.ts` maps
supported logical types to localized group names and bundled icon keys. The
extension's view provider renders these values without owning the service list.

## `toPages`

Converts Azure SDK's `PagedAsyncIterableIterator` to the project-standard
`AsyncIterable<Page<T>>`, iterating via `.byPage()`. It takes an optional `map` to
transform each item on the way out (`ResourceClient` uses this to run
`attachMetadata()` over every resource), and an optional `getContinuationToken`
helper.

By default `hasMore` is derived from the `continuationToken` property attached to
each page array, which is the modular REST-style SDK's `ContinuablePage` shape and
covers every client here. The `getContinuationToken` parameter exists for
classic `ServiceClient`-style SDKs, which instead stash the token in a `WeakMap`
reachable only through their own exported `getContinuationToken(page)` helper --
pass that helper through so `hasMore` stays correct.

## DI Integration

Client providers are registered as factory bindings by each product's registration
entry point (see [Dependency Injection — Factory Bindings](dependency-injection.md#factory-bindings-for-azure-clients)).
The binding resolves a `TokenCredential` from `ICredentialFactory` before
constructing the client, so nothing downstream of the factory deals with auth.

`ICredentialFactory` is bound in singleton scope to `createDefaultCredentialFactory(code, output)`, which produces `VsCodeExtensionCredential` instances. The credential owns sovereign-cloud detection and CAE/MFA claims handling, so client wrappers and the pipeline stay auth-agnostic. The factory accepts either explicit `CredentialFactoryOptions` or an `AzureSubscription` directly (shorthand for `{ tenantId: subscription.tenantId, sessionOptions: { account: { id: subscription.accountId, label: '' } } }`; `getSession` resolves the account by `id`, so the `label` is left empty).

The resulting type is `SyncFactory<IResourceClient, [AzureSubscription]>` — a function that takes a subscription and returns `IResourceClient` directly. This matches `ResourceClient.create(...)`, which is synchronous. The sibling `AsyncFactory<T, TArgs>` type is used for clients whose `create()` returns a promise. Both types live in `packages/utils/src/types/Factory.ts`. Commands and data providers inject the factory and call it with the relevant subscription:

```typescript
@inject(IResourceClientProvider) private readonly getResourceClient: IResourceClientProvider

// Later, in a method:
const client = this.getResourceClient(subscription);
const resources = client.resources.listByResourceGroup(rgName);
```

### How much subscription a client needs

`ResourceClient` takes a full `AzureSubscription` because it stamps that object onto every `GenericResource` it returns, and the tree builds node ids from it. Most clients need far less: `DeploymentClient` is bound as `SyncFactory<IDeploymentClient, [AzureSubscriptionTarget]>`, because naming a deployment by its ARM id says nothing about having listed the hierarchy it lives in.

So `registerAzureClientProvider` (and the `bindAzureClientProvider` / `AzureClientCreate` pair behind it) is generic in the subscription shape, constrained to `AzureSubscriptionTarget`. The provider's identifier declares the shape it wants and the `create` callback is checked against it, so every provider goes through this one path regardless -- a client that needs less does not get a bespoke binding, and `ICredentialFactory` accepts a target just as it accepts a subscription. See the registrations in [`registerGenericAzure.ts`](../extensions/vscode-azure/src/products/registerGenericAzure.ts).

### Management-plane and data-plane clients

The Azure SDK wrappers above are **management plane**: they talk to ARM, so they share one request pipeline and are bound with `registerAzureClientProvider`. `FunctionsHostClient` and `LogsQueryClient` use the shared data-plane REST pipeline.

A **data-plane** client talks to the service's own endpoint instead. It binds through the same `registerAzureClientProvider`, with any extra arguments that name the endpoint declared on the provider's identifier and appended to `create`'s parameters.

### Writing a data-plane client

Data-plane operations are written directly against the REST endpoint with `@azure-rest/core-client`, rather than by wrapping a service SDK. A service SDK carries its own pipeline, its own serializer, and models for every operation in the service -- so a wrapper that uses three read-only operations still pays for all of it, and its requests skip our policies entirely. Writing the calls keeps a data-plane request on the same pipeline as a management request, and matches the shape of the newer modular ARM packages.

Build the client with `createDataPlaneRestClient`, which shares its policy set with the ARM factories:

```typescript
createDataPlaneRestClient(ctx, executor, {
    name: 'example-service',
    endpoint,
    credential,
    scopes: [`${endpoint}/.default`],
}, options);
```

Two conventions keep this maintainable:

- **Declare the wire types locally, matching the SDK's model shape.** The request and response types for the handful of operations we use are small, so they live beside the client. Mirror the corresponding SDK model's property names and optionality, and note in JSDoc wherever the SDK renames a wire field. A modular package for that service can then be dropped in without reworking call sites.
- **Follow the service's own paging.** A collection endpoint caps its response and points at the rest with an RFC 5988 `Link` header. An SDK's async iterator hides that; hand-written calls must walk it, or a large result silently truncates.

Some data-plane services do not accept an Entra ID token directly. `DataPlaneClientConfig.challengeCallbacks` hooks a service-specific exchange into the standard `bearerTokenAuthenticationPolicy`, so the required scope can come from the service challenge while the Entra ID leg retains the pipeline's token cache and conditional-access step-up.

## Type Re-exports

Client wrappers **re-export** any Azure SDK types that appear in their public API (return types, interface fields) so that consumers import them from the wrapper — never directly from `@azure/*` packages. This isolates the rest of the codebase from SDK changes.

```typescript
// In AcrClient.ts — re-export SDK types under stable names
export type Registry = SdkRegistry;
export type Sku = SdkSku;

// In SubscriptionClient.ts — re-export the imported SDK model types
export type { Location, Subscription, TenantIdDescription };
```

When adding a new client or exposing a new SDK type:

1. Import the SDK type in the client wrapper file
2. Re-export it (with an alias if the SDK name is awkward)
3. Re-export the client file from `packages/azutils/src/index.ts` (already done via `export * from './rest/clients/...'`)
Consumers import from `@microsoft/vscode-azure-azutils`, never from `@azure/*`. The one deliberate exception in the extension is `ArmDeploymentDataProvider`, which uses `@azure/core-lro` directly to poll long-running ARM deployments.
