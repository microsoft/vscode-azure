# Target Patterns Cheat-Sheet

Concrete, verified locations in the monorepo (as of this writing) for each pattern you will rebuild against.
Read the precedent file, then mirror its **shape**. All paths are relative to the repo root.

## Where things live

| Category | Path | Precedent to copy the shape of |
|----------|------|-------------------------------|
| Extension root | `extensions/vscode-azure/` | — |
| Commands | `extensions/vscode-azure/src/commands/<product>/` | `commands/acr/DisableAcrAdminUser.ts`, `commands/functions/CreateFunctionApp.ts` |
| Command registration | `extensions/vscode-azure/src/commands/registerCommands.ts` | — |
| Tree data provider | `extensions/vscode-azure/src/tree/resources/<product>/<Product>DataProvider.ts` | `tree/resources/acr/AcrDataProvider.ts`, `tree/resources/functions/FunctionAppDataProvider.ts` |
| Tree view provider | `extensions/vscode-azure/src/tree/resources/<product>/<Product>ViewProvider.ts` | `tree/resources/acr/AcrViewProvider.ts`, `tree/resources/functions/FunctionAppViewProvider.ts` |
| Resource type + guards | `extensions/vscode-azure/src/tree/resources/<product>/<ResourceModel>.ts` | `tree/resources/acr/AcrRegistry.ts`, `tree/resources/functions/FunctionApp.ts` |
| Tree registration | `extensions/vscode-azure/src/tree/registerTrees.ts` | — |
| Azd wizard steps (shared) | `extensions/vscode-azure/src/azd/wizard/` | `AzdProvisionStep.ts`, `GenerateBicepStep.ts`, `GenerateAzureYamlStep.ts`, `CreateAzdEnvStep.ts`, `AzdDeployStep.ts`, `ShowEndpointUrlStep.ts` |
| Wizard context + `AzdJob` | `extensions/vscode-azure/src/azd/wizard/AzdWizardContext.ts` | — |
| Resource-specific prompt steps | `extensions/vscode-azure/src/commands/<product>/steps/` | `commands/functions/steps/PickRuntimeStep.ts`, `PickHostingPlanStep.ts` |
| Wizard context type | `extensions/vscode-azure/src/commands/<product>/<Product>Context.ts` | `commands/functions/CreateFunctionAppContext.ts` |
| Bicep templates | `extensions/vscode-azure/resources/templates/<resource>.bicep` | existing function-app template (a **single** self-contained `.bicep` file) |
| Azure SDK client wrapper | `packages/azutils/src/rest/clients/<Product>Client.ts` | `AcrClient.ts`, `WebAppClient.ts`, `DeploymentClient.ts` |
| DI composition + factory bindings | `extensions/vscode-azure/src/extension.ts` | — |
| Manifest | `extensions/vscode-azure/package.json` | — |
| NLS strings | `extensions/vscode-azure/package.nls.json` | — |
| Resource icons (reuse first) | `packages/azutils/resources/azureIcons/<logicalType>.svg` | existing shared icons in that folder — **only add a new one if none matches** |

> New tree **views** are almost never added. Reuse the existing Resources / Workspace / Activity views;
> register a new **provider** into the relevant tree, not a new container.

> The resource-model file (`<ResourceModel>.ts`) is named after the **resource-model class it defines**, not
> the product — e.g. ACR's is `AcrRegistry.ts` (the model is a registry) and Functions' is `FunctionApp.ts`.
> Pick a name that describes the resource, then match the class name to the file.

## Command (ManagedCommand)

```typescript
@injectable()
export class DisableAcrAdminUser implements ManagedCommand {
    public static ContextValue = 'disableAcrAdminUser';        // only if it acts on a tree item
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IResourceSelector) private readonly selector: IResourceSelector,
    ) { }
    public async execute(key?: string): Promise<void> {
        const resource = await this.selector.select(AcrResourceType, key); // key from tree, or prompt
        // ...
    }
}
```
Register: `registerManagedCommand(container, 'vscode-azure/<product>/<name>', TheCommand);`
(add `...prefixArgs` to bind one class to multiple ids, e.g. per `AzdJob`).

