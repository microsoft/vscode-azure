# Azure Functions -- Migration Plan

Dependency-ordered plan for rebuilding the kept Azure Functions features in
`vscode-azure`. Every task cites the [TRIAGE.md](TRIAGE.md) IDs it implements;
every Defer row is tracked under [Deferred](#deferred----tracked-not-built) and
every Drop row is listed under [Dropped](#dropped----recorded-for-parity).
Dispositions change only by editing [TRIAGE.md](TRIAGE.md) and reconfirming
with the reviewer.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurefunctions` at `801689c66f96b31bc9d7c79ff6cc8d65e41b6965` (v1.22.1) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Triage** | [TRIAGE.md](TRIAGE.md), signed off by Brandon Waterloo (@bwateratmsft) |
| **Target** | `extensions/vscode-azure` plus `packages/azutils` (and `packages/utils` for shared primitives) |
| **Precedents** | `functions` (azd creation/deploy, `WebAppDataProvider`, `functionsDetector`), `swa` (virtual children, CLI tool wrapping, azd service routing), `acr` (resource commands), shared settings/tool/activity services |
| **Monorepo phase** | Phase 1 (beta); Functions runtime v4 only |

## How to read this plan

- Active slices are ordered bottom-up: models and clients, then trees,
  commands, local development, creation/deploy, and manifest cleanup.
  Slice 5 scaffolding is deferred. Each implementation slice must lint,
  build, and test before the next starts.
- Each active implementation slice opens with its mapping record: pattern,
  target files, precedent, shared-primitive sweep, activation, external facts, and tree contract. Sweep
  lines record the searches made while planning; Phase 5 re-runs the sweep
  immediately before each slice is written.
- Context values below are new names derived from the command set; source
  literals are not carried forward. Every `package.json` `when` clause uses
  `viewItem =~ /\b<value>\b/i`.
- Unchecked boxes are open work.

## Mapping decisions made with the reviewer

These were resolved during mapping and are binding for the slices below.

- **Provisioning module.** Use the published
  `br/public:avm/ptn/app/function-app:0.1.0` pattern module. See
  [Provisioning decision](#provisioning-decision).
- **Code deployment** has no Functions-specific command; it runs from an
  initialized azd project through the shared azd workflow.
- **Local functions** are listed only from the running host's
  `/admin/functions`; there is no offline discovery.
- **Log streaming** is a pseudoterminal for every plan that polls the app's
  Application Insights / Log Analytics logs; closing the terminal stops the
  stream. There is no Logs node and no Kudu `/api/logstream` path.
- **Function tree shape.** Under a Function App, functions sit in one
  "Functions" group node beside Application Settings; under the local project
  node they are listed directly, with no group node.
- **`local.settings.json` stays.** It is written by `func init` and read by the
  host and by local execute; there is no upload, download, encrypt, or decrypt.
- **F5 without `tasks.json` / `launch.json`.** A contributed `azure-functions`
  debug type starts the host in-process and resolves to the language debugger's
  attach configuration (Slice 4). No `launch.json` is generated. Existing
  projects' source-generated debug files are left untouched.

## Slice 0 -- Models and clients

```
Pattern:        azutils REST-style client wrappers + shared Azure node model
Target files:   packages/azutils/src/rest/clients/WebAppClient.ts (extend)
                packages/azutils/src/rest/clients/FunctionsHostClient.ts (new)
                packages/azutils/src/rest/clients/LogsQueryClient.ts (new)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionApp.ts (new: guard + virtual function model)
Precedent:      StaticWebAppClient.ts (minimal surface, toPages), StaticWebApp virtual environment/function models
Sweep:          reused IWebAppClient/WebAppClient, createArmRestSubscriptionClient, createDataPlaneRestClient,
                EnvironmentLike.logAnalyticsEndpoint, parseAzureResourceId, toPages, FunctionAppLogicalType, makeVirtualResource,
                createMockWebAppClient, pagesOf, collectPages, MockHttpClient, and createTestActionExecutor.
                Searched "admin/functions", "masterKey", "hostKeys", "LogsQuery", "monitor-query",
                "applicationInsights", "RestError", and "response.status": no host or query client exists.
                FunctionsHostClient and LogsQueryClient use the shared data-plane pipeline; assertRestSuccess
                supplies body-free HTTP failures for both. No new dependency is needed.
Activation:     none
External facts: Functions host controllers and wire models; @azure/arm-appservice v19 modular operations and
                deserializers; Azure Monitor resource/workspace query paths and partial-error response contract.
                See verified sources below.
Client:         re-export every SDK type used in the wrapper APIs from azutils
```

- [x] Add a Function App guard (case-insensitive `FunctionAppLogicalType`
  comparison) and a virtual remote-function model carrying name, trigger
  kind, disabled state, and auth level. <- FUNC-169, FUNC-170
- [x] Extend `IWebAppClient` with start, stop, restart, list/get/delete
  function, function and host keys, and function secrets (invoke URL), keeping
  `toPages` for list operations. <- FUNC-060, FUNC-061, FUNC-062, FUNC-262
- [x] Add `FunctionsHostClient` for the host admin API: remote (master key
  from `listHostKeys`) and local (`http://localhost:<port>`). Used by execute,
  local listing, and host readiness. <- FUNC-263
- [x] Add `LogsQueryClient` (Application Insights / Log Analytics query) for
  log streaming. <- FUNC-065
- [x] Unit tests with `MockHttpClient` through each client's `create()`
  options.

### Slice 0 contracts and verified sources

- `FunctionsHostClient` takes either a loopback port or an HTTPS origin and
  lazy master-key callback. Remote callers obtain the key through
  `IWebAppClient.webApps.listHostKeys`; the client sends it in
  `x-functions-key` and rejects redirects. Function listing, status, and
  invocation follow the host's
  [FunctionsController](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Controllers/FunctionsController.cs),
  [HostController](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Controllers/HostController.cs),
  and [FunctionMetadataResponse](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Models/FunctionMetadataResponse.cs).
  Invocation acceptance is HTTP 202, not completion of function execution.
- Web App operations reuse the installed `@azure/arm-appservice` v19
  modular SDK. Its [Web Apps API](https://learn.microsoft.com/javascript/api/@azure/arm-appservice/webapps?view=azure-node-latest)
  covers lifecycle, function listing/deletion, and key/secret operations.
  Paged function listings use `toPages`.
- `LogsQueryClient` exposes
  [resource-context queries](https://learn.microsoft.com/azure/azure-monitor/logs/api/azure-resource-queries)
  and [workspace queries](https://learn.microsoft.com/azure/azure-monitor/logs/api/request-format)
  through the shared REST pipeline and the subscription's
  `logAnalyticsEndpoint`. It preserves table schemas and JSON cells and
  rejects malformed responses and
  [partial query errors](https://learn.microsoft.com/azure/azure-monitor/logs/api/response-format).
- Both client factories are registered lazily by `registerFunctions`.
  This slice supplies contracts for subsequent tree, command, and debugging
  slices; it contributes no new user commands or activation events.

## Slice 1 -- Remote tree

```
Pattern:        DataProvider + ViewProvider; virtual children under the ARM resource
Target files:   extensions/vscode-azure/src/tree/resources/webApp/FunctionAppDataProvider.ts (before WebAppDataProvider)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionAppViewProvider.ts (new, before WebAppViewProvider)
                extensions/vscode-azure/src/products/registerFunctions.ts (register)
Precedent:      StaticWebAppDataProvider / StaticWebAppViewProvider (virtual children, explicit invalid nodes)
Sweep:          reused getSettingsNodes + WebAppSettingsAdapter, setWebsiteUrl, createGenericResourceTreeItem,
                AzureNodeId, IAzureViewDataTree, RefreshResourcesView, ResourceSelector, resource listing/enrich,
                collectPages, pagesOf, rejectingAsyncIterable, createMockHierarchicalDataItemTree,
                createMockWebAppClient (additive Site overrides), makeSettingsResource, makeVirtualResource.
                Searched "invalid", "errorNode", "createErrorItem" in tree/ -> follow the SWA explicit-invalid pattern.
                Searched "makeFunction", "functionEnvelope", "httpTrigger" in testing -> no remote metadata
                factory; added makeFunctionEnvelope to the azutils testing barrel and remote tree fixtures
                alongside the extension's Web App tests.
Activation:     none (existing resources view)
External facts: Flex detection by site.functionAppConfig and HTTP auth-level normalization verified against
                the pinned source's ResolvedFunctionAppResource.ts and funcConfig/function.ts (links below).
                Shared refresh remains global for both title and context menus: VS Code forwards the focused
                tree element to title actions, so a key alone cannot distinguish those entry points.
Tree contract:  Function App node: resourceContextValue plus product, reported running/stopped, Flex, and
                  RefreshResourcesView.ContextValue markers. Shared settings remain a separate child.
                Functions group node: RefreshResourcesView.ContextValue only.
                Remote function node: enabled/disabled markers plus RefreshResourcesView.ContextValue;
                  trigger and HTTP access level retained in the model and presentation.
                Invalid function / invalid app nodes: RefreshResourcesView.ContextValue only, error tooltip.
                Command capability context values and menus for start/stop/restart, execute/copy URL,
                  enable/disable/delete, logs, and identity are wired with their commands in Slice 2.
```

Source contracts:
[site state and Flex](https://github.com/microsoft/vscode-azurefunctions/blob/801689c66f96b31bc9d7c79ff6cc8d65e41b6965/src/tree/ResolvedFunctionAppResource.ts),
[trigger, disabled flag and HTTP authentication](https://github.com/microsoft/vscode-azurefunctions/blob/801689c66f96b31bc9d7c79ff6cc8d65e41b6965/src/funcConfig/function.ts).
[VS Code title argument conversion](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostTreeViews.ts)
provides the focused element for a tree-view pane argument.

- [x] Function App children: shared settings node, then a "Functions" group
  node (virtual resource) listing one node per function.
  <- FUNC-166, FUNC-168, FUNC-169, FUNC-173
- [x] Function App description shows state (stopped) and Flex; context values
  reflect running/stopped. <- FUNC-166
- [x] Explicit invalid nodes for a function or app that cannot be read,
  carrying the error. <- FUNC-170, FUNC-180
- [x] Wire shared refresh, listing, enrichment, and resource picking on the
  new nodes; no Functions-specific equivalents. <- FUNC-199, FUNC-200, FUNC-271
- [x] Behavioral tests with shared resource, client, and tree fixtures; real
  `DataItemTree` error recovery; shared refresh/menu consistency.

## Slice 2 -- Remote commands

```
Pattern:        @injectable() ManagedCommand with static ContextValue; shared commands consume node context values
Target files:   extensions/vscode-azure/src/commands/webApp/WebAppLifecycle.ts (action-prefix aliases shared by all
                  Microsoft.Web/sites kinds; ids vscode-azure/webApp/{start,stop,restart})
                extensions/vscode-azure/src/commands/functions/{ExecuteFunction,CopyFunctionUrl,SetFunctionState,
                  DeleteFunction,StreamFunctionLogs,RevealFunctionAppIdentity}.ts (bool-prefix enable/disable aliases)
                extensions/vscode-azure/src/commands/tree/RevealResource.ts (new shared, id vscode-azure/resources/reveal)
                extensions/vscode-azure/src/utils/BufferedPseudoterminal.ts (shared ACA/Functions pseudoterminal)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionAppLogStream.ts (query-session owner)
Precedent:      DeleteStaticWebAppEnvironment (virtual-node command + activity), BrowseWebsite (shared node capability)
Sweep:          reused DeleteAzureResource, BrowseWebsite, ViewProperties, EditSettings + WebAppSettingsAdapter
                (enable/disable writes AzureWebJobs.<name>.Disabled through it), OpenInPortal, ExternalError (#350),
                IActionExecutor, ResourceSelector, AzureNodeId.forRelatedResource, abortable delay, CaselessMap.
                Reused ACA's pseudoterminal via BufferedPseudoterminal and related-resource navigation via RevealResource;
                ACA consumes both shared primitives. Reused mock entity factories, MockHttpClient, ManualTimers,
                respondToPrompts, real listing/activity services. Promoted ACA's terminal fixture to MockTerminal in
                the utils testing barrel. Searched live generic-resource reads: added ResourceClient.resources.getById
                using its existing provider API-version resolution. Searched instrumentation-key parsing and
                Application Insights discovery: none exists; the product log service owns those operations.
Activation:     none
External facts: Verified disable setting, host acceptance/master-key header, connection-string grammar, resource queries,
                workspace/classic table names, ingestion delay, and approximate ingestion ordering against the sources below.
Tree contract:  per Slice 1; menu entries in view/item/context with word-boundary regexes.
```

- [x] Start, stop, and restart as shared `Microsoft.Web/sites` commands.
  <- FUNC-060, FUNC-061, FUNC-062
- [x] Execute a function (remote via the host admin API; request body prompt
  for non-HTTP triggers). <- FUNC-041
- [x] Copy function URL (with function key when the auth level requires it).
  <- FUNC-042
- [x] Enable / disable a function through the shared app-settings adapter.
  <- FUNC-043, FUNC-044
- [x] Delete a remote function, reported in the activity tree. <- FUNC-045
- [x] Stream logs: shared `BufferedPseudoterminal` polling `LogsQueryClient` for
  the app's Application Insights resource (resolved from
  `APPLICATIONINSIGHTS_CONNECTION_STRING`); closing the terminal stops polling.
  Container Apps also uses the shared terminal. <- FUNC-065
- [x] Reveal the identity a Function App uses: shared `RevealResource` that
  reveals a resource by ARM ID in the resources view. <- FUNC-171
- [x] Wire shared delete, browse, and properties on the Function App node, and
  shared settings add/edit/rename/delete through the settings document.
  <- FUNC-059, FUNC-063, FUNC-064, FUNC-072, FUNC-075, FUNC-076, FUNC-077
- [x] Manifest entries (commands, `view/item/context`) + `package.nls.json`
  strings. The commands are also available from the Command Palette, where
  `ResourceSelector` prompts for the target function or Function App.
- [x] Unit tests per command with `createMockCodeContext()` and real
  `ActionExecutor`.

Slice 2 external contract sources:

- [Disable and enable Functions](https://learn.microsoft.com/en-us/azure/azure-functions/disable-function).
- [Host admin invocation](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Controllers/FunctionsController.cs)
  and [manual invocation](https://learn.microsoft.com/en-us/azure/azure-functions/functions-manually-run-non-http).
- [Application Insights connection strings](https://learn.microsoft.com/en-us/azure/azure-monitor/app/connection-strings).
- [Resource-context queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/azure-resource-queries),
  [AppTraces](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apptraces),
  [AppRequests](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apprequests),
  and [standard log columns](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-standard-columns).
- [Functions telemetry and ingestion delay](https://learn.microsoft.com/en-us/azure/azure-functions/analyze-telemetry-data)
  and [approximate ingestion-time ordering](https://learn.microsoft.com/en-us/kusto/query/ingestion-time-function?view=azure-monitor).

## Slice 3 -- Workspace tree (local functions)

```
Pattern:        WorkspaceDetector tags + workspace DataProvider/ViewProvider
Target files:   extensions/vscode-azure/src/tree/workspace/functions/{FunctionsWorkspaceDataProvider,
                  FunctionsWorkspaceViewProvider}.ts (extend); tree/workspace/WorkspaceNode.ts (local function node)
                extensions/vscode-azure/src/functions/{FunctionsProjectReader,LocalFunctionSettings,LocalFunctionTarget}.ts
                extensions/vscode-azure/src/functions/host/LocalFunctionsHostTracker.ts
Precedent:      FunctionsWorkspaceDataProvider (project nodes), AZD workspace provider
Sweep:          reused IWorkspaceIndexService (its FileSystemWatcher drives refresh), functionsDetector, createTag,
                RevealInExplorer, RefreshWorkspaceView, readText, dirname/basename/relativePath, JsoncSettingsFormat,
                jsonc-parser edits, isFunctionTriggerBinding, FunctionsHostClient, and Slice 2 command aliases.
                Tests reuse createMockCodeContext, createTestActionExecutor, ManualDebounceScheduler,
                createMockFunctionsHostClient, makeFunctionsProjectNode, and the real index/DataItemTree.
                Searched local listing and host ownership: no shared implementations.
                Product services keep those contracts outside providers; shared index exclusions stay intact.
Activation:     none (existing workspace index; no workspaceContains event)
External facts: verified host invocation templates and local settings against the sources linked below.
Tree contract:  Local project node: revealInExplorer, refreshWorkspace (invalid: refresh only).
                Local function node: executeFunction (ready registered host), copyFunctionUrl (HTTP; ready host),
                enableFunction|disableFunction, refreshWorkspace, revealInExplorer when a source URI is available.
                Hint and invalid nodes: no actions except refresh.
```

**Action dependencies approved by the reviewer:** Slice 4 owns initialization
and debugging; creation/welcome actions are deferred with Slice 5.
Missing-runtime state offers initialization. The process owner populates the ready-host registration
after HTTP readiness and releases it when the host stops.

- [x] List functions directly under the project node (no group node) from the
  running host's `/admin/functions`. Closes
  [#178](https://github.com/microsoft/vscode-azure/issues/178). A Core Tools
  function-list command has been requested in
  [Azure/azure-functions-core-tools#5344](https://github.com/Azure/azure-functions-core-tools/issues/5344).
  <- FUNC-182, FUNC-184, FUNC-185
- [x] Hint node: "Start debugging to list functions..." while no host is
  ready. <- FUNC-187, FUNC-188
- [x] Invalid local function and invalid local project nodes. <- FUNC-186, FUNC-191
- [x] Missing-worker-runtime project state; initialization action is tracked
  in Slice 4. <- FUNC-190 (presentation)
- [x] Refresh on local settings changes and host start/stop through the
  workspace index watcher and host tracking events. <- FUNC-198
- [x] Local execute / copy URL / enable / disable reuse the Slice 2 commands
  against `FunctionsHostClient` (local) and `local.settings.json` values.
  <- FUNC-041, FUNC-042, FUNC-043, FUNC-044
- [x] Unit/integration tests with shared fixtures and the real workspace
  index/tree, including remote-command regression coverage and contribution
  consistency checks.

The listing contract is documented in
[the product contract](../../products/functions.md#local-workspace-tree).
No guessed port, source-language parser, settings
synchronization, or local settings tree is contributed.

Verified external contracts:

- [Host metadata response and invocation template](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Models/FunctionMetadataResponse.cs).
- [Local settings structure](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local#local-settings-file)
  and [function disable flags](https://learn.microsoft.com/en-us/azure/azure-functions/disable-function).

## Slice 4 -- Local development (F5)

A contributed debug type resolves to the language debugger's attach
configuration after the extension has validated the project and started an owned
Core Tools host. Core Tools owns ordinary builds and dependency restoration;
the extension owns Go's debug build. Resolving to a different debug type is proven in the Container Tools
extension. Debugging works with no `tasks.json` or `launch.json`, and neither
is generated. No and no task type, problem matcher, or process-pick
command is contributed.

```
Pattern:        contributed `azure-functions` debugger (launch request, no adapter) whose DebugConfigurationProvider
                (Initial + Dynamic) validates, starts the host, and returns a config of the language's debug type
Target files:   extensions/vscode-azure/src/functions/debug/* (debug configuration provider, per-language attach configs)
                extensions/vscode-azure/src/functions/host/* (host process, host tracking, pre-debug validation)
Precedent:      Container Tools debug providers (resolve to another debug type); tools/FuncInstaller + ToolService (Core
                Tools discovery). SWA debugging builds on this (#339).
Sweep:          reused IProcessExecutor (packages/utils), createShellTask (packages/utils), ToolService/FuncInstaller,
                IWorkspaceIndexService, LocalFunctionSettings, JsoncSettingsFormat, ExternalError,
                createMockCodeContext/createMockVsCode, respondToPrompts, and the shared Functions index/tree fixtures.
                Extended shared process execution with opt-in tree-kill cancellation and foreground resolver injection;
                extracted createMockSpawn/createMockProcessExecutor and reused getMockTaskExecution.
                Searched
                "registerDebugConfigurationProvider", "DebugConfigurationProviderTriggerKind", "onDidTerminateDebugSession",
                "CustomExecution": none exist -> new product code under functions/debug and functions/host.
Activation:     only the implicit events VS Code generates for a contributed `debuggers` entry; justify any explicit
                onDebug* entry in this record before adding it.
External facts: verified VS Code provider ordering against 7f1c8a96ce99bcffba134a7db3ef9b1f57d30ca0;
                Core Tools v5 host arguments/PID output against preview.3 (f8f54ba328758b2165d835930e391af23e60f090);
                Python environment public API and selected virtual environment via VIRTUAL_ENV;
                Python Debugger launcher/path public API against 061023c85cf721731569c2d0d670c129fc1f45c4.
                Native Go uses the Go extension's public tool API, Core Tools v5 Go worker workload
                and GoFunctionsProject, and headless Delve's remote DAP protocol.
                Source links and per-language prerequisites are in docs/products/functions.md.
```

Resolution flow for one session:

1. The initial hook normalizes the configuration; VS Code substitutes variables
   and runs any configured `preLaunchTask`. The substituted-variable hook picks
   the Functions project from the workspace index (remembered per workspace
   when a folder has several).
2. Pre-debug validation; failures are `ExternalError`s.
3. Build Go with optimizations and inlining disabled in a visible task, unless
   `skipBuild` or a replacement `preLaunchTask` applies.
4. Start `func run <project> --no-azurite` in an in-code
   pseudoterminal task with the worker debug arguments in its environment and
   a free debug port. Use JSON output for .NET isolated PID discovery and plain
   output for other workers. Core Tools owns ordinary builds and dependency
   restoration; pass `--no-build` for Go or when a build override applies.
5. Wait for worker attach coordinates, bounded to five minutes when Core Tools
   owns the build and two minutes when compilation is skipped. Paused workers
   attach before full HTTP readiness; poll HTTP independently and register the
   owned host only after its status is Running.
6. Return the attach configuration of the language's debug type; stop the host
   on attach failure, session end, task/terminal closure, or cancellation.

- [x] Contribute the `azure-functions` debugger (languages for the kept
  runtimes) and register its provider for initial and dynamic configurations,
  so projects appear in the Run and Debug dropdown with no `launch.json`.
  <- FUNC-030
- [x] `initProjectForVSCode` writes no `tasks.json` and no project
  configuration in VS Code settings; it writes non-debug workspace files such
  as `.vscode/extensions.json` recommendations. <- FUNC-030
- [x] Wire the local project initialization action and its initialization
  state to the implemented initialization flow. <- FUNC-190
- [x] Attach configurations for Node, Python (via the Python extension's
  launcher), Java, and PowerShell, with free debug ports.
  <- FUNC-210, FUNC-211, FUNC-212, FUNC-214, FUNC-268
- [x] .NET isolated attach using the worker PID reported by
  `--dotnet-isolated-debug`, instead of a process picker.
  <- FUNC-033, FUNC-269
- [x] Native Go debugging: validate Go 1.24+ and Delve using the Go extension's
  resource-scoped public tool API; compile `bin/app` (`app.exe` on Windows)
  with `-gcflags=all=-N -l`, and start the native worker under headless Delve.
  Reuse worker executable/argument overrides, loopback debugger transport,
  and owned-host readiness/process-tree cleanup. Return a Go remote DAP attach config;
  custom handlers are excluded. Wire Go recommendations, native-runtime
  initialization, and debugger language contribution.
  <- FUNC-140, FUNC-141, FUNC-195
- [x] Go behavioral coverage: prerequisites/build errors, paths with spaces,
  skipped builds, loopback attach, readiness failure/cancellation/cleanup, and
  initialization. Live Go attach smoke check remains part
  of Slice 7. <- FUNC-140, FUNC-141, FUNC-195
- [x] Host process and tracking: build steps, start, readiness, port, terminal
  errors, stop on session end, and start/stop events for local listing and
  execute. <- FUNC-216
- [x] Pre-debug validation: Core Tools present, `FUNCTIONS_WORKER_RUNTIME`,
  `AzureWebJobsStorage` / emulator reachable. <- FUNC-215
- [x] Wire shared Core Tools install/update and version checks; no
  activation-time prompts. <- FUNC-021, FUNC-031, FUNC-217
- [x] Unit tests for configuration resolution, build preparation, host tracking,
  cancellation, and readiness failures; initialization integration tests against
  the real index/tree; shared integration test terminating a real parent/worker
  process tree.
- [ ] Live language attach-path smoke checks during Slice 7. The automated tests
  cover all six configuration/API paths, not live language debugger sessions.

Live Core Tools v5 workload startup, language debugger sessions,
storage/emulator integration, and Linux/macOS smoke checks remain in Slice 7.

Existing projects' source-generated `tasks.json` / `launch.json` (task type
`func`, `$func-watch`, `${command:azureFunctions.pickProcess}`) are left
untouched: no compatibility registrations and no rewrite prompt. Users delete
them or re-initialize.

## Slice 5 -- Project and function scaffolding (deferred)

Tracking: [#364](https://github.com/microsoft/vscode-azure/issues/364).

Project creation (`func init`), add-function (`func new`), and gallery-backed
quickstarts (`func quickstart`) are outside the active migration scope.
The dependent language flows, template requirements/post-create integration,
and create-project welcome action are tracked under
[Deferred](#deferred----tracked-not-built).

Future integration uses thin `ManagedCommand` entry points and shared
`ToolService` / `IProcessExecutor` services. CLI v5 owns catalogs, requirements,
validation, generated files, dependencies, and project configuration; the
extension owns folder selection, editor integration, cancellation/errors, and
preserving user-owned files. Scaffolding workload capabilities require
verification independently of the Core Tools v5 F5 contract. Shared tool support
(FUNC-021, FUNC-031, FUNC-217), local-only gates (FUNC-004), and initialization
of existing projects (FUNC-030, FUNC-190) remain in scope.

Before future implementation, verify distributed CLI v5/workload versions,
language support, machine-readable discovery, noninteractive prompts, result
shapes, and compatibility with runtime v4 F5 and azd deployment.
Source evidence is Azure/azure-functions-core-tools at
`a0bdc299fa685fa530236c108f4715977c96a8f2` (`InitCommand.cs`, `NewCommand.cs`,
`QuickstartCommand.cs`, `QuickstartManifestOptions.cs`,
`JavaProjectInitializer.cs`); source support does not prove packaged availability.

## Slice 6 -- Creation (azd + Bicep)

```
Pattern:        Wizard + AzdJob (createNew), shared azd steps, GenerateBicepStep
Target files:   extensions/vscode-azure/src/commands/functions/CreateFunctionApp.ts + steps/
                extensions/vscode-azure/resources/templates/functionApp/main.bicep
Precedent:      existing CreateFunctionApp, SWA creation
Sweep:          reused SelectIacFolderStep, HydrateAzdInfo, HydratableChooseSubscription/Location, ProjectName,
                PickRuntimeStep, ConfirmProvision, GenerateBicepStep, GenerateAzureYaml, CreateAzdEnv, AzdProvisionStep,
                activity tree (CodeDeploymentDataProvider), DeleteAzureResource, ExternalError, IWebAppClientProvider,
                parseAzureResourceId, ISubscriptionResolver, OpenUrl.
Activation:     none
External facts: azd service lookup by `azd-service-name` tag, verified against the azure.yaml v1.0 schema
                (`services.*.resourceName` description) on 2026-09-24; pattern-module parameters/outputs per the
                provisioning decision below. The azd show contract in cli/azd/pkg/contracts/show.go verifies
                services.*.target.resourceIds.
Wizard:         SelectIacFolder -> HydrateAzdInfo -> subscription -> location -> ProjectName -> PickRuntime -> ConfirmProvision; execute GenerateBicep -> GenerateAzureYaml ->
                CreateAzdEnv -> AzdProvision. No hosting-plan,
                authentication, or Flex sizing prompts: Flex FC1, managed identity, and module defaults answer them.
```

- [x] Close creation gaps against the source flow; no advanced/existing-
  resource variant. <- FUNC-057
- [x] Provisioning fixes the module's `appServicePlanSkuName` to FC1.
  `GenerateBicepStep` writes only runtime, version, and service-name parameters.
  <- FUNC-241 (FC1 from the existing template default; Premium/App Service
  removal per FUNC-242)
- [x] Managed identity only: no secrets or connection strings, no prompt
  (the module's user-assigned identity and `AzureWebJobsStorage__credential`).
  <- FUNC-246
- [x] Flex instance memory / maximum instance count as module defaults, not
  prompts. <- FUNC-248
- [x] Provisioning topology through the function-app pattern module (see
  below). <- FUNC-249
- [x] Deleting a containerized Function App uses shared delete (applies once
  containerized apps return from Deferred). <- FUNC-258
- [x] Unit tests with `respondToPrompts()`; Bicep build of the consumer.

### Provisioning decision

The topology is a Function App plus its Flex Consumption plan, storage
account, Application Insights, Log Analytics workspace, user-assigned managed
identity, and role assignments, so a pattern module is required (a resource
module does not cover it).

- **Module:** `avm/ptn/app/function-app` from
  [Azure/bicep-registry-modules#7299](https://github.com/Azure/bicep-registry-modules/pull/7299)
  covers the whole topology: it creates the user-assigned identity
  (or accepts one), sets `AzureWebJobsStorage__credential = managedidentity`,
  disables local auth, and exposes `flexConsumptionInstanceMemoryMB` /
  `flexConsumptionMaximumInstanceCount` plus the name, resource ID, default
  hostname, and identity outputs.
- **Selected:** `br/public:avm/ptn/app/function-app:0.1.0`.
- **Parameter map:** `environmentName` -> `functionAppName` (`<env>-func`);
  wizard runtime -> `functionWorkerRuntime`, `runtimeVersion`; `azdServiceName`
  -> `functionAppTags['azd-service-name']`; `appServicePlanSkuName` fixed to
  `FC1`; the template specifies `autoGeneratedDomainNameLabelScope` and portal
  CORS.

- [x] Pin the published `br/public` module in the templates. <- FUNC-249

## Slice 7 -- Manifest, reuse wiring, and documentation

```
Pattern:        package.json contributions + package.nls.json; shared framework wiring
Target files:   extensions/vscode-azure/package.json, package.nls.json, docs/products/functions.md (new)
Sweep:          reused functionsDetector (project detection), framework error toasts (Report Issue), ConfigureCicd,
                existing jsonValidation block.
Activation:     none (jsonValidation and viewsWelcome add no activation events)
External facts: `https://json.schemastore.org/function.json` and `https://json.schemastore.org/host.json`, taken from
                the source manifest at the pinned SHA; both returned HTTP 200 on 2026-09-24.
```

- [x] `jsonValidation` for `function.json` and `host.json`. <- FUNC-008, FUNC-009
- [x] Trust and `!virtualWorkspace` enablement on dedicated local commands;
  workspace-menu gates and programmatic project validation on the shared
  local/remote function commands.
  <- FUNC-004
- [x] Project detection stays on `functionsDetector`; no
  `workspaceContains` activation. Core Tools v5 may make `host.json` optional;
  a machine-readable project-info command has been requested in
  [Azure/azure-functions-core-tools#5344](https://github.com/Azure/azure-functions-core-tools/issues/5344).
  <- FUNC-002
- [x] Report Issue stays on the framework error toast; user-actionable errors
  use `ExternalError`. <- FUNC-100
- [x] GitHub / CI/CD setup uses the existing `vscode-azure/configureCicd`
  (`azd pipeline config`); no Functions-specific command. <- FUNC-055
- [x] No Functions settings are contributed. Go and Delve validation are
  adapted as mandatory pre-debug checks without toggles; other source
  settings are Drop or Defer in [TRIAGE.md](TRIAGE.md). <- FUNC-140, FUNC-141
- [x] Product doc `docs/products/functions.md` (tree, commands, F5, creation,
  deploy constraints); framework docs get at most a link.
- [x] Full `pnpm run lint` / `build` / `test` sweep before the PR.

## Deferred -- tracked, not built

- [ ] Project/function scaffolding and gallery-backed quickstarts through
  CLI v5 `func init` / `func new` / `func quickstart`: create-project welcome
  content, JavaScript, TypeScript, Python environment/project creation,
  .NET isolated, Java (including add-function), PowerShell, custom handlers,
  and template requirements/post-create integration. <- FUNC-026, FUNC-028,
  FUNC-192, FUNC-218, FUNC-219, FUNC-220, FUNC-221, FUNC-223, FUNC-224,
  FUNC-225, FUNC-235, FUNC-236
- [ ] Deployment slots: deploy to slot, create/delete/swap, slot settings,
  slot tree nodes (Flex has no slots). <- FUNC-048, FUNC-069, FUNC-070, FUNC-071,
  FUNC-078, FUNC-178, FUNC-179
- [ ] Durable Task Scheduler and durable backends: scheduler/task hub commands
  and nodes, emulator commands/settings/nodes, DTS client, durable project
  configuration and connection prompts. Candidate for its own migration.
  <- FUNC-084, FUNC-085, FUNC-086, FUNC-087, FUNC-088, FUNC-089, FUNC-090,
  FUNC-091, FUNC-092, FUNC-093, FUNC-094, FUNC-108, FUNC-109, FUNC-110,
  FUNC-193, FUNC-194, FUNC-234, FUNC-237, FUNC-264, FUNC-270
- [ ] User-assigned identity management (assign/unassign, identity nodes);
  revealing the in-use identity ships in Slice 2. <- FUNC-081, FUNC-082, FUNC-172
- [ ] Containerized (Container Apps-hosted) Function Apps: Dockerfile
  projects, nodes, creation. Coordinate with the Container Apps migration.
  <- FUNC-027, FUNC-181, FUNC-250
- [ ] MCP project creation, key retrieval, and deployed server integration,
  tracked in [#361](https://github.com/microsoft/vscode-azure/issues/361).
  <- FUNC-101, FUNC-228, FUNC-254
- [ ] Host exceptions debugger view and its commands. <- FUNC-095, FUNC-096,
  FUNC-097, FUNC-098, FUNC-099, FUNC-196
- [ ] Revisit with Core Tools v5: stop host after debug, emulator validation,
  host start timeout. <- FUNC-137, FUNC-142, FUNC-144
- [ ] Storage emulator: storage connection prompts, Azurite settings and
  integration. <- FUNC-164, FUNC-176, FUNC-267
- [ ] Go scaffolding, tracked in
  [#364](https://github.com/microsoft/vscode-azure/issues/364), and native Go
  provisioning/runtime selection, tracked in
  [#366](https://github.com/microsoft/vscode-azure/issues/366).
  Code deployment uses the existing azd route.
  <- FUNC-226
- [ ] Template Gallery webview and resource-backed binding settings (with their SDKs),
  tracked in [#365](https://github.com/microsoft/vscode-azure/issues/365).
  <- FUNC-208, FUNC-240, FUNC-265

## Dropped -- recorded for parity

- Azure Resources host contracts, source-only plumbing, and the retiring
  Container Apps API: FUNC-001, FUNC-003, FUNC-005, FUNC-006, FUNC-018,
  FUNC-019, FUNC-023, FUNC-024, FUNC-025, FUNC-103.
- Exported extension API: FUNC-010, FUNC-011, FUNC-012, FUNC-013, FUNC-014,
  FUNC-015, FUNC-016, FUNC-017.
- Activation-time and cross-session scaffolding behavior: FUNC-020, FUNC-022.
- Local commands and helpers with no target: FUNC-029, FUNC-032, FUNC-034,
  FUNC-035, FUNC-036, FUNC-037, FUNC-038, FUNC-039, FUNC-040, FUNC-259,
  FUNC-260, FUNC-261.
- Functions-specific deploy command and its follow-ons (code deployment runs
  from an initialized azd project through the shared azd workflow), and
  runtime detection for the removed deploy path: FUNC-046, FUNC-047,
  FUNC-202, FUNC-247, FUNC-255, FUNC-256.
- Kudu, deployment-source, and non-azd deploy paths: FUNC-049, FUNC-050,
  FUNC-051, FUNC-052, FUNC-053, FUNC-054, FUNC-056, FUNC-066, FUNC-102,
  FUNC-174, FUNC-175, FUNC-177, FUNC-251, FUNC-252, FUNC-253, FUNC-257,
  FUNC-266.
- Creation variants beyond Flex with new resources: FUNC-058, FUNC-242,
  FUNC-243, FUNC-244, FUNC-245.
- Remote debugging: FUNC-067, FUNC-068, FUNC-121, FUNC-122.
- Task type, task provider, and problem matchers (host started in-process by
  the debug provider): FUNC-203, FUNC-204, FUNC-205, FUNC-206, FUNC-207.
- Settings sync, secrets, and system-assigned identity: FUNC-073, FUNC-074,
  FUNC-079, FUNC-080, FUNC-083, FUNC-183, FUNC-189.
- Agent metadata/deployment commands and MCP project setting: FUNC-007,
  FUNC-104, FUNC-105, FUNC-106, FUNC-107, FUNC-160.
- Source settings: FUNC-111, FUNC-112, FUNC-113, FUNC-114, FUNC-115,
  FUNC-116, FUNC-117, FUNC-118, FUNC-119, FUNC-120, FUNC-123, FUNC-124,
  FUNC-125, FUNC-126, FUNC-127, FUNC-128, FUNC-129, FUNC-130, FUNC-131,
  FUNC-132, FUNC-133, FUNC-134, FUNC-135, FUNC-136, FUNC-138, FUNC-139,
  FUNC-143, FUNC-145, FUNC-146, FUNC-147, FUNC-148, FUNC-149, FUNC-150,
  FUNC-151, FUNC-152, FUNC-153, FUNC-154, FUNC-155, FUNC-156, FUNC-157,
  FUNC-161, FUNC-162, FUNC-163, FUNC-165.
- Tree and manifest leftovers: FUNC-167, FUNC-197, FUNC-201.
- Open from portal: FUNC-209.
- Languages, programming models, and runtimes out of scope (v4 only):
  FUNC-158, FUNC-159, FUNC-213, FUNC-222, FUNC-227, FUNC-229, FUNC-230,
  FUNC-231, FUNC-233.
- Source template subsystem and non-DTS durable backends: FUNC-232,
  FUNC-238, FUNC-239.

## Drift log

| Date | Rebased onto | Swept result |
|---|---|---|
| 2026-09-24 | `dfc8edaf` (#350) | Adopt `ExternalError` (`packages/utils`) for user-actionable failures in Slices 2, 4, and 6 (missing Core Tools, pre-debug validation). No other new shared surfaces; no slices landed yet. |
| 2026-10-08 | `8993a3c1` | Slice 0 intake sweep: reuse the shared data-plane REST factory and cloud-aware Log Analytics endpoint. Container Apps already owns its log-stream pseudoterminal; inspect that implementation before Slice 2 instead of assuming a terminal primitive is absent. |

## Parity and wiring audit -- 2026-10-12

The three process artifacts are tracked. Their initial commit, `47de2cb4`,
precedes the provisioning update (`6d8e60e2`) and implementation slices.
All 271 IDs and inventory feature names match the original triage catalog;
approved disposition changes are reflected in the signed current triage.
The inventory's command, settings, tree, debug, wizard, and integration
families are covered by that catalog.

| Signed disposition | IDs | Audited outcome |
|---|---:|---|
| Migrate | 24 | Landed and wired |
| Adapt | 22 | Landed with the approved target behavior |
| Reuse | 19 | 18 wired; one conditional shared capability (`FUNC-258`) |
| Drop | 142 | Source-specific feature absent; exact ID partition recorded under Dropped |
| Defer | 64 | Exact ID partition tracked under Deferred |
| Total | 271 | No missing or duplicate IDs |

This is implementation and wiring coverage, not live debugger certification.
The live attach-path checkbox in Slice 4 remains open and user-owned.
The full repository pre-PR lint/build/test results are recorded below.

### Kept-feature evidence

Paths below are relative to `extensions/vscode-azure/src/`, unless prefixed
with `packages/` or explicitly described as an extension manifest.
Registration is in `products/registerFunctions.ts`, shared command
registration in `commands/registerCommands.ts`, and tree composition in
`tree/registerTrees.ts`.

| ID | Feature | Signed disposition | Outcome | Evidence |
|---|---|---|---|---|
| FUNC-002 | Project detection | Reuse | Wired | `functions/functionsDetector.ts`: `functionsDetector`; `utils/workspaceIndex/WorkspaceIndexService.ts` |
| FUNC-004 | Local workspace gates | Migrate | Landed | Extension `package.json` enablement/menu gates; `functions/FunctionsProjectSelector.ts`: `assertLocal`; `functions/LocalFunctionTarget.ts` |
| FUNC-008 | Function schema | Migrate | Landed | Extension `package.json`: `jsonValidation` for `function.json` |
| FUNC-009 | Host schema | Migrate | Landed | Extension `package.json`: `jsonValidation` for `host.json` |
| FUNC-021 | Core Tools version checks | Reuse | Wired on demand | `tools/ToolService.ts`, `tools/FuncInstaller.ts`; debug preparation requires v5 preview.3 or later |
| FUNC-030 | Existing-project initialization | Adapt | Landed without generated tasks | `commands/functions/InitializeFunctionsProject.ts`; worker-runtime selection and extension recommendations |
| FUNC-031 | Install/update Core Tools | Reuse | Wired | `commands/registerCommands.ts`: `vscode-azure/installFunc` -> `AcquireTool`; `extension.ts`: `FuncInstaller` binding |
| FUNC-033 | .NET process selection | Adapt | Landed inside owned F5 | `functions/host/LocalFunctionsHostProcess.ts`; `functions/debug/FunctionsDebugProvider.ts` |
| FUNC-041 | Execute function | Migrate | Landed locally and remotely | `commands/functions/ExecuteFunction.ts`; `functions/LocalFunctionTarget.ts` |
| FUNC-042 | Copy function URL | Migrate | Landed locally and remotely | `commands/functions/CopyFunctionUrl.ts`; current host/management metadata and access checks |
| FUNC-043 | Enable function | Migrate | Landed locally and remotely | `commands/functions/SetFunctionState.ts`; registration prefix argument `false` |
| FUNC-044 | Disable function | Migrate | Landed locally and remotely | `commands/functions/SetFunctionState.ts`; registration prefix argument `true` |
| FUNC-045 | Delete function | Migrate | Landed remotely | `commands/functions/DeleteFunction.ts`; confirmation, activity, and success-only cache removal |
| FUNC-055 | GitHub/CI/CD setup | Reuse | Wired through azd | `commands/deploy/ConfigureCicd.ts`; `azd/wizard/AzdPipelineConfigStep.ts` |
| FUNC-057 | Create Function App | Adapt | Landed through azd+Bicep | `commands/functions/CreateFunctionApp.ts`; `createNew` registration prefix argument |
| FUNC-059 | Delete Function App | Reuse | Wired | `commands/tree/DeleteAzureResource.ts`; `tree/contextValueHelpers.ts`: `resourceContextValue` |
| FUNC-060 | Start app | Migrate | Landed as shared Web App action | `commands/webApp/WebAppLifecycle.ts`; registration prefix argument `start` |
| FUNC-061 | Stop app | Migrate | Landed as shared Web App action | `commands/webApp/WebAppLifecycle.ts`; registration prefix argument `stop` |
| FUNC-062 | Restart app | Migrate | Landed as shared Web App action | `commands/webApp/WebAppLifecycle.ts`; registration prefix argument `restart` |
| FUNC-063 | Browse website | Reuse | Wired | `commands/tree/BrowseWebsite.ts`; enriched URL drives `resourceContextValue` |
| FUNC-064 | View properties | Reuse | Wired | `commands/tree/ViewProperties.ts`; `resourceContextValue` |
| FUNC-065 | Stream logs | Adapt | Landed as cancellable polling terminal | `commands/functions/StreamFunctionLogs.ts`, `tree/resources/webApp/FunctionAppLogStream.ts`; shared `utils/BufferedPseudoterminal.ts` |
| FUNC-072 | Add app setting | Reuse | Wired through JSONC editor | `settings/adapters/WebAppSettingsAdapter.ts`; shared `commands/settings/EditSettings.ts` |
| FUNC-075 | Edit app setting | Reuse | Wired through JSONC editor | `settings/adapters/WebAppSettingsAdapter.ts`; shared `SettingsFileSystemProvider` |
| FUNC-076 | Rename app setting | Reuse | Wired through JSONC editor | `settings/adapters/WebAppSettingsAdapter.ts`; shared JSONC document read-modify-write |
| FUNC-077 | Delete app setting | Reuse | Wired through JSONC editor | `settings/adapters/WebAppSettingsAdapter.ts`; shared JSONC document read-modify-write |
| FUNC-100 | Report Issue | Reuse | Wired through framework errors | `packages/utils/src/base/IActionExecutor.ts`: `ActionExecutor.showErrorToast`; `ExternalError` suppresses the issue action |
| FUNC-140 | Delve validation | Adapt | Landed without a setting | `functions/debug/FunctionsDebugPreparation.ts`: native worker validation |
| FUNC-141 | Go validation | Adapt | Landed without a setting | `functions/debug/FunctionsDebugPreparation.ts`: Go version validation |
| FUNC-166 | Function App node/state/Flex | Migrate | Landed | `tree/resources/webApp/FunctionAppViewProvider.ts`; `FunctionAppDataProvider` enrichment |
| FUNC-168 | Remote Functions group | Migrate | Landed beside settings | `tree/resources/webApp/FunctionAppDataProvider.ts`, `FunctionAppViewProvider.ts` |
| FUNC-169 | Remote function leaf | Migrate | Landed | `tree/resources/webApp/FunctionApp.ts`, `FunctionAppViewProvider.ts`; trigger/access/state capabilities |
| FUNC-170 | Invalid remote function | Migrate | Landed | `tree/resources/webApp/FunctionAppDataProvider.ts`, `FunctionAppViewProvider.ts`; refresh-only errors |
| FUNC-171 | Reveal attached identity | Adapt | Landed as navigation | `commands/functions/RevealFunctionAppIdentity.ts` -> shared `RevealResource` |
| FUNC-173 | App settings nodes | Reuse | Wired | `tree/resources/webApp/FunctionAppDataProvider.ts`: `getSettingsNodes`; `products/registerSettings.ts` |
| FUNC-180 | Invalid Function App | Migrate | Landed | `tree/resources/webApp/FunctionAppDataProvider.ts`: site errors; `FunctionAppViewProvider.ts`: invalid presentation |
| FUNC-182 | Local project node | Migrate | Landed | `tree/workspace/functions/FunctionsWorkspaceDataProvider.ts`, `FunctionsWorkspaceViewProvider.ts` |
| FUNC-184 | Local Functions grouping | Adapt | Landed as direct project children | `functions/FunctionsProjectReader.ts`; `FunctionsWorkspaceViewProvider.getChildren` |
| FUNC-185 | Local function leaf | Migrate | Landed | `functions/FunctionsProjectReader.ts`; `FunctionsWorkspaceViewProvider.ts` |
| FUNC-186 | Invalid local function | Migrate | Landed | `functions/FunctionsProjectReader.ts`; invalid metadata nodes rendered with refresh |
| FUNC-187 | No-host listing hint | Adapt | Landed | `functions/FunctionsProjectReader.ts`; "Start debugging to list functions..." |
| FUNC-188 | Host-listing hint | Migrate | Landed | `functions/FunctionsProjectReader.ts`; host-backed runtime metadata |
| FUNC-190 | Initialize-project offer | Adapt | Landed as project action | `FunctionsWorkspaceViewProvider.ts` under `tree/workspace/functions/`; `InitializeFunctionsProject.ts` under `commands/functions/` |
| FUNC-191 | Invalid local project | Migrate | Landed | `functions/FunctionsProjectReader.ts`; `FunctionsWorkspaceViewProvider.ts` under `tree/workspace/functions/` |
| FUNC-195 | Native Go F5 | Adapt | Landed; live VS Code checks pending | `functions/debug/FunctionsDebugPreparation.ts`, `FunctionsDebugProvider.ts`; owned Delve and cleanup |
| FUNC-198 | Local tree refresh | Migrate | Landed | `FunctionsWorkspaceDataProvider.ts` under `tree/workspace/functions/`; shared index, local settings, host events |
| FUNC-199 | Resource pickers | Reuse | Wired | `tree/resources/ResourceSelector.ts`: `IResourceSelector`; remote commands inject the shared selector |
| FUNC-200 | Resource listing/site cache | Reuse | Wired | `tree/resources/AzureResourceDataProvider.ts`; `FunctionAppDataProvider` enrichment and shared data-tree cache |
| FUNC-210 | Node F5 | Adapt | Landed; live checks pending | `functions/debug/FunctionsDebugPreparation.ts`, `FunctionsDebugProvider.ts`; JS/TS attach |
| FUNC-211 | Python F5 | Adapt | Landed; live checks pending | `functions/debug/FunctionsDebugPreparation.ts`, `FunctionsDebugProvider.ts`; owning Python/debugpy APIs |
| FUNC-212 | Java F5 | Adapt | Landed; live checks pending | `functions/debug/FunctionsDebugPreparation.ts`, `FunctionsDebugProvider.ts`; staged Maven output |
| FUNC-214 | PowerShell F5 | Adapt | Landed; live checks pending | `functions/debug/FunctionsDebugPreparation.ts`, `FunctionsDebugProvider.ts`; worker pipe attach |
| FUNC-215 | Pre-debug validation | Adapt | Landed as retained subset | `functions/debug/FunctionsDebugPreparation.ts`; trust, runtime, tools, storage configuration, default Azurite endpoint checks |
| FUNC-216 | Host lifecycle tracking | Adapt | Landed without tasks | `functions/host/LocalFunctionsHostProcess.ts`, `LocalFunctionsHostTracker.ts`; readiness, ports, cancellation, cleanup |
| FUNC-217 | Core Tools lifecycle | Reuse | Wired on demand | `tools/ToolService.ts`, `tools/FuncInstaller.ts`; shared v5 acquisition for F5 |
| FUNC-241 | Flex Consumption | Reuse | Wired in provisioning template | Extension `resources/templates/functionApp/main.bicep`: FC1 |
| FUNC-246 | Storage authentication | Adapt | Landed as managed identity default | Extension `resources/templates/functionApp/main.bicep`; pinned AVM pattern owns identity and roles |
| FUNC-248 | Flex scale/memory options | Adapt | Landed as Bicep parameters | Extension `resources/templates/functionApp/main.bicep`; no additional wizard prompt |
| FUNC-249 | Provisioning topology | Adapt | Landed through pinned AVM pattern | Extension `resources/templates/functionApp/main.bicep`: `br/public:avm/ptn/app/function-app:0.1.0` |
| FUNC-258 | Containerized-app deletion | Reuse | Shared capability available; product integration deferred | `commands/tree/DeleteAzureResource.ts`; containerized Functions nodes remain deferred under FUNC-181/FUNC-250 |
| FUNC-262 | Web Apps SDK surface | Migrate | Landed and injected | `packages/azutils/src/rest/clients/WebAppClient.ts`; factory binding in `products/registerFunctions.ts` |
| FUNC-263 | Host admin API | Migrate | Landed and injected | `packages/azutils/src/rest/clients/FunctionsHostClient.ts`; factory binding and local host tracking |
| FUNC-268 | Python extension launcher | Adapt | Landed | `functions/debug/FunctionsDebugPreparation.ts`; debugger-owned launcher and package resolution |
| FUNC-269 | Worker process selection | Adapt | Landed through shared process execution | `functions/host/LocalFunctionsHostProcess.ts`; `packages/utils/src/base/IProcessExecutor.ts` |
| FUNC-271 | Tree refresh command | Reuse | Wired | `commands/tree/RefreshResourcesView.ts`; remote app/group/function/invalid nodes and manifest menus |

### Drop and Defer evidence

The ID lists in the two preceding sections were compared mechanically with
the current triage: 142 Drop and 64 Defer IDs, each present exactly once in
its appropriate section. Dropped source behavior is checked at its public
boundary, not by asserting that an equivalent shared capability is absent.
For example, internal host startup survives F5 while the source exported
host-start API is dropped.

- **Source host/API/plumbing contracts:** extension `package.json`,
  `extension.ts`, and `products/registerFunctions.ts` contain no dependency
  on Azure Resources or the retiring Functions extension, source exported
  API, source command IDs, experimentation, global Report Issue suppression,
  portal URI handler, or activation-time project-fixing/scaffolding flow.
- **Authoring, settings, templates, and language exclusions:** the manifest
  contributes only shared `vscode-azure.*` configuration. Product registration
  and initialization contain no source scaffolding commands, legacy template
  subsystem, encrypt/decrypt/sync commands, Event Grid editor/CodeLens flow,
  walkthrough, source settings, Ballerina debugger, or legacy runtime wizard.
- **Kudu, deploy fixups, remote debugging, and creation variants:** the remote
  data/view providers expose settings and Functions, not Files, Logs,
  Deployments, identity-management, or slot trees. Command registration and
  `CreateFunctionApp` implement the approved azd path and
  single Flex wizard, not Kudu, remote debugging, advanced/existing-resource
  creation, source zip/publish paths, or source deployment fixups.
- **Tasks, matchers, and agent deployment:** the manifest contributes no
  task definitions, problem matchers/patterns, source submenu, or agent
  metadata. Product activation registers the owned debug provider rather
  than a task provider; no source `agent.*` deployment commands are wired.
- **Deferred families:** the Deferred section remains the tracked task
  surface for every signed Defer ID. Scaffolding is tracked by
  [#364](https://github.com/microsoft/vscode-azure/issues/364), visual
  gallery/binding tooling by [#365](https://github.com/microsoft/vscode-azure/issues/365).
  CLI scaffolding, the gallery panel, native Go provisioning/runtime selection,
  Durable/DTS, slots, identity management, containerized Functions, MCP
  integration, host exceptions UI, and expanded emulator/v5 options are not
  exposed as completed migration features.

### Wiring and documentation evidence

- Product bindings, command aliases/prefix arguments, resource providers,
  workspace providers, settings adapters, and debug activation are wired.
  Specific providers precede generic fallbacks; the Functions view precedes
  the broader Web App view. The retained nodes' command capabilities match
  manifest word-boundary, case-insensitive regexes; invalid nodes expose
  refresh only.
- The Function App icon resolves to
  `packages/azutils/resources/azureIcons/microsoft.web/sites~functionapp.svg`,
  matching the logical type. Manifest NLS references resolve, both schemas
  match the inventory, and no explicit activation event or retiring-extension
  dependency is added. Core Tools checks and host startup remain on demand.
- Shared local/remote actions have independent workspace gates. Local
  targets use `FunctionsProjectSelector.assertLocal` before host access or
  settings mutation, with a further invocation check after the input prompt.
  Regression tests cover untrusted/virtual/out-of-workspace targets and
  preserve remote actions in an untrusted workspace.
- Product behavior is documented in [Functions](../../products/functions.md).
  Framework client documentation links to the product host contract.
  Go/Delve validation is an adapted behavior, not a contributed setting.
- Repository lint, build, and tests passed across all three workspaces;
  see the full sweep results below. Live debugger sessions remain separate.

### Full pre-PR sweep -- 2026-10-12

The root commands `pnpm run lint`, `pnpm run build`, and `pnpm run test`
all exited successfully against source commit `99dc1ece`. No source fixes
were required.

| Workspace | Lint | Build | Passing tests | Pending tests |
|---|---|---|---:|---:|
| `packages/utils` | Passed | Passed | 592 | 12 |
| `packages/azutils` | Passed | Passed | 423 | 0 |
| `extensions/vscode-azure` | Passed | Passed | 1364 | 4 |
| Total | Passed | Passed | 2379 | 16 |

Pending tests are not executed by this sweep. Live language debugger,
storage/emulator, and cross-platform smoke checks remain user-owned under
Slice 4; the automated gates do not certify those manual paths.

### Coverage audit validation -- 2026-10-12

Behavioral tests cover host debugger-readiness timeout and failure cleanup, and
post-deployment endpoint service scoping, empty results, and discovery failures.
The coverage additions require no production-code changes.

The full root lint, build, and test sweep passed with these tests: utils has
592 passing and 12 pending; azutils has 423 passing; the extension has 1378
passing and 4 pending. Total: 2393 passing and 16 pending. Live checks remain
separate from automated coverage.
