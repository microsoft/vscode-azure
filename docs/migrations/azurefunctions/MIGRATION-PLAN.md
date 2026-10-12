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
- **Deploy from a Function App node** works only for apps carrying an
  `azd-service-name` tag that matches a service in a workspace `azure.yaml`.
  Otherwise the command explains why (as an `ExternalError`) and offers
  workspace deploy. `azure.yaml` is not rewritten to target untagged apps.
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
  attach configuration (Slice 4). `launch.json` is optional: users can generate
  an `azure-functions` entry to reach its configurable options. Existing
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
Target files:   extensions/vscode-azure/src/tree/resources/webApp/WebAppDataProvider.ts (extend for Function Apps)
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
                  enable/disable/delete, deploy, logs, and identity are wired with their commands in Slice 2.
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
                extensions/vscode-azure/src/utils/logStream/LogStreamTerminal.ts (shared ACA/Functions pseudoterminal)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionAppLogStream.ts (query-session owner)
Precedent:      DeleteStaticWebAppEnvironment (virtual-node command + activity), BrowseWebsite (shared node capability)
Sweep:          reused DeleteAzureResource, BrowseWebsite, ViewProperties, EditSettings + WebAppSettingsAdapter
                (enable/disable writes AzureWebJobs.<name>.Disabled through it), OpenInPortal, ExternalError (#350),
                IActionExecutor, ResourceSelector, AzureNodeId.forRelatedResource, abortable delay, CaselessMap.
                Reused ACA's pseudoterminal via LogStreamTerminal and related-resource navigation via RevealResource;
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
- [x] Stream logs: shared `LogStreamTerminal` polling `LogsQueryClient` for
  the app's Application Insights resource (resolved from
  `APPLICATIONINSIGHTS_CONNECTION_STRING`); closing the terminal stops polling.
  Container Apps also uses the shared terminal. <- FUNC-065
- [x] Reveal the identity a Function App uses: shared `RevealResource` that
  reveals a resource by ARM ID in the resources view. <- FUNC-171
- [x] Wire shared delete, browse, and properties on the Function App node, and
  shared settings add/edit/rename/delete through the settings document.
  <- FUNC-059, FUNC-063, FUNC-064, FUNC-072, FUNC-075, FUNC-076, FUNC-077
- [x] Manifest entries (commands, `view/item/context`, `commandPalette`
  `when: false` for node-only commands) + `package.nls.json` strings.
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
                Searched local listing, generated-output readers, and host ownership: no shared implementations.
                Product services keep those contracts outside providers; shared index exclusions stay intact.
Activation:     none (existing workspace index; no workspaceContains event)
External facts: verified Worker SDK output copying, Java Maven staging and function metadata, Node v3/v4 programming
                models, host invocation templates, and local settings against the sources linked below.
Tree contract:  Local project node: revealInExplorer, refreshWorkspace (invalid: refresh only).
                Local function node: executeFunction (ready registered host), copyFunctionUrl (HTTP; ready host),
                enableFunction|disableFunction, refreshWorkspace, revealInExplorer when a source URI is available.
                Hint and invalid nodes: no actions except refresh.
