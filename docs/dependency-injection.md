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
export const IAzureSubscriptionProvider: ServiceIdentifier<...> = Symbol.for('IAzureSubscriptionProvider');
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

Each command execution gets a fresh child container with `IActionContext` bound. This allows commands to inject the current action's telemetry context without threading it as a parameter:

```typescript
// In registerCommands.ts
function registerManagedCommand(container, commandId, commandClass) {
    const registry = container.get(ICommandRegistry);
    registry.registerCommand(commandId, (context, ...args) => {
        // Child container scoped to this execution
        const executionContainer = new Container({ parent: container });
        executionContainer.bind(IActionContext).toConstantValue(context);
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

## Multi-Binding for Providers

Tree data and view providers use multi-binding — multiple providers are bound to the same identifier, and `container.getAll()` retrieves them in registration order:

```typescript
// Registration order matters: specific first, fallback last
container.bind(IAzureViewDataProviders).to(AcrDataProvider);
container.bind(IAzureViewDataProviders).to(GenericAzureDataProvider);

// Retrieval preserves order
for (const provider of context.getAll(IAzureViewDataProviders)) {
    cache.registerProvider(provider);
}
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

Azure SDK client providers use `.toFactory()` bindings. Each factory captures `ICodeContext`, `IActionExecutor`, and `IOutputChannel`, then returns an async function that creates the client for a given subscription:

```typescript
container.bind(IResourceClientProvider).toFactory(context => {
    const ctx = context.get(ICodeContext);
    const executor = context.get(IActionExecutor);
    const output = context.get(IOutputChannel);
    return (subscription) => ResourceClient.create(ctx, executor, output, subscription);
});
```

The resulting `IResourceClientProvider` type is an `AsyncFactory<IResourceClient, [AzureSubscription]>` — a function that takes a subscription and returns `Promise<IResourceClient>`. See [Azure Clients](azure-clients.md) for details on the client wrappers.

## Multi-Binding with Dual Registration

Activity providers use a dual-binding pattern: each is bound to its own class first (for direct injection into commands), then aliased to the shared multi-binding identifier (for collective retrieval by the tree):

```typescript
// 1. Bind to self so commands can inject it directly
container.bind(ArmDeploymentDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
// 2. Alias to multi-binding so DataItemTree can retrieve all providers
container.bind(IActivityViewDataProviders).toService(ArmDeploymentDataProvider);
```

This enables commands like `TrackArmDeployment` to inject `ArmDeploymentDataProvider` directly while the tree system retrieves all providers via `container.getAll(IActivityViewDataProviders)`.
