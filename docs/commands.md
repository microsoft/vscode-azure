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

### Revealing related resources

`RevealResource.execute(reference, resourceId)` reveals an ARM resource in the
Resources tree using the reference resource's cloud, account, and tenant.
The target may be in another resource group or subscription. Tree failures
propagate to the caller, which can supply a product-specific explanation.
The `vscode-azure/resources/reveal` command accepts these same arguments and is
hidden from the Command Palette because it requires a reference and target.

### Shared site lifecycle

`WebAppLifecycle` supplies start, stop, and restart actions for App Service,
Function App, and Logic App sites. `WebAppDataProvider` enriches each site's
resource object with management-plane `site` metadata; `WebAppViewProvider`
uses its state to expose stop/restart for running sites and start for stopped
sites. Unknown or transitional states expose neither. A successful action
refreshes the site's metadata before invalidating only its subtree, so its
lifecycle capabilities reflect the reported state. The commands are also available
from the Command Palette: `ResourceSelector.selectResource` prompts for any of
the three site logical types when no tree-item key is supplied.

### Viewing resource properties

`ViewProperties` opens a node's live properties as a JSON document. It resolves
the selected node through `ResourceSelector` and owns telemetry, redaction, and
document presentation; what differs per resource type is only *where the
properties come from*, which is supplied by a `PropertiesAdapter`:

```typescript
export interface PropertiesAdapter<TNode extends ConcreteAzureNode = ConcreteAzureNode> {
    canHandle(node: ConcreteAzureNode): node is TNode;
    read(node: TNode): Promise<unknown>;
    readonly redact?: RedactionPolicy;
}
```

Adapters are `@multiInject`ed and dispatched first-match-wins, so a product
binds its adapter in its own `register*.ts` and gets priority over
`GenericArmPropertiesAdapter`, which is bound from `registerGenericAzure.ts` —
registered last — and serializes any resolved ARM resource or resource group
after dropping metadata attached by this repo.

Most products need no adapter at all. Write one only when the properties worth
showing are not what an ARM GET returns, for example a virtual child node backed
by a data-plane API.

Redaction is **declared, not implemented**: an adapter sets `redact` and the
command applies it through `applyRedaction` from `@microsoft/vscode-azure-utils`.
It is on by default, so an adapter written without a thought for secrets is safe;
`redact: false` is the deliberate opt-out and `{ alsoRedact: [...] }` adds names
specific to that payload. VS Code's telemetry API works the same way — everything
is cleaned, and `TelemetryTrustedValue` opts a value out.

Three things are withheld. A property whose **name** says it holds a credential
(`isSecretPropertyName`, which reads the last word of a compound so `keyVaultUri`
survives while `primaryKey` does not), including a `{ name, value }` entry whose
`name` names a credential; a **value** that is recognisably a credential on its
own, screened with the regexes VS Code uses in
`src/vs/platform/telemetry/common/telemetryUtils.ts`; and the credential-bearing
**segments** of a signed URL or a `key=value;` connection string, so the endpoint
stays readable and only the signature goes. That last one uses an allow list of
query parameters, matching the `Sanitizer` that `@azure/core-rest-pipeline`
scrubs request URLs with.

Anything withheld on one of those grounds is then withheld everywhere else it
appears in the payload, so a key that also sits embedded in some URI does not
survive because only one of its two homes was recognised. Redacted values are
replaced with a visible marker rather than dropped, so the reader can tell a
withheld property from an absent one; a value recognised by its shape says what
it was taken for (`<redacted: JWT>`).

This is a best-effort screen over a payload of unknown shape, not an
authorization boundary.

The opened JSON document is a readonly snapshot of the current state. Editable
resource configuration belongs in the settings framework instead.

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

Prefer expressing this in the view provider that owns the node rather than inventing a separate permission model: a product that permits only a subset of the shared settings commands registers its own view provider ahead of `SettingsViewProvider` and attaches only the context values it wants. This is preferable to contributing the command and failing at execution time -- the user never sees an action that cannot work.

Note that a context value only controls *menu visibility*. The command palette ignores it, so anything that must never happen has to be enforced where the work is actually done (for settings, that is `SettingsAdapter.write`). See [Settings](settings.md).

### Workspace trust

Any command or wizard step that spawns a tool against a workspace folder, or writes into one, must call `requireWorkspaceTrust(this.code)` (from `src/utils/workspaceTrust.ts`) before it prompts or spawns anything, so the user is not walked through a flow that then fails. It throws a localized `ExternalError` when the workspace is untrusted. Commands and steps that touch only Azure or the extension's own temp directories do not call it.