```

**Action dependencies approved by the reviewer:** Slice 4 owns initialization
and debugging; creation/welcome actions are deferred with Slice 5.
Missing-runtime state offers initialization. The process owner populates the ready-host registration
after HTTP readiness and releases it when the host stops.

- [x] List functions directly under the project node (no group node): from
  `function.json` for script-model projects, from build output for precompiled
  projects, and from the running host otherwise. Closes
  [#178](https://github.com/microsoft/vscode-azure/issues/178). A Core Tools
  function-list command has been requested in
  [Azure/azure-functions-core-tools#5344](https://github.com/Azure/azure-functions-core-tools/issues/5344).
  <- FUNC-182, FUNC-184, FUNC-185
- [x] Hint nodes: "Run build task to update this list..." and "Start debugging
  to update this list...". <- FUNC-187, FUNC-188
- [x] Invalid local function and invalid local project nodes. <- FUNC-186, FUNC-191
- [x] Missing-worker-runtime project state; initialization action is tracked
  in Slice 4. <- FUNC-190 (presentation)
- [x] Refresh on `function.json` changes, local settings, generated-output
  changes/deletion, and host start/stop through the
  workspace index watcher and host tracking events. <- FUNC-198
- [x] Local execute / copy URL / enable / disable reuse the Slice 2 commands
  against `FunctionsHostClient` (local) and `local.settings.json` values.
  <- FUNC-041, FUNC-042, FUNC-043, FUNC-044
- [x] Unit/integration tests with shared fixtures and the real workspace
  index/tree, including remote-command regression coverage and contribution
  consistency checks.

Listing bounds and output selection are documented in
[the product contract](../../products/functions.md#local-workspace-tree).
No custom output path, guessed port, source-language parser, settings
synchronization, or local settings tree is contributed.

Verified external contracts:

- [Worker SDK build-output metadata copying](https://github.com/Azure/azure-functions-dotnet-worker/blob/main/sdk/Sdk/Targets/Microsoft.Azure.Functions.Worker.Sdk.targets).
- [Maven staging directory](https://github.com/microsoft/azure-maven-plugins/blob/975dd140d802c0fcb4fd61f4083095e6d299f7be/azure-appservice-maven-plugin-lib/src/main/java/com/microsoft/azure/maven/appservice/AbstractAppServiceMojo.java)
  and [generated function metadata](https://github.com/microsoft/azure-maven-plugins/blob/975dd140d802c0fcb4fd61f4083095e6d299f7be/azure-functions-maven-plugin/src/main/java/com/microsoft/azure/maven/function/PackageMojo.java).
- [Node programming models](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?pivots=nodejs-model-v4).
- [Host metadata response and invocation template](https://github.com/Azure/azure-functions-host/blob/dev/src/WebJobs.Script.WebHost/Models/FunctionMetadataResponse.cs).
- [Local settings structure](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local#local-settings-file)
  and [function disable flags](https://learn.microsoft.com/en-us/azure/azure-functions/disable-function).

## Slice 4 -- Local development (F5)

A contributed debug type resolves to the language debugger's attach
configuration after the extension has built the project and started the host
itself. Resolving to a different debug type is proven in the Container Tools
extension. Debugging works with no `tasks.json` or `launch.json`; a
`launch.json` entry is optional and exposes the configurable options. No
`tasks.json` is generated, and no task type, problem matcher, or process-pick
command is contributed.

```
Pattern:        contributed `azure-functions` debugger (launch request, no adapter) whose DebugConfigurationProvider
                (Initial + Dynamic) builds, starts the host, and returns a config of the language's debug type
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
                Core Tools host arguments/PID output against tag 4.15.2; Python environment public API;
                Python Debugger launcher/path public API against 061023c85cf721731569c2d0d670c129fc1f45c4.
                Native Go uses the Go extension's public tool API, Core Tools 4.15.2 native worker configuration
                and GoHelpers, and headless Delve's remote DAP protocol.
                Source links and per-language prerequisites are in docs/products/functions.md.
