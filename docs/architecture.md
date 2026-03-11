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

- **DI service identifiers**: `IVsCode`, `IExtensionContext`, `ICodeContext`, `IActionExecutor`, `ICommandRegistry`, `ITelemetryReporter`, `IOutputChannel`
- **Tree infrastructure**: `DataItemTree`, `DataProvider`, `ViewItemTree`, `ViewProvider`, `ProviderRegistry`
- **Wizard framework**: `Wizard`, `PromptStep`, `ExecuteStep`, `GoBackError`
- **Telemetry & error handling**: `ActionExecutor`, `CommandRegistry`, `IActionContext`
- **VS Code abstractions**: `CancellationError`, `Disposable`, `EventEmitter`
- **Data utilities**: `InflightMap`, `Limiter`

### `packages/azutils` — Azure Utilities

Azure-specific models and helpers that build on `utils`:

- **Resource models**: `GenericResource`, `AzureNode`, `VirtualResource`, `VirtualGroup`, `ResourceGroup`
- **Identity**: `AzureNodeId` (URI-based resource identification)
- **REST client**: `createAzureClient`, custom pipeline policies (deduplication, correlation ID, etc.)
- **Tree pick**: `resourceExperience` for resource selection UI

### `extensions/vscode-azure` — The Extension

The VS Code extension that wires everything together:

- **Activation**: Container setup, command and tree registration
- **Commands**: `Hello`, `OpenInPortal`, `RefreshResourcesView`, `LoadMore`, `DisableAcrAdminUser`
- **Tree providers**: `GenericAzureDataProvider`/`ViewProvider`, `AcrDataProvider`/`ViewProvider`
- **Services**: Extension-scoped DI identifiers (`IAzureSubscriptionProvider`, `IAzureViewDataTree`, etc.)

## Activation Flow

1. VS Code loads `main.mjs`, which imports the esbuild bundle
2. `activateInternal()` creates the DI container via `setUpContainer()`
3. Container binds all core services as singletons
4. `registerCommands()` binds command classes and registers them with VS Code
5. `registerTrees()` sets up data providers, view providers, and the tree view
6. The tree view is eagerly resolved, kicking off the provider chain

## Key Design Principles

- **Data/View separation**: The tree UI is split into a data layer (fetching, caching, enrichment) and a view layer (rendering, grouping, virtual nodes). See [Tree Views](tree-views.md).
- **Provider dispatch**: Both layers use `ProviderRegistry` to dispatch to the first matching provider. Registration order matters — specific providers before generic fallbacks.
- **DI everywhere**: Services are injected via inversify. Each command execution gets a scoped child container with `IActionContext`. See [Dependency Injection](dependency-injection.md).
- **Automatic telemetry**: Every command is wrapped in `callWithTelemetryAndErrorHandling`, which captures duration, result, and errors. See [Telemetry](telemetry.md).
- **Localization**: All user-facing strings use `IVsCode.l10n.t()`. Debug/trace output is exempt. See [Conventions](conventions.md).
