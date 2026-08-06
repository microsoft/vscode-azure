# Dependency Injection

The extension uses [inversify](https://inversify.io/) for dependency injection. The DI container is the backbone of the application — services, commands, and tree providers are all wired through it.

## Service Identifiers

Service identifiers use the `I`-prefix convention and are created with `Symbol.for()`:

```typescript
// In packages/utils
export const IVsCode: ServiceIdentifier<IVsCode> = Symbol.for('IVsCode');
export const IExtensionContext: ServiceIdentifier<IExtensionContext> = Symbol.for('IExtensionContext');
export const ICodeContext: ServiceIdentifier<ICodeContext> = Symbol.for('ICodeContext');
export const IActionExecutor: ServiceIdentifier<IActionExecutor> = Symbol.for('IActionExecutor');
export const ICommandRegistry: ServiceIdentifier<ICommandRegistry> = Symbol.for('ICommandRegistry');
export const ITelemetryReporter: ServiceIdentifier<ITelemetryReporter> = Symbol.for('ITelemetryReporter');
export const IOutputChannel: ServiceIdentifier<IOutputChannel> = Symbol.for('OutputChannel');
export const IProcessExecutor: ServiceIdentifier<IProcessExecutor> = Symbol.for('IProcessExecutor');

// In extensions/vscode-azure/src/services.ts
export const IResourceClientProvider: ServiceIdentifier<...> = Symbol.for('IResourceClientProvider');
export const IDeploymentClientProvider: ServiceIdentifier<...> = Symbol.for('IDeploymentClientProvider');
export const IAcrClientProvider: ServiceIdentifier<...> = Symbol.for('IAcrClientProvider');
export const IAzureViewDataTree: ServiceIdentifier<...> = Symbol.for('IAzureViewDataTree');
export const IAzureViewViewItemTree: ServiceIdentifier<...> = Symbol.for('IAzureViewViewItemTree');
export const IAzureResourceTreeView: ServiceIdentifier<...> = Symbol.for('IAzureResourceTreeView');
export const IActivityViewDataTree: ServiceIdentifier<...> = Symbol.for('IActivityViewDataTree');
export const IActivityViewViewItemTree: ServiceIdentifier<...> = Symbol.for('IActivityViewViewItemTree');
export const IActivityTreeView: ServiceIdentifier<...> = Symbol.for('IActivityTreeView');
```

Each identifier doubles as both the type alias and the DI token using TypeScript's declaration merging:

```typescript
export const IVsCode: ServiceIdentifier<IVsCode> = Symbol.for('IVsCode');
export type IVsCode = typeof vscode;
```

## Container Setup

The container is created in `extension.ts` during activation:

```typescript
function setUpContainer(extensionContext: IExtensionContext): Container {
    const container = new Container();

    // Constants
    container.bind(IVsCode).toConstantValue(vscode);
    container.bind(IExtensionContext).toConstantValue(extensionContext);
    container.bind(ICodeContext).toConstantValue({ code: vscode, extensionContext });

    // Singletons with automatic disposable management
    container.bind(IActionExecutor).toDynamicValue(context => {
        return new ActionExecutor(context.get(ITelemetryReporter));
    }).inSingletonScope().onActivation(pushDisposable);

    container.bind(IProcessExecutor).toDynamicValue(context => {
        return new ProcessExecutor(context.get(IVsCode));
    }).inSingletonScope();

    container.bind(ITelemetryReporter).toDynamicValue(context => {
        return createTelemetryReporter(context.get(IExtensionContext), TelemetryReporter);
    }).inSingletonScope().onActivation(pushDisposable);

    // ... more bindings
    return container;
}
```

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

The `pushDisposable` helper (in `services.ts`) registers disposable services with the extension context so they're cleaned up on deactivation:

```typescript
export function pushDisposable<T>(context: ResolutionContext, injectable: T): T {
    if (Disposable.test(injectable)) {
        context.get(IExtensionContext).subscriptions.push(injectable);
    }
    return injectable;
}
```

It uses the inversify `ResolutionContext` to look up `IExtensionContext` and `Disposable.test()` to check disposability. All singleton bindings use `.onActivation(pushDisposable)` to opt into this pattern.

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

This means a command like `Hello` can inject `IActionContext` alongside other services:

```typescript
@injectable()
export class Hello implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode
    ) { }
}
```

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

The `bindProviders` helper iterates the array and handles both cases:

```typescript
function bindProviders<T>(container, collectionId, entries: readonly ProviderEntry<T>[]) {
    for (const entry of entries) {
        if (typeof entry === 'function') {
            container.bind(collectionId).to(entry).onActivation(pushDisposable);
        } else {
            const [primaryId, providerClass] = entry;
            container.bind(primaryId).to(providerClass).inSingletonScope().onActivation(pushDisposable);
            container.bind(collectionId).toService(primaryId);
        }
    }
}
```

Registration order in the array determines dispatch order — specific providers must come before the generic fallback:

```typescript
dataProviders: [
    AcrDataProvider,                                     // specific
    [IFunctionAppDataProvider, FunctionAppDataProvider],  // specific, with direct-inject support
    AzureResourceDataProvider,                           // fallback
],
```

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

Azure SDK client providers use `.toFactory()` bindings. The shared
`bindAzureClientProvider()` helper captures `ICodeContext`, `IActionExecutor`,
and `ICredentialFactory`, then returns a function that creates the client for a
given subscription:

```typescript
bindAzureClientProvider(
    container,
    IResourceClientProvider,
    (context, executor, credential, subscription) => {
        return ResourceClient.create(context, executor, credential, subscription);
    },
);
```

The resulting `IResourceClientProvider` type is a `SyncFactory<IResourceClient, [AzureSubscription]>` — a function that takes a subscription and returns `IResourceClient` directly. This matches `ResourceClient.create(...)`, which is synchronous. The sibling `AsyncFactory<T, TArgs>` type (same shape but returns `Promise<T>`) is used for providers whose `create()` is async. Both types are defined in `packages/utils/src/types/Factory.ts`. See [Azure Clients](azure-clients.md) for details on the client wrappers.

The same pattern handles any class that needs **both** injected services and caller-supplied arguments — for example `GenerateBicepStep`, which needs an injected `ICodeContext` plus a per-command template name and parameter keys. `IGenerateBicepStepFactory` is bound with `.toFactory()`; it captures `ICodeContext` and returns a function taking the config, so the step is fully constructed in one call and its config fields stay `readonly`.

## Multi-Binding with Dual Registration

Some providers need to be injected directly by commands *and* retrieved collectively by the tree. The `[primaryId, Class]` tuple form of `ProviderEntry` handles this declaratively:

```typescript
// Activity tree — all providers use singleton+alias tuples
dataProviders: [
    [IArmDeploymentDataProvider, ArmDeploymentDataProvider],
    [ICodeDeploymentDataProvider, CodeDeploymentDataProvider],
    [IGenericActivityDataProvider, GenericActivityDataProvider],
],
```

This expands to:
1. `container.bind(IArmDeploymentDataProvider).to(ArmDeploymentDataProvider).inSingletonScope()`
2. `container.bind(IActivityViewDataProviders).toService(IArmDeploymentDataProvider)`

Commands like `ClearActivities` inject `IArmDeploymentDataProvider` directly, while the tree retrieves all providers via `container.getAll(IActivityViewDataProviders)`.
