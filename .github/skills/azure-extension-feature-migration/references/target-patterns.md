# Target Patterns Cheat-Sheet

Concrete, verified locations in the monorepo (as of this writing) for each pattern you will rebuild against.
Read the precedent file, then mirror its **shape**. All paths are relative to the repo root.

## Where things live

| Category | Path | Precedent to copy the shape of |
|----------|------|-------------------------------|
| Extension root | `extensions/vscode-azure/` | — |
| Commands | `extensions/vscode-azure/src/commands/<product>/` | `commands/acr/DisableAcrAdminUser.ts`, `commands/functions/CreateFunctionApp.ts` |
| Product registration (commands, clients, resource providers, bindings) | `extensions/vscode-azure/src/products/register<Product>.ts` | `products/registerAcr.ts`, `products/registerFunctions.ts`; ordered in `products/registerProducts.ts` |
| Managed command registration infrastructure | `extensions/vscode-azure/src/commands/registerCommands.ts` | product callers use `ProductRegistrar.registerCommand` |
| Tree data provider | `extensions/vscode-azure/src/tree/resources/<product>/<Product>DataProvider.ts` | `tree/resources/acr/AcrDataProvider.ts`, `tree/resources/webApp/WebAppDataProvider.ts` |
| Tree view provider | `extensions/vscode-azure/src/tree/resources/<product>/<Product>ViewProvider.ts` | `tree/resources/acr/AcrViewProvider.ts`, `tree/resources/webApp/WebAppViewProvider.ts` |
| Resource type + guards | `extensions/vscode-azure/src/tree/resources/<product>/<ResourceModel>.ts` | `tree/resources/acr/AcrRegistry.ts` |
| Tree composition; workspace/activity provider registration | `extensions/vscode-azure/src/tree/registerTrees.ts` | resource provider entries come from `ProductRegistrar` |
| Azd wizard steps (shared) | `extensions/vscode-azure/src/azd/wizard/` | `AzdProvisionStep.ts`, `GenerateBicepStep.ts`, `GenerateAzureYamlStep.ts`, `CreateAzdEnvStep.ts`, `AzdDeployStep.ts`, `ShowEndpointUrlStep.ts` |
| Wizard context + `AzdJob` | `extensions/vscode-azure/src/azd/wizard/AzdWizardContext.ts` | — |
| Resource-specific prompt steps | `extensions/vscode-azure/src/commands/<product>/steps/` | `commands/functions/steps/PickRuntimeStep.ts`, `PickHostingPlanStep.ts` |
| Wizard context type | `extensions/vscode-azure/src/commands/<product>/<Product>Context.ts` | `commands/functions/CreateFunctionAppContext.ts` |
| Bicep templates | `extensions/vscode-azure/resources/templates/` | AVM-backed consumer; when AVM has no suitable module, an AVM-shaped local module plus consumer |
| Azure SDK client wrapper | `packages/azutils/src/rest/clients/<Product>Client.ts` | `AcrClient.ts`, `WebAppClient.ts`, `DeploymentClient.ts` |
| Root DI composition + shared factory bindings | `extensions/vscode-azure/src/extension.ts` | product-owned bindings use `ProductRegistrar.registerBinding` |
| Manifest | `extensions/vscode-azure/package.json` | — |
| NLS strings | `extensions/vscode-azure/package.nls.json` | — |
| Resource icons (reuse first) | `packages/azutils/resources/azureIcons/<logicalType>.svg` | existing shared icons in that folder — **only add a new one if none matches** |
| Product documentation | `docs/products/<product>.md` | existing product docs — framework docs under `docs/` stay framework-level |
| Process artifacts and verification | `docs/migrations/<service>/` | `INVENTORY.md`, `TRIAGE.md`, `MIGRATION-PLAN.md`, `PARITY-REPORT.md` — all committed |

> Before adding anything to a product folder, run the
> [shared-primitive sweep](implementation.md#before-you-write-the-shared-primitive-sweep). Cross-cutting
> concerns — workspace folder/file pickers, URL-opening and browse commands, file existence, caseless
> collections, shell task creation, process termination, workspace scanning/indexing, the shared settings framework,
> and every test fixture — already live in `packages/utils`, `packages/azutils`, or shared extension code.

> New tree **views** are almost never added. Reuse the existing Resources / Workspace / Activity views;
> register a new **provider** into the relevant tree, not a new container.

> The resource-model file (`<ResourceModel>.ts`) is named after the **resource model it defines**, not
> the product — e.g. ACR's is `AcrRegistry.ts` (the model is a registry).
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
        const resource = await this.selector.selectResource({ logicalTypes: [AcrResourceType], key });
        // ...
    }
}
```
Register in the product registration function:
`registrar.registerCommand('vscode-azure/<product>/<name>', TheCommand);`
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
- **Register resource providers** through the product registrar:
  ```typescript
  registrar.registerResourceDataProvider(ProductDataProvider);
  registrar.registerResourceViewProvider(ProductViewProvider);
  ```
  Order the product before the generic Azure fallback in `products/registerProducts.ts`.
  Workspace/activity providers instead use the arrays in `registerTrees.ts`.
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
Apply [AVM-first Bicep provisioning](avm-provisioning.md) before adding templates. Prefer a thin consumer
that references a pinned public AVM module. A single-resource topology may use a suitable resource module;
a topology with supporting resources requires a suitable pattern module. If no suitable module exists,
bundle one AVM-shaped local module plus one consumer in the selected template directory;
`GenerateBicepStep` copies that directory while preserving relative paths. Follow the
Fresh / Post-clone / Bootstrapped scenario matrix in `docs/resource-creation.md`.

Bundle a fallback under one template directory so the source-to-generated layout is explicit:

```text
resources/templates/<resource>/
  main.bicep                         -> infra/main.bicep
  modules/<module-name>/main.bicep  -> infra/modules/<module-name>/main.bicep
```

Add the directory name to `BicepTemplateName` and select it by calling the injected
`IGenerateBicepStepFactory` function with `(templateName, parameterKeys)`.

## Azure SDK client wrapper

`packages/azutils/src/rest/clients/<Product>Client.ts`: `I<Product>Client` interface,
`I<Product>ClientProvider` factory `ServiceIdentifier`, `class <Product>Client` with static `create(...)`
using the shared `createArmRestSubscriptionClient` helper. Re-export from `packages/azutils/src/index.ts`.
Register the provider in `products/register<Product>.ts` through `ProductRegistrar`:
```typescript
registrar.registerAzureClientProvider(
    IProductClientProvider,
    (context, executor, credential, subscription) =>
        ProductClient.create(context, executor, credential, subscription),
);
```
See `products/registerAcr.ts` and `registration/ProductRegistrar.ts`. The shared
`bindAzureClientProvider` resolves contexts and subscription-scoped credentials; products do not
duplicate that binding in `extension.ts`.
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
