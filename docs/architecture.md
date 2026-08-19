# Architecture Overview

This project is a VS Code extension for Azure, organized as a monorepo with three workspaces. The architecture follows a layered, provider-based pattern with dependency injection throughout.

## Package Organization

```
vscode-azure/
├── packages/utils/          @microsoft/vscode-azure-utils
├── packages/azutils/        @microsoft/vscode-azure-azutils
└── extensions/vscode-azure/ The VS Code extension
```

### Dependency Graph

```
extensions/vscode-azure
    ↓
packages/azutils  (@microsoft/vscode-azure-azutils)
    ↓
packages/utils    (@microsoft/vscode-azure-utils)
```

### `packages/utils` — Core Infrastructure

Framework-level building blocks with no Azure-specific knowledge:

- **DI service identifiers**: `IVsCode`, `IExtensionContext`, `ICodeContext`, `IActionExecutor`, `ICommandRegistry`, `ITelemetryReporter`, `IOutputChannel`, `IProcessExecutor`
- **Tree infrastructure**: `DataItemTree`, `DataProvider`, `ViewItemTree`, `ViewProvider`, `ProviderRegistry`
- **Wizard framework**: `Wizard`, `PromptStep`, `ExecuteStep`, `GoBackError`
- **Telemetry & error handling**: `ActionExecutor`, `CommandRegistry`, `IActionContext`
- **VS Code abstractions**: `CancellationError`, `Disposable`, `EventEmitter`
- **Process execution**: `ProcessExecutor`, `IProcessExecutor`, and shared shell-task construction
- **Data utilities**: `InflightMap`, `Limiter`

### `packages/azutils` — Azure Utilities

Azure-specific models and helpers that build on `utils`:

- **Resource models**: `GenericResource`, `AzureNode`, `VirtualResource`, `VirtualGroup`, `ResourceGroup`
- **Identity**: `AzureNodeId` (URI-based node identification across account, tenant, subscription, grouping, resource, and virtual-resource nodes)
- **Auth module** (`src/auth/`): `EnvironmentLike` + cloud presets (`AzurePublicCloud`, `AzureUSGovernment`, `AzureChinaCloud`); the identity models `AzureAccount`/`AzureTenant`/`AzureSubscription`; `VsCodeExtensionCredential` (a `TokenCredential` owning sovereign-cloud detection and CAE/MFA claims handling); and the `ICredentialFactory` DI service. (The account/tenant/subscription listing logic lives in `AzureAccountDataProvider` in the extension, which signs in via the credential factory and lists accounts/tenants/subscriptions directly.)
- **REST client wrappers**: `ResourceClient`, `DeploymentClient`, `SubscriptionClient`, `AcrClient`, `WebAppClient` — typed wrappers around Azure SDK clients. See [Azure Clients](azure-clients.md).
- **Client factories**: `createArmRestClient`, `createArmRestSubscriptionClient` — inject custom pipeline policies (deduplication, correlation ID, accept language). Authentication, including CAE/MFA step-up, is handled by the SDK's built-in `bearerTokenAuthenticationPolicy` driven by the supplied `TokenCredential`.
- **Pagination**: `toPages` — converts Azure SDK `PagedAsyncIterableIterator` to `AsyncIterable<Page<T>>`
- **Tree pick**: `ChooseSubscriptionStep`, `ChooseResourceGroupStep`, `ChooseResourceStep` — reusable wizard prompt steps for resource selection. Convenience wrappers `subscriptionExperience`, `resourceGroupExperience`, `resourceExperience` run a single-step wizard and return the picked object directly.

### `extensions/vscode-azure` — The Extension

The VS Code extension that wires everything together:

