# Dependency Injection

The extension uses [inversify](https://inversify.io/) for dependency injection. The DI container is the backbone of the application — services, commands, and tree providers are all wired through it.

## Service Identifiers

Service identifiers use the `I`-prefix convention and are created with `Symbol.for()`. Each identifier doubles as both the type and the DI token, using TypeScript's declaration merging:

```typescript
export const IVsCode: ServiceIdentifier<IVsCode> = Symbol.for('IVsCode');
export type IVsCode = typeof vscode;
```

Framework-level identifiers (`IVsCode`, `IExtensionContext`, `ICodeContext`, `IActionExecutor`, `ICommandRegistry`, `ITelemetryReporter`, `IOutputChannel`, `IProcessExecutor`) are declared alongside the services they front in `packages/utils`. Extension-level identifiers -- client providers, tree instances, tree views -- live in `extensions/vscode-azure/src/services.ts`.

## Container Setup

The container is created by `setUpContainer()` in `extension.ts` during activation. Bindings there come in two flavours:

```typescript
// Values that already exist -- bound as constants
container.bind(IVsCode).toConstantValue(vscode);

// Services the container constructs -- one instance, disposed on deactivation
container.bind(IActionExecutor)
    .toDynamicValue(context => new ActionExecutor(
        context.get(IVsCode),
        context.get(ITelemetryReporter),
        context.get(IExtensionContext).extension.id,
        context.get(IOutputChannel)
    ))
    .inSingletonScope()
    .onActivation(pushDisposable);
```

Extension-lifetime services commonly use `.inSingletonScope().onActivation(pushDisposable)`.
Choose scope and disposal according to ownership; per-operation objects must not become
singletons merely because they use injected services.

## Product Registration

Each Azure product exposes one registration function under
`extensions/vscode-azure/src/products`. It contributes its DI bindings, managed
commands, and resource data/view providers through `ProductRegistrar`:

```typescript
export function registerAcr(registrar: ProductRegistrar): void {
    registrar.registerAzureClientProvider(
        IAcrClientProvider,
        (context, executor, credential, subscription) =>
            AcrClient.create(context, executor, credential, subscription),
    );
    registrar.registerCommand('vscode-azure/acr/disableAdminUser', DisableAcrAdminUser);
    registrar.registerResourceDataProvider(AcrDataProvider);
    registrar.registerResourceViewProvider(AcrViewProvider);
}
```

`registerProducts()` is the only shared product list. Product-specific entries
are followed by a first-class generic Azure product. It owns shared credential,
subscription, resource, and deployment services; generic resource/auth
commands; and the root/fallback resource providers. The registrar applies DI
bindings while the root container is built, but defers commands and trees until
after test/mock overrides. This keeps
`activateInternal()` product-agnostic and preserves the existing activation
timing.

## Disposable Management

`pushDisposable` (in `services.ts`) is an inversify activation hook: given a newly
resolved service, it checks `Disposable.test()` and, if the service is disposable,
pushes it onto `IExtensionContext.subscriptions` so VS Code cleans it up on
deactivation. Because it resolves `IExtensionContext` from the `ResolutionContext`
it is handed, a binding opts in with nothing more than `.onActivation(pushDisposable)`
-- there is no separate list of disposables to keep in sync.

## Scoped Command Execution

Each command execution gets a fresh child container with `IActionContext` bound and `autobind` enabled. This allows commands to inject the current action's telemetry context without threading it as a parameter, and to resolve `@injectable` wizard steps directly from the container:

```typescript
// In registerCommands.ts
function registerManagedCommand(container, commandId, commandClass) {
    const registry = container.get(ICommandRegistry);
    registry.registerCommand(commandId, (context, ...args) => {
        // Child container scoped to this execution
        const executionContainer = new Container({ parent: container, autobind: true });
        executionContainer.bind(IActionContext).toConstantValue(context);
        executionContainer.bind(Container).toConstantValue(executionContainer);
        return executionContainer.get(commandClass).execute(...args);
    });
}
```

This means a command can inject `IActionContext` alongside its other services and
get the telemetry context for *its own* invocation -- see [Commands](commands.md).

### Autobind and wizard step resolution

`autobind: true` lets the child container construct any `@injectable` class with `executionContainer.get(SomeClass)` **without an explicit binding**. Commands that assemble wizards exploit this: instead of injecting every step's dependencies and threading them into `new StepX(...)`, the command injects `Container` (bound to itself above) and resolves each step with `this.container.get(SomeStep)`. The step's own `@inject(<token>)` decorators pull its dependencies -- `IActionContext` from the execution-scoped child, everything else from the root parent. Autobind is scoped to the child container only, so root-level resolution still requires explicit bindings (no masking of missing production bindings). See [Wizard](wizard.md) for the assembly pattern.

## Multi-Binding for Providers

Tree data and view providers use multi-binding — multiple providers are bound to the same identifier, and `container.getAll()` retrieves them in registration order.

`registerTrees.ts` uses a declarative `ProviderEntry<T>` type to express bindings as arrays rather than imperative `container.bind()` calls. Each entry is either a bare class or a `[primaryId, Class]` tuple:

```typescript
type ProviderEntry<T> = Newable<T> | readonly [ServiceIdentifier<T>, Newable<T>];
```

- **Bare class** — bound directly to the collection identifier
- **`[primaryId, Class]` tuple** — bound as a singleton under `primaryId`, then aliased into the collection so commands can `@inject(primaryId)` directly

The `bindProviders` helper walks the array and applies whichever of the two shapes
each entry uses. For a tuple it guards the singleton binding with `isBound`, which
lets a test (or the mock-data entry point) rebind a provider under its `primaryId`
*before* registration without the product registration overwriting it.

For the Azure resources tree the entries come from `ProductRegistrar`, so **dispatch order is the order products register** -- specific products first, the generic fallback last. Each product contributes its own entries with `registrar.registerResourceDataProvider()` and `registrar.registerResourceViewProvider()`. See [Tree Views](tree-views.md#provider-dispatch) for the ordering rules and why they matter. The workspace and activity trees, which have no product registration, still pass literal arrays to `registerTree`.

## VS Code API Abstraction

Instead of importing `vscode` directly, inject `IVsCode`:

```typescript
// Don't do this (except in extension.ts):
import * as vscode from 'vscode';

// Do this:
@inject(IVsCode) private readonly code: IVsCode
```

This makes code testable — unit tests can provide a mock `IVsCode` with only the needed properties. See [Testing](testing.md).

## Factory Bindings for Azure Clients

Azure SDK client providers use `.toFactory()` bindings. Products declare one with
`registrar.registerAzureClientProvider(<providerId>, create)`; underneath, the shared
`bindAzureClientProvider()` helper resolves `ICodeContext`, `IActionExecutor`, and
`ICredentialFactory` once and hands them to `create` along with the caller's
subscription:

```typescript
registrar.registerAzureClientProvider(
    IResourceClientProvider,
    (context, executor, credential, subscription) =>
        ResourceClient.create(context, executor, credential, subscription),
);
```

The resulting `IResourceClientProvider` type is a `SyncFactory<IResourceClient, [AzureSubscription]>` — a function that takes a subscription and returns `IResourceClient` directly. This matches `ResourceClient.create(...)`, which is synchronous. The sibling `AsyncFactory<T, TArgs>` type (same shape but returns `Promise<T>`) is used for providers whose `create()` is async. Both types are defined in `packages/utils/src/types/Factory.ts`.

The helper is generic in the subscription argument, constrained to `AzureSubscriptionTarget`, so a provider whose client needs only an endpoint and a token (`IDeploymentClientProvider`) binds through the same call as one that needs a listed subscription. See [Azure Clients](azure-clients.md) for details on the client wrappers and which need which.

Data-plane clients bind through the same call. They address a service's own endpoint rather than ARM, so their identifier declares whatever extra per-call arguments name that endpoint, and `create` receives them after the subscription. The subscription is still passed because it carries the cloud the endpoint lives in, and because the credential has to be scoped to the account and tenant that can reach it.

### Per-operation objects and ownership

Separate stable service dependencies from invocation inputs such as a launch target,
workspace folder, runtime choice, or template configuration. A command-scoped injectable
class can receive services through its constructor and invocation inputs through
`execute(...)`. An owned session/step that needs both at construction can use a typed
factory: the DI binding resolves services, and the caller supplies only operation inputs.

The existing
[`IGenerateBicepStepFactory`](../extensions/vscode-azure/src/azd/wizard/GenerateBicepStep.ts)
captures `ICodeContext` and takes a template name plus parameter keys. Its binding in
[`extension.ts`](../extensions/vscode-azure/src/extension.ts) uses
`.toFactory(context => createGenerateBicepStepFactory(context.get(ICodeContext)))`.
The helper constructs a fresh step with readonly configuration. Product-owned factories
belong in `registrar.registerBinding(...)`; Azure clients use
`registerAzureClientProvider(...)` rather than duplicating its credential wiring.

Choose the simplest lifecycle that fits the existing API:

- Constructor/factory construction suits an object whose services and inputs are available
  together. Do not pass a service bundle from each caller merely to avoid a DI factory.
- A method that accepts launch inputs suits a service that coordinates multiple operations.
  Async initialization is appropriate when startup performs I/O; define readiness, reject
  invalid/repeated starts where applicable, and clean up partially acquired resources on failure.
  It is not a reason to create a partially configured object with public mutable fields.

Document who owns each instance and its processes, listeners, cancellation sources, and
disposables, including cleanup on success, failure, cancellation, and extension shutdown.
A factory-created object is not automatically registered with `pushDisposable`. The caller
or an explicit coordinating service must own cleanup; objects that outlive a command must
not retain that command's `IActionContext` or execution container.

## Multi-Binding with Dual Registration

Some providers need to be injected directly by commands *and* retrieved collectively by the tree. The `[primaryId, Class]` tuple form of `ProviderEntry` handles this declaratively -- every activity provider is registered that way. A tuple expands to two bindings:

1. `container.bind(IArmDeploymentDataProvider).to(ArmDeploymentDataProvider).inSingletonScope()`
2. `container.bind(IActivityViewDataProviders).toService(IArmDeploymentDataProvider)`

So `ClearActivities` can inject `IArmDeploymentDataProvider` directly and get the *same instance* the tree sees through `container.getAll(IActivityViewDataProviders)`. Without the singleton scope the two would be different objects, and the command's mutations would never reach the tree.