```

Resolution flow for one session:

1. The initial hook normalizes the configuration; VS Code substitutes variables
   and runs any configured `preLaunchTask`. The substituted-variable hook picks
   the Functions project from the workspace index (remembered per workspace
   when a folder has several).
2. Pre-debug validation; failures are `ExternalError`s.
3. Build with in-code tasks (`npm run build`, `dotnet build`, `mvn package`, `go build`,
   dependency install), using VS Code's own `$tsc` / `$msCompile` matchers.
   Skip this build when `skipBuild` or a replacement `preLaunchTask` applies.
4. Start `func host start` in an in-code pseudoterminal task with the worker
   debug arguments in its environment and a free debug port.
5. Wait for worker attach coordinates, bounded to 120 seconds. Paused workers
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
  as `.vscode/extensions.json` recommendations, and offers (never forces) the
  optional `launch.json` entry below. <- FUNC-030
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
  Reuse worker executable/argument overrides and the owned host's loopback
  ports/readiness/process-tree cleanup. Return a Go remote DAP attach config;
  custom handlers are excluded. Wire Go recommendations, native-runtime
  initialization, debugger language contribution, and the workspace Debug action.
  <- FUNC-140, FUNC-141, FUNC-195
- [x] Go behavioral coverage: prerequisites/build errors, paths with spaces,
  skipped builds, loopback attach, readiness failure/cancellation/cleanup, and
  initialization/tree capabilities. Live Go attach smoke check remains part
  of Slice 7. <- FUNC-140, FUNC-141, FUNC-195
- [x] Host process and tracking: build steps, start, readiness, port, terminal
  errors, stop on session end, and start/stop events for local listing and
  execute. <- FUNC-216
- [x] Pre-debug validation: Core Tools present, `FUNCTIONS_WORKER_RUNTIME`,
  `AzureWebJobsStorage` / emulator reachable. <- FUNC-215
- [x] Wire shared Core Tools install/update and version checks; no
  activation-time prompts. <- FUNC-021, FUNC-031, FUNC-217
- [x] Optional `launch.json` generation: an `azure-functions` entry
  (`{ "type": "azure-functions", "request": "launch", ... }`) produced by the
  provider's initial configurations (Run and Debug "create a launch.json file"),
  `configurationSnippets`, and the init offer. The debugger's
  `configurationAttributes` schema documents the options, for example project
  path, host arguments, extra environment, debug port, skip build, and a
  `preLaunchTask` that replaces the built-in build. Entries also serve compound
  launches. Omitted options fall back to the no-`launch.json` defaults.
  <- FUNC-030
- [x] Unit tests for configuration resolution, build preparation, host tracking,
  cancellation, and readiness failures; initialization integration tests against
  the real index/tree; shared integration test terminating a real parent/worker
  process tree.
- [ ] Live language attach-path smoke checks during Slice 7. The automated tests
  cover all six configuration/API paths, not live language debugger sessions.

Native Go protocol validation on Windows used the full Core Tools 4.15.2
distribution, Go 1.26.2, Delve 1.27.2, and Go worker SDK v0.7.0-preview.
The exact host/worker invocation passed remote DAP attach, a verified HTTP
handler breakpoint, variable inspection, continue, and an HTTP response with
a project path containing repeated spaces. A binary hash check confirmed
that `--no-build` preserves the prepared debug binary. This protocol smoke
uses a DAP client, not the VS Code Go extension UI; live VS Code sessions,
storage/emulator integration, and Linux/macOS smoke checks remain in Slice 7.

Existing projects' source-generated `tasks.json` / `launch.json` (task type
`func`, `$func-watch`, `${command:azureFunctions.pickProcess}`) are left
untouched: no compatibility registrations and no rewrite prompt. Users delete
them or re-initialize.

## Slice 5 -- Project and function scaffolding (deferred)

Project creation (`func init`), add-function (`func new`), and gallery-backed
quickstarts (`func quickstart`) are outside the active migration scope.
The dependent language flows, template requirements/post-create integration,
and create-project welcome action are tracked under
[Deferred](#deferred----tracked-not-built).

Future integration uses thin `ManagedCommand` entry points and shared
`ToolService` / `IProcessExecutor` services. CLI v5 owns catalogs, requirements,
validation, generated files, dependencies, and project configuration; the
extension owns folder selection, editor integration, cancellation/errors, and
preserving user-owned files. CLI v5 workload acquisition must be independent
of the implemented Core Tools v4 F5 contract. Shared tool support
(FUNC-021, FUNC-031, FUNC-217), local-only gates (FUNC-004), and initialization
of existing projects (FUNC-030, FUNC-190) remain in scope.

Before future implementation, verify distributed CLI v5/workload versions,
language support, machine-readable discovery, noninteractive prompts, result
shapes, and compatibility with runtime v4 F5 and azd deployment.
Source evidence is Azure/azure-functions-core-tools at
`a0bdc299fa685fa530236c108f4715977c96a8f2` (`InitCommand.cs`, `NewCommand.cs`,
`QuickstartCommand.cs`, `QuickstartManifestOptions.cs`,
`JavaProjectInitializer.cs`); source support does not prove packaged availability.

## Slice 6 -- Creation and deployment (azd + Bicep)

```
Pattern:        Wizard + AzdJob (createNew / deploy), shared azd steps, GenerateBicepStep
Target files:   extensions/vscode-azure/src/commands/functions/CreateFunctionApp.ts + steps/
                extensions/vscode-azure/src/commands/functions/DeployFunctionApp.ts (node deploy)
                extensions/vscode-azure/resources/templates/functionApp/main.bicep
Precedent:      existing CreateFunctionApp, SWA creation (detection skips prompts), AzdDeployStep
Sweep:          reused SelectIacFolderStep, HydrateAzdInfo, HydratableChooseSubscription/Location, ProjectName,
                PickRuntimeStep, ConfirmProvision, GenerateBicepStep, GenerateAzureYaml, CreateAzdEnv, AzdProvisionStep,
                AzdDeployStep, AzdService (service map and target ARM IDs), activity tree
                (CodeDeploymentDataProvider), DeleteAzureResource, ExternalError, IWebAppClientProvider,
                parseAzureResourceId, ISubscriptionResolver, OpenUrl.
                ShowFunctionEndpointsStep lists management-plane HTTP invocation templates.