Also set `"enablement": "isWorkspaceTrusted"` (joined with any existing clause using `&&`) on commands that are inherently workspace-backed, so they show greyed out in Restricted Mode. This is additive and not sufficient: `enablement` does not stop programmatic `executeCommand` calls from other extensions, and VS Code does not re-check it for every invocation path, so the code check is the boundary.

## Commands with Resource Selection

Commands that operate on tree items accept an optional `key` parameter. When invoked from a tree item context menu, the key is provided. When invoked from the command palette, the command either prompts the user to select a resource or reports that a selection is required.

The `ResourceSelector` service encapsulates all of this. It replaces the repeated pattern of injecting `ICodeContext`, `IOutputChannel`, `IAzureViewDataTree`, and `IAzureViewViewItemTree` into every command that resolves a node, and it records the resolved node's type in the running action's telemetry so no command has to remember to.

### Resolving a key

`resolve` throws when the key is absent, stale, or points at a node the command cannot act on; `tryResolve` returns `undefined` in exactly the same cases. That pair covers both policies without a flag:

```typescript
// Reports the problem to the user
const resource = this.selector.resolve({
    key,
    canHandle: isDeletable,
    messages: {
        missingKey: this.ctx.code.l10n.t('Select an Azure resource to delete.'),
        invalidNode: this.ctx.code.l10n.t('The selected item cannot be deleted.'),
    },
});

// Quietly does nothing
const node = this.selector.tryResolve({ key, canHandle: isSettingsNode });
if (!node) {
    return;
}
```

`canHandle` may be a predicate or a type guard. A type guard narrows the return type to whatever it proves; a plain predicate validates the node at runtime but leaves the return type as `ConcreteAzureNode`. Omit it to accept any cached node. `ViewProperties` does, because it acts on a subscription or resource group as readily as a resource and leaves the question of what it can serve to its adapters.

Each `messages` entry is a localized string. Omitted entries fall back to a generic localized message.

`selectResource` accepts a `logicalTypes` array, compared case-insensitively on
both direct-key and picker paths. Omit it to allow any ARM resource; an empty
array accepts none. Callers narrow the returned `GenericResource` with their
product type guard.

Commands keep their own `execute` signature, so `prefixArgs` and non-`key` first arguments stay expressible -- `BrowseWebsite` resolves out of `...args: unknown[]`.

Use `selectVirtual` for commands targeting a virtual resource. It resolves a supplied key directly, or prompts the user to navigate through collapsible resource-tree nodes when invoked from the command palette:

```typescript
const node = await this.selector.selectVirtual({ key, canHandle: isSettingsNode });
```

### Prompting instead

When a command should prompt rather than fail, `selectResource` resolves from the key when there is one and runs the resource picker when there is not:

```typescript
public async execute(key?: string): Promise<void> {
    const resource = await this.selector.selectResource({ logicalTypes: [AcrResourceType], key });
    if (!isAcrRegistry(resource)) {
        return;
    }

    // Enrichment is background work, so wait for it explicitly when the command needs it
    const enriched = await this.selector.whenEnriched<EnrichedAcrRegistry>(resource);
    // ...
}
```

Wrap that wait in `withDelayedProgress` when enrichment may not have landed yet, so a slow ARM call shows progress instead of appearing to hang.

Resource and virtual-resource selection share the recursive `nodeExperience` picker. For more complex selection flows (e.g. multi-step wizards), use the `Choose*Step` classes in `packages/azutils/src/wizard/` or the convenience wrappers `subscriptionExperience`, `resourceGroupExperience`, and `resourceExperience` directly.

## Activity Commands

`ClearActivities` clears activities from all three activity providers. It uses the `prefixArgs` pattern to receive a `ClearMode` (`'completed'` | `'successful'` | `'all'`) rather than existing as three separate classes, and injects each provider by its own identifier — see [Dependency Injection](dependency-injection.md#multi-binding-with-dual-registration).

## Telemetry

Every command execution is automatically wrapped with telemetry. The `IActionContext` provides:
- `telemetry.properties` — custom string key-value pairs
- `telemetry.measurements` — custom numeric measurements
- `telemetry.suppress` — opt out of telemetry for this event
- `errorHandling.suppress` — set to `'display'` to hide the error toast
- `errorHandling.rethrow` — whether to rethrow errors after recording them

Throw `ExternalError` for user-actionable failures that need an error toast without
the "Report Issue" button.

See [Telemetry](telemetry.md) for details.

Services shared across command executions cannot inject `IActionContext`, because a singleton would capture whichever execution constructed it first. They inject `IActionExecutor` and call `setTelProp` instead, which writes to the action in flight. `ResourceSelector` records `nodeType` this way for every command that resolves through it.
