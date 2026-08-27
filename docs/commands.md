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

Core commands are registered in `registerCommands.ts` with `registerManagedCommand(container, commandId, commandClass, ...prefixArgs)`. Product commands are declared from that product's registration entry point instead:

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

Either way, each registration:
1. Binds the command class to itself in the container (if not already)
2. Registers it with `ICommandRegistry`, which wraps execution in `callWithTelemetryAndErrorHandling`
3. Creates a scoped child container per execution with `IActionContext` bound

### Resource deletion

Products should use the shared Delete Resource command rather than shipping
their own delete. `DeleteAzureResource` handles confirmation, tree invalidation,
and activity-log tracking for any ARM resource or resource group, using the
generic `ResourceClient` delete operations. When the target carries the
`azd-env-name` tag, the confirmation suggests using `azd down` instead.

A product only needs its own delete command for targets the generic command
cannot express -- for example a virtual child node that maps to a
service-specific API rather than an ARM resource ID.

### `prefixArgs` Pattern

Both registration functions accept optional trailing `...prefixArgs`, which are prepended to the arguments VS Code passes to `execute()`. This lets one command class be registered several times with different fixed arguments instead of being split into near-identical subclasses:

```typescript
registerManagedCommand(container, 'vscode-azure/activity/clearCompleted', ClearActivities, 'completed');
registerManagedCommand(container, 'vscode-azure/activity/clearAll', ClearActivities, 'all');
```

`ClearActivities.execute(mode)` then receives `'completed'` or `'all'` as its first argument, ahead of anything VS Code supplies. `CreateFunctionApp` uses the same mechanism to distinguish its `'createNew'` and `'deploy'` jobs — see [Resource Creation](resource-creation.md).

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

Commands that act on tree items define a static `ContextValue` property, so the string lives with the command that consumes it rather than being repeated in each view provider:

```typescript
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    /** Context value gating this command's visibility in the tree view. */
    public static ContextValue = 'disableAcrAdminUser';
    // ...
}
```

Commands with no behavior of their own can instead export a plain metadata object that pairs the context value with a resolver. `OpenInPortal` does this: it exports `ContextValue` and a `getUrl` resolver, and is registered against the shared `OpenUrl` command.

For a portal page *beneath* a resource's own page, use `OpenInPortal.bladeUrl('/blade')` rather than writing a product-specific navigation command. It returns a resolver that appends the blade path to the node's portal URL, so the command still inherits `OpenUrl`'s telemetry, error handling, and scheme check, and stays sovereign-cloud aware.

View providers assign these to tree items using `combineContextValues` (from `src/tree/contextValueHelpers.ts`):

```typescript
// Multiple commands can target the same tree item
item.contextValue = combineContextValues(
    OpenInPortal.ContextValue,
    DisableAcrAdminUser.ContextValue
);
// Result: "disableAcrAdminUser;openInPortal" (sorted, semicolon-separated)
```

Azure resource nodes should use `resourceContextValue()` from the same file instead, which adds the context values every resource shares (plus any capability-driven ones, such as Browse Website) and takes only the product-specific additions.

In `package.json`, commands use regex `when` clauses with word boundaries:

```json
{
    "command": "vscode-azure/resources/openInPortal",
    "when": "viewItem =~ /\\bopenInPortal\\b/i"
}
```

The `\b` word boundary prevents unintended partial matches (e.g. `openInPortal` matching `openInPortalV2`).

### Gating a command conditionally

A context value does not have to be unconditional. When whether a command applies is a property of the *data* rather than of the node type, the view provider decides per node, and the command is contributed only when it is genuinely available.

Prefer expressing this in the view provider that owns the node rather than inventing a separate permission model: a product that permits only a subset of the shared settings commands registers its own view provider ahead of `SettingsViewProvider` and attaches only the context values it wants. This is preferable to contributing the command and failing at execution time — the user never sees an action that cannot work.

Note that a context value only controls *menu visibility*. The command palette ignores it, so anything that must never happen has to be enforced where the work is actually done (for settings, that is `SettingsAdapter.write`). See [Settings](settings.md).

## Commands with Resource Selection

Commands that operate on tree items accept an optional `key` parameter. When invoked from a tree item context menu, the key is provided. When invoked from the command palette, the command prompts the user to select a resource.

The `ResourceSelector` service encapsulates this pattern. It resolves a resource from the data cache when a key is provided, or prompts the user via `resourceExperience` when no key is given. A command therefore handles both entry points in one line:

```typescript
public async execute(key?: string): Promise<void> {
    const resource = await this.selector.select(AcrResourceType, key);
    if (!isAcrRegistry(resource)) {
        return;
    }

    // Enrichment is background work, so wait for it explicitly when the command needs it
    const enriched = await this.selector.whenEnriched<EnrichedAcrRegistry>(resource);
    // ...
}
```

Wrap that wait in `withDelayedProgress` when enrichment may not have landed yet, so a slow ARM call shows progress instead of appearing to hang.

For more complex selection flows (e.g. multi-step wizards), use the `Choose*Step` classes in `packages/azutils/src/wizard/` or the convenience wrappers `subscriptionExperience`, `resourceGroupExperience`, and `resourceExperience` directly.

## Activity Commands

`ClearActivities` clears activities from all three activity providers. It uses the `prefixArgs` pattern to receive a `ClearMode` (`'completed'` | `'successful'` | `'all'`) rather than existing as three separate classes, and injects each provider by its own identifier — see [Dependency Injection](dependency-injection.md#multi-binding-with-dual-registration).

## Telemetry

Every command execution is automatically wrapped with telemetry. The `IActionContext` provides:
- `telemetry.properties` — custom string key-value pairs
- `telemetry.measurements` — custom numeric measurements
- `telemetry.suppress` — opt out of telemetry for this event
- `errorHandling.suppress` — suppress error UI: `'display'` hides the toast, `'reportIssue'` hides the button
- `errorHandling.rethrow` — whether to rethrow errors after recording them

See [Telemetry](telemetry.md) for details.
