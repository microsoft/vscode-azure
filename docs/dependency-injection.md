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

// In extensions/vscode-azure/src/services.ts
export const IAzureSubscriptionProvider: ServiceIdentifier<...> = Symbol.for('IAzureSubscriptionProvider');
export const IAzureViewDataTree: ServiceIdentifier<...> = Symbol.for('IAzureViewDataTree');
export const IAzureViewViewItemTree: ServiceIdentifier<...> = Symbol.for('IAzureViewViewItemTree');
export const IAzureResourceTreeView: ServiceIdentifier<...> = Symbol.for('IAzureResourceTreeView');
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
export function pushDisposable<T>(_context: unknown, instance: T): T {
    if (instance && typeof instance === 'object' && 'dispose' in instance) {
        extensionContext.subscriptions.push(instance as Disposable);
    }
    return instance;
}
```

All singleton bindings use `.onActivation(pushDisposable)` to opt into this pattern.

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
