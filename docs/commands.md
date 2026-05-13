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

Commands are registered in `registerCommands.ts` using `registerManagedCommand`:

```typescript
export function registerCommands(container: Container): void {
    registerManagedCommand(container, 'vscode-azure/resources/refresh', RefreshResourcesView);
    registerManagedCommand(container, 'vscode-azure/resources/openInPortal', OpenInPortal);

    // ...

    registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
    registerManagedCommand(container, 'vscode-azure/activity/clearSuccessful', ClearActivities, 'successful');
    registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');

    // ...
}
```

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

Commands that operate on tree items accept an optional `key` parameter. When invoked from a tree item context menu, the key is provided. When invoked from the command palette, the command prompts the user to select a resource:

```typescript
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public async execute(key?: string): Promise<void> {
        let resource: ConcreteAzureNode | undefined;
        if (!key) {
            resource = await resourceExperience({
                ...this.ctx,
                tree: this.viewTree,
                dataItemTree: this.cache,
                logicalType: AcrResourceType
            });
        } else {
            resource = this.cache.get(key);
        }

        if (!resource || !isAcrRegistry(resource)) {
            return;
        }

        const enriched = await withDelayedProgress(this.ctx.code, { ... },
            this.cache.whenEnriched<EnrichedAcrRegistry>(resource)
        );
        // ... use enriched resource
    }
}
```

`resourceExperience` returns the picked resource object directly (typed via the generic parameter), rather than a string key. See the `Choose*Step` classes in `packages/azutils/src/wizard/` for use as composable wizard steps.

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