Activation:     none
External facts: azd service lookup by `azd-service-name` tag, verified against the azure.yaml v1.0 schema
                (`services.*.resourceName` description) on 2026-09-24; pattern-module parameters/outputs per the
                provisioning decision below. The azd show contract in cli/azd/pkg/contracts/show.go verifies
                services.*.target.resourceIds; remote deploy requires an exact case-insensitive ARM ID match.
Wizard:         SelectIacFolder -> HydrateAzdInfo -> DetectFunctionRuntime -> subscription -> location -> ProjectName -> PickRuntime (skipped when
                the project language is detected) -> ConfirmProvision; execute GenerateBicep -> GenerateAzureYaml ->
                CreateAzdEnv -> AzdProvision (+ AzdDeploy -> ShowFunctionEndpoints for the deploy job). No hosting-plan,
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
- [x] Skip `PickRuntimeStep` when the workspace project's language is
  detected. <- FUNC-247
- [x] Flex instance memory / maximum instance count as module defaults, not
  prompts. <- FUNC-248
- [x] Provisioning topology through the function-app pattern module (see
  below). <- FUNC-249
- [x] Workspace deploy (`vscode-azure/functions/deploy` / azd from the
  project node). <- FUNC-047
- [x] Node deploy for azd-tagged apps only: match the app's `azd-service-name`
  and ARM ID to the active workspace azd service and run `azd deploy <service>`; otherwise
  explain and offer workspace deploy. <- FUNC-046
- [x] `explorer/context` Deploy on a folder routes to workspace deploy.
  <- FUNC-202
- [x] Completion reported in the activity log; `ShowFunctionEndpointsStep` lists
  HTTP trigger URLs. <- FUNC-255, FUNC-256
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
  CORS. `ShowFunctionEndpointsStep` uses the deployed ARM IDs from `azd show`
  to list actual HTTP invocation templates.

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
- [ ] `enablement: !virtualWorkspace` on every retained local-only command.
  <- FUNC-004
- [ ] Project detection stays on `functionsDetector`; no
  `workspaceContains` activation. Core Tools v5 may make `host.json` optional;
  a machine-readable project-info command has been requested in
  [Azure/azure-functions-core-tools#5344](https://github.com/Azure/azure-functions-core-tools/issues/5344).
  <- FUNC-002
- [ ] Report Issue stays on the framework error toast; user-actionable errors
  use `ExternalError`. <- FUNC-100
- [ ] GitHub / CI/CD setup uses the existing `vscode-azure/configureCicd`
  (`azd pipeline config`); no Functions-specific command. <- FUNC-055
- [ ] No Functions settings are contributed: every source setting is Drop or
  Defer in [TRIAGE.md](TRIAGE.md).
- [ ] Product doc `docs/products/functions.md` (tree, commands, F5, creation,
  deploy constraints); framework docs get at most a link.
- [ ] Full `pnpm run lint` / `build` / `test` sweep before the PR.

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
- [ ] Agent and MCP surfaces pending a monorepo-wide agent contract.
  <- FUNC-007, FUNC-101, FUNC-228, FUNC-254
- [ ] Host exceptions debugger view and its commands. <- FUNC-095, FUNC-096,
  FUNC-097, FUNC-098, FUNC-099, FUNC-196
- [ ] Revisit with Core Tools v5: stop host after debug, emulator validation,
  host start timeout. <- FUNC-137, FUNC-142, FUNC-144
- [ ] Storage emulator: storage connection prompts, Azurite settings and
  integration. <- FUNC-164, FUNC-176, FUNC-267
- [ ] Go scaffolding and native Go provisioning/deployment integration.
  <- FUNC-226
- [ ] Template Gallery webview and resource-backed binding settings (with their SDKs).
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
- Agent deploy commands and MCP project setting: FUNC-104, FUNC-105,
  FUNC-106, FUNC-107, FUNC-160.
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
| 2026-09-24 | `dfc8edaf` (#350) | Adopt `ExternalError` (`packages/utils`) for user-actionable failures in Slices 2, 4, and 6 (node deploy on untagged apps, missing Core Tools, pre-debug validation). No other new shared surfaces; no slices landed yet. |
| 2026-10-08 | `8993a3c1` | Slice 0 intake sweep: reuse the shared data-plane REST factory and cloud-aware Log Analytics endpoint. Container Apps already owns its log-stream pseudoterminal; inspect that implementation before Slice 2 instead of assuming a terminal primitive is absent. |