`package.json`:
```json
{ "command": "vscode-azure/<product>/<name>", "title": "%commands.vscode-azure/<product>/<name>%" }
```
Menu `when`: `"view == vscode-azure/resources && viewItem =~ /\\bdisableAcrAdminUser\\b/i"`.

## Tree — two layers

- **DataProvider:** `canHandle()` type guard, `getChildren()` (return real resources + **virtual** category
  nodes), optional `enrich()`; cache clients per subscription. Mirror `AcrDataProvider`.
- **ViewProvider:** `canHandle()`, `getTreeItem()` (label, icon via `logicalType`, `contextValue` via
  `combineContextValues(OpenInPortal.ContextValue, TheCommand.ContextValue)`), `getChildren()`,
  `getParent()`. Mirror `AcrViewProvider`.
- **Register** both in `registerTrees.ts`, specific before generic:
  ```typescript
  dataProviders: [ ProductDataProvider, /* existing */ AzureResourceDataProvider ],
  viewProviders: [ ProductViewProvider, /* existing */ GenericAzureViewProvider ],
  ```
  A `[IProductDataProvider, ProductDataProvider]` tuple binds a singleton + alias so commands can
  `@inject(IProductDataProvider)`.

## Wizard — azd + Bicep (creation / deploy)

Command assembles steps from the container and registers per `AzdJob` with `prefixArgs`:
```typescript
public async execute(job: AzdJob): Promise<void> {
    const get = this.container.get.bind(this.container);
    const promptSteps = [ get(SelectIacFolderStep), get(HydrateAzdInfoStep),
        get(HydratableChooseSubscriptionStep), get(HydratableChooseLocationStep),
        get(ProjectNameStep), /* + resource-specific PickXStep */ ];
    const executeSteps = [ /* GenerateBicepStep via factory */, get(GenerateAzureYamlStep),
        get(CreateAzdEnvStep), get(AzdProvisionStep) /* + AzdDeployStep for 'deploy' */ ];
    await new Wizard(get(IOutputChannel), { job, provision: true }, promptSteps, executeSteps).run();
}
```
Add the Bicep template + its name to the `BicepTemplateName` union in `GenerateBicepStep.ts`. The template
is a **single self-contained `.bicep` file** (like `functionApp.bicep`, which pulls in a remote AVM registry
module `br:...` instead of local module files) — `GenerateBicepStep` copies exactly one file to
`infra/main.bicep`, so don't author a multi-file bicep project. Follow the Fresh / Post-clone / Bootstrapped
scenario matrix in `docs/resource-creation.md`.

## Azure SDK client wrapper

`packages/azutils/src/rest/clients/<Product>Client.ts`: `I<Product>Client` interface,
`I<Product>ClientProvider` factory `ServiceIdentifier`, `class <Product>Client` with static `create(...)`
using the shared `createArmRestSubscriptionClient` helper. Re-export from `packages/azutils/src/index.ts`.
Bind the factory in `extension.ts`:
```typescript
container.bind(IProductClientProvider).toFactory(context => sub =>
    ProductClient.create(context.get(ICodeContext), context.get(IActionExecutor),
        context.get(ICredentialFactory)(sub), sub));
```
Consumers import types from `@microsoft/vscode-azure-azutils`, never `@azure/*`.

## Conventions (apply to every file)

- Copyright header on every `.ts`/`.js` file.
- `import type` for type-only imports; `import * as vscode` only in `extension.ts`.
- Use DI interfaces: `IVsCode`, `IExtensionContext`, `IOutputChannel`, `EventEmitter`, `Disposable`.
- User-facing strings: `this.code.l10n.t(...)`. `package.json` strings: `%key%` in `package.nls.json`.
- Logging via `IOutputChannel` with bracketed subsystem prefixes (`[cmd]`, `[data]`, `[view]`, `[wizard]`, ...); never log PII/secrets.
- Compare ARM `type`/`logicalType` case-insensitively against a constant.
- `vscode.workspace.fs` + `vscode.Uri`, not Node `fs`/string paths.
- `stringifyError()` for caught `unknown` errors.
- `void`-prefix intentionally un-awaited promises.
- Reuse an existing `azureIcons/` icon when one matches; only add a new SVG (to the **azutils** package) when none does. Its filename must equal `<logicalType>.toLowerCase() + '.svg'` or the icon silently disappears.
