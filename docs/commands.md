# Commands

Commands follow a structured pattern with automatic telemetry, error handling, and DI integration.

## The `ManagedCommand` Interface

All commands implement `ManagedCommand`:

```typescript
export interface ManagedCommand<T = unknown> {
    execute(...args: unknown[]): T | Promise<T>;
}
```

Commands are `@injectable()` classes that receive dependencies via constructor injection.

## Writing a Command

```typescript
@injectable()
export class Hello implements ManagedCommand {
    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(IVsCode) private readonly code: IVsCode
    ) { }

    public async execute(): Promise<void> {
        this.context.telemetry.properties.hello = 'world';
        void this.code.window.showInformationMessage(
            this.code.l10n.t('Hello, from the Azure extension!')
        );
    }
}
```

Key points:
- Use `@injectable()` decorator on the class
- Inject `IActionContext` for telemetry (scoped per execution)
- Inject `IVsCode` instead of importing `vscode` directly
- Use `this.code.l10n.t()` for user-facing strings
- Prefix un-awaited promises with `void`

## Registration

Core commands are registered in `registerCommands.ts` using `registerManagedCommand`:

```typescript
export function registerCommands(container: Container): void {
    registerManagedCommand(container, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, 'vscode-azure/resources/openInPortal', OpenInPortal);

    registerManagedCommand(container, 'vscode-azure/workspace/refresh', RefreshWorkspaceView);
    registerManagedCommand(container, 'vscode-azure/workspace/revealInExplorer', RevealInExplorer);

    // ...

    registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    // ...
}
```

Product commands are declared from that product's registration entry point:

```typescript
export function registerFunctions(registrar: ProductRegistrar): void {
    registrar.registerCommand(
        'vscode-azure/functionApp/appSettings/add',
        AddOrEditAppSetting,
        'add',
    );
}
```

`registerCommands()` consumes these descriptors after test/mock overrides have
been applied. Product command classes therefore do not need to be imported by
the shared command registration module.

### Resource deletion

Products should use the shared Delete Resource command rather than shipping
their own delete. `DeleteAzureResource` handles confirmation, azd steering,
tree invalidation, and progress for any ARM resource or resource group, using
the generic `ResourceClient` delete operations.

A product only needs its own delete command for targets the generic command
cannot express -- for example a virtual child node that maps to a
service-specific API rather than an ARM resource ID.

Each call:
1. Binds the command class to itself in the container (if not already)
2. Registers it with `ICommandRegistry`, which wraps execution in `callWithTelemetryAndErrorHandling`
3. Creates a scoped child container per execution with `IActionContext` bound

### `prefixArgs` Pattern

`registerManagedCommand` accepts optional trailing `...prefixArgs` that are prepended to the command's `execute()` arguments:

```typescript
function registerManagedCommand(
    container: Container,
    commandId: string,
    commandClass: new (...ctorArgs: any[]) => ManagedCommand,
    ...prefixArgs: unknown[]
): void
```

This enables a single command class to be registered multiple times with different fixed arguments. For example, `ClearActivities` is registered three times with different modes (`'completed'`, `'successful'`, `'all'`) rather than needing three separate classes. `CreateFunctionApp` uses it to distinguish `'createNew'` vs `'deploy'` jobs — see [Resource Creation](resource-creation.md).

### Open-a-URL Commands

Commands whose only action is opening an external URL use the shared `OpenUrl`
managed command. Declare the command id and localized title in `package.json`,
then register `OpenUrl` with either a fixed URL or a resolver as its prefix
argument:

```typescript
registrar.registerCommand(
    'vscode-azure/product/showDocumentation',
    OpenUrl,
    'https://example.com/docs',
);

registrar.registerCommand(
    'vscode-azure/resources/openInPortal',
    OpenUrl,
    OpenInPortal.getUrl,
);
```

Resolvers receive the arguments supplied by VS Code and may return a URL
synchronously or asynchronously. Returning `undefined` produces the same
localized error for every open-a-URL command. Telemetry and error handling are
provided by the normal managed-command registration path.

## Context Values for Tree Item Commands

Commands that act on tree items define a static `ContextValue` property:

```typescript
@injectable()
export class OpenInPortal implements ManagedCommand {
    public static ContextValue = 'openInPortal';
    // ...
}

@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public static ContextValue = 'disableAcrAdminUser';
    // ...
}
```

View providers assign these to tree items using `combineContextValues`:

```typescript
// Multiple commands can target the same tree item
item.contextValue = combineContextValues(
    OpenInPortal.ContextValue,
    DisableAcrAdminUser.ContextValue
);
// Result: "disableAcrAdminUser;openInPortal" (sorted, semicolon-separated)
```

In `package.json`, commands use regex `when` clauses with word boundaries:

```json
{
    "command": "vscode-azure/resources/openInPortal",
    "when": "viewItem =~ /\\bopenInPortal\\b/i"
}
```

The `\b` word boundary prevents unintended partial matches (e.g. `openInPortal` matching `openInPortalV2`).

## Commands with Resource Selection

Commands that operate on tree items accept an optional `key` parameter. When invoked from a tree item context menu, the key is provided. When invoked from the command palette, the command prompts the user to select a resource.

The `ResourceSelector` service encapsulates this pattern. It resolves a resource from the data cache when a key is provided, or prompts the user via `resourceExperience` when no key is given:

```typescript
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }

    public async execute(key?: string): Promise<void> {
        const resource = await this.selector.select(AcrResourceType, key);

        if (!isAcrRegistry(resource)) {
            return;
        }

        const enriched = await withDelayedProgress(this.code, { ... },
            this.selector.whenEnriched<EnrichedAcrRegistry>(resource)
        );
        // ... use enriched resource
    }
}
```

For more complex selection flows (e.g. multi-step wizards), use the `Choose*Step` classes in `packages/azutils/src/wizard/` or the convenience wrappers `subscriptionExperience`, `resourceGroupExperience`, and `resourceExperience` directly.

## Activity Commands

### `ClearActivities`

Clears activities from all three activity providers. Uses the `prefixArgs` pattern to receive a `ClearMode` (`'completed'` | `'successful'` | `'all'`) without needing separate classes:

```typescript
export class ClearActivities implements ManagedCommand {
    public execute(mode: ClearMode): void {
        // ...
    }
}
```

## Telemetry

Every command execution is automatically wrapped with telemetry. The `IActionContext` provides:
- `telemetry.properties` — custom string key-value pairs
- `telemetry.measurements` — custom numeric measurements
- `telemetry.suppress` — opt out of telemetry for this event
- `errorHandling.suppress` — suppress error UI: `'display'` hides the toast, `'reportIssue'` hides the button
- `errorHandling.rethrow` — whether to rethrow errors after recording them

See [Telemetry](telemetry.md) for details.