- **Activation**: Core container setup plus declarative product, command, and tree registration
- **Commands**: `SignIn`, `SelectSubscriptions`, `RefreshResourcesView`, `GroupBy`, `OpenUrl` (backing open-in-portal), `BrowseWebsite`, `DeleteAzureResource`, `LoadMore`, `RefreshWorkspaceView`, `RevealInExplorer`, `DisableAcrAdminUser`, `EditSettings`, `ClearActivities`, `AzdUp`, `AzdDown`, `InstallAzd`
- **Resource creation wizards**: `CreateFunctionApp` — azd-backed wizard for creating and deploying Azure resources. See [Resource Creation](resource-creation.md).
- **Static Web Apps**: creation wizard, deployment routing, local CLI/debug integration. See [Static Web Apps](static-web-apps.md).
- **Tree providers**:
  - Resources: `AzureAccountDataProvider` (account/tenant/subscription), `AzureResourceDataProvider`/`GenericAzureViewProvider` (resource groups + fallback resources), `AcrDataProvider`/`ViewProvider`, `WebAppDataProvider`/`ViewProvider` (Web App resources and their settings), `SettingsDataProvider`/`ViewProvider` (shared settings virtual-node glue -- see [Settings](settings.md))
  - Workspace (local): `AzdWorkspaceDataProvider`/`ViewProvider`, `FunctionsWorkspaceDataProvider`/`ViewProvider`, `EmulatorsWorkspaceDataProvider`/`ViewProvider`
  - Activity: `ArmDeploymentDataProvider`/`ViewProvider`, `CodeDeploymentDataProvider`, `GenericActivityDataProvider`, `ActivityViewProvider`
- **Services**: Extension-scoped DI identifiers (`ICredentialFactory`, `IAzureAccountDataProvider`, `IResourceClientProvider`, `IDeploymentClientProvider`, `IAcrClientProvider`, `IAzureViewDataTree`, `IWorkspaceViewDataTree`, `IActivityViewDataTree`, etc.)
- **Workspace scanning**: `IWorkspaceIndexService` walks the workspace once, lets registered `WorkspaceDetector`s attach namespaced tags to files and directories, and keeps the resulting index fresh with a single shared watcher. Workspace tree providers query it by tag (`withTag`) rather than searching the workspace themselves. It lives here rather than in `utils` because its consumers are Azure product concerns.

## Activation Flow

1. VS Code loads `main.js`, which imports the esbuild bundle
2. Product entry points contribute bindings, commands, and resource providers to `ProductRegistrar`
3. `activateInternal()` creates the DI container via `setUpContainer()` and applies product bindings
4. Test or mock overrides are applied before any contributed feature is activated
5. `registerCommands()` binds command classes and registers core and product commands with VS Code
6. `registerTrees()` sets up core and product data/view providers and the tree views
7. The tree view is eagerly resolved, kicking off the provider chain

## Key Design Principles

- **Data/View separation**: The tree UI is split into a data layer (fetching, caching, enrichment) and a view layer (rendering, grouping, virtual nodes). See [Tree Views](tree-views.md).
- **Provider dispatch**: Both layers use `ProviderRegistry` to dispatch to the first matching provider. Registration order matters — specific providers before generic fallbacks.
- **DI everywhere**: Services are injected via inversify. Each command execution gets a scoped child container with `IActionContext`. See [Dependency Injection](dependency-injection.md).
- **One product entry point**: Each Azure product owns a registration function under `src/products`. A generic Azure product owns shared Azure services, commands, and fallback providers. Adding a product changes the central product list, not the extension activation function or shared command/tree import lists.
- **Automatic telemetry**: Every command is wrapped in `callWithTelemetryAndErrorHandling`, which captures duration, result, and errors. See [Telemetry](telemetry.md).
- **Localization**: All user-facing strings use `IVsCode.l10n.t()`. Debug/trace output is exempt. See [Conventions](conventions.md).
- **Azure client wrappers**: Typed wrappers around Azure SDK clients with custom pipeline policies, lazy SDK imports, and `AsyncIterable<Page<T>>` return types. See [Azure Clients](azure-clients.md).
