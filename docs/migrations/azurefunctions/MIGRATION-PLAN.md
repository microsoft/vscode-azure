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

- Slices are ordered bottom-up: models and clients, then trees, commands,
  local development, scaffolding, creation/deploy, and manifest cleanup. Each
  slice must lint, build, and test before the next starts.
- Each slice opens with its mapping record: pattern, target files, precedent,
  shared-primitive sweep, activation, external facts, and tree contract. Sweep
  lines record the searches made while planning; Phase 5 re-runs the sweep
  immediately before each slice is written.
- Context values below are new names derived from the command set; source
  literals are not carried forward. Every `package.json` `when` clause uses
  `viewItem =~ /\b<value>\b/i`.
- Unchecked boxes are open work.

## Mapping decisions made with the reviewer

These were resolved during mapping and are binding for the slices below.

- **Provisioning module.** Keep the current pre-publication build of the
  function-app pattern module (`br:bwaterpretendavm.azurecr.io/bicep/function-app:0.1.0`)
  until [Azure/bicep-registry-modules#7299](https://github.com/Azure/bicep-registry-modules/pull/7299)
  publishes `avm/ptn/app/function-app`, then pin the `br/public` reference.
  Tracked by [#112](https://github.com/microsoft/vscode-azure/issues/112). See
  [Provisioning decision](#provisioning-decision).
- **Deploy from a Function App node** works only for apps carrying an
  `azd-service-name` tag that matches a service in a workspace `azure.yaml`.
  Otherwise the command explains why (as an `ExternalError`) and offers
  workspace deploy. `azure.yaml` is not rewritten to target untagged apps.
- **Log streaming** is a pseudoterminal for every plan that polls the app's
  Application Insights / Log Analytics logs; closing the terminal stops the
  stream. There is no Logs node and no Kudu `/api/logstream` path.
- **Flat function trees.** Functions are direct children of the Function App
  node and of the local project node; there are no group nodes.
- **F5 without `tasks.json` / `launch.json`.** A contributed `azure-functions`
  debug type starts the host in-process and resolves to the language debugger's
  attach configuration (Slice 4). Existing projects' source-generated debug
  files are left untouched.

## Slice 0 -- Models and clients

```
Pattern:        azutils REST-style client wrappers + shared Azure node model
Target files:   packages/azutils/src/rest/clients/WebAppClient.ts (extend)
                packages/azutils/src/rest/clients/FunctionsHostClient.ts (new)
                packages/azutils/src/rest/clients/LogsQueryClient.ts (new)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionApp.ts (new: guard + virtual function model)
Precedent:      StaticWebAppClient.ts (minimal surface, toPages), StaticWebApp virtual environment/function models
Sweep:          reused IWebAppClient/WebAppClient, createArmRestSubscriptionClient, toPages, FunctionAppLogicalType,
                makeVirtualResource (tests). Searched "admin/functions", "masterKey", "hostKeys", "LogsQuery",
                "monitor-query", "applicationInsights": none exist -> new FunctionsHostClient and LogsQueryClient in azutils
                (shared; a Container Apps migration would reuse LogsQueryClient).
Activation:     none
External facts: Functions admin API paths (`/admin/functions`, `/admin/host/status`) and key APIs (listHostKeys,
                listFunctionKeys, listFunctionSecrets) -- verify against the pinned source client code and the
                @azure/arm-appservice API surface before writing. Log query SDK package name -- verify the current
                published Azure Monitor query package on npm before adding the dependency.
Client:         re-export every SDK type used in the wrapper APIs from azutils
```

- [ ] Add a Function App guard (case-insensitive `FunctionAppLogicalType`
  comparison) and a virtual remote-function model carrying name, trigger
  kind, disabled state, and auth level. <- FUNC-169, FUNC-170
- [ ] Extend `IWebAppClient` with start, stop, restart, list/get/delete
  function, function and host keys, and function secrets (invoke URL), keeping
  `toPages` for list operations. <- FUNC-060, FUNC-061, FUNC-062, FUNC-262
- [ ] Add `FunctionsHostClient` for the host admin API: remote (master key
  from `listHostKeys`) and local (`http://localhost:<port>`). Used by execute,
  local listing, and host readiness. <- FUNC-263
- [ ] Add `LogsQueryClient` (Application Insights / Log Analytics query) for
  log streaming. <- FUNC-065
- [ ] Unit tests with `MockHttpClient` through each client's `create()`
  options.

## Slice 1 -- Remote tree

```
Pattern:        DataProvider + ViewProvider; virtual children under the ARM resource
Target files:   extensions/vscode-azure/src/tree/resources/webApp/WebAppDataProvider.ts (extend for Function Apps)
                extensions/vscode-azure/src/tree/resources/webApp/FunctionAppViewProvider.ts (new, before WebAppViewProvider)
                extensions/vscode-azure/src/products/registerFunctions.ts (register)
Precedent:      StaticWebAppDataProvider / StaticWebAppViewProvider (virtual children, explicit invalid nodes)
Sweep:          reused getSettingsNodes + WebAppSettingsAdapter, setWebsiteUrl, createGenericResourceTreeItem,
                AzureNodeId, IAzureViewDataTree, RefreshResourcesView, ResourceSelector, resource listing/enrich.
                Searched "invalid", "errorNode", "createErrorItem" in tree/ -> follow the SWA explicit-invalid pattern.
Activation:     none (existing resources view)
External facts: none
Tree contract:  Function App node: combineContextValues(browseWebsite, viewProperties, editSettings,
                  startWebApp|stopWebApp (by state), restartWebApp, deployFunctionApp (azd-tagged only),
                  streamFunctionLogs, revealIdentity (when an identity is assigned)).
                Remote function node: executeFunction, copyFunctionUrl (HTTP triggers), enableFunction|disableFunction
                  (by state), deleteFunction.
                Invalid function / invalid app nodes: no actions except refresh.
```

- [ ] Function App children: shared settings node, then one node per function
  (flat, no group node). <- FUNC-166, FUNC-168, FUNC-169, FUNC-173
- [ ] Function App description shows state (stopped) and Flex; context values
  reflect running/stopped. <- FUNC-166
- [ ] Explicit invalid nodes for a function or app that cannot be read,
  carrying the error. <- FUNC-170, FUNC-180
- [ ] Wire shared refresh, listing, enrichment, and resource picking on the
  new nodes; no Functions-specific equivalents. <- FUNC-199, FUNC-200, FUNC-271
- [ ] Unit tests with `createMockDataItemTree` / `makeGenericResource`.

## Slice 2 -- Remote commands

```
Pattern:        @injectable() ManagedCommand with static ContextValue; shared commands consume node context values
Target files:   extensions/vscode-azure/src/commands/webApp/{StartWebApp,StopWebApp,RestartWebApp}.ts (shared by all
                  Microsoft.Web/sites kinds; ids vscode-azure/webApp/{start,stop,restart})
                extensions/vscode-azure/src/commands/functions/{ExecuteFunction,CopyFunctionUrl,EnableFunction,
                  DisableFunction,DeleteFunction,StreamFunctionLogs}.ts (ids vscode-azure/functions/<name>)
                extensions/vscode-azure/src/commands/tree/RevealResource.ts (new shared, id vscode-azure/resources/reveal)
                extensions/vscode-azure/src/utils/logStream/LogStreamTerminal.ts (new shared pseudoterminal)
Precedent:      DeleteStaticWebAppEnvironment (virtual-node command + activity), BrowseWebsite (shared node capability)
Sweep:          reused DeleteAzureResource, BrowseWebsite, ViewProperties, EditSettings + WebAppSettingsAdapter
                (enable/disable writes AzureWebJobs.<name>.Disabled through it), OpenInPortal, ExternalError (#350),
                IActionExecutor. Searched "Pseudoterminal", "createTerminal", "logstream", "streamLogs": none exist ->
                new shared LogStreamTerminal. Searched "treeView.reveal", "revealResource", "reveal(": only
                RevealInExplorer (workspace files) -> new shared RevealResource for ARM IDs.
Activation:     none
External facts: `AzureWebJobs.<FunctionName>.Disabled` setting name; App Insights `traces` / `requests` tables and
                ingestion latency -- verify against Azure Functions and Azure Monitor docs before writing user-facing text.
Tree contract:  per Slice 1; menu entries in view/item/context with word-boundary regexes.
```

- [ ] Start, stop, and restart as shared `Microsoft.Web/sites` commands.
  <- FUNC-060, FUNC-061, FUNC-062
- [ ] Execute a function (remote via the host admin API; request body prompt
  for non-HTTP triggers). <- FUNC-041
- [ ] Copy function URL (with function key when the auth level requires it).
  <- FUNC-042
- [ ] Enable / disable a function through the shared app-settings adapter.
  <- FUNC-043, FUNC-044
- [ ] Delete a remote function, reported in the activity tree. <- FUNC-045
- [ ] Stream logs: shared `LogStreamTerminal` polling `LogsQueryClient` for
  the app's Application Insights resource (resolved from
  `APPLICATIONINSIGHTS_CONNECTION_STRING`); closing the terminal stops polling.
  Shape it for reuse by a Container Apps migration. <- FUNC-065
- [ ] Reveal the identity a Function App uses: shared `RevealResource` that
  reveals a resource by ARM ID in the resources view. <- FUNC-171
- [ ] Wire shared delete, browse, and properties on the Function App node, and
  shared settings add/edit/rename/delete through the settings document.
  <- FUNC-059, FUNC-063, FUNC-064, FUNC-072, FUNC-075, FUNC-076, FUNC-077
- [ ] Manifest entries (commands, `view/item/context`, `commandPalette`
  `never` for node-only commands) + `package.nls.json` strings.
- [ ] Unit tests per command with `createMockCodeContext()` and real
  `ActionExecutor`.

## Slice 3 -- Workspace tree (local functions)

```
Pattern:        WorkspaceDetector tags + workspace DataProvider/ViewProvider
Target files:   extensions/vscode-azure/src/tree/workspace/functions/{FunctionsWorkspaceDataProvider,
                  FunctionsWorkspaceViewProvider}.ts (extend); tree/workspace/WorkspaceNode.ts (local function node)
Precedent:      FunctionsWorkspaceDataProvider (project nodes), AZD workspace provider
Sweep:          reused IWorkspaceIndexService (its FileSystemWatcher drives refresh), functionsDetector, createTag,
                RevealInExplorer, RefreshWorkspaceView. Searched "function.json", "listFunctions", "buildOutput": none
                exist -> local listing lives in the Functions workspace provider.
Activation:     none (existing workspace index; no workspaceContains event)
External facts: where precompiled (.NET isolated, Java) function metadata lands after build (`functions.metadata`,
                `function.json` under the output folder) -- verify against Core Tools v4 output before writing.
Tree contract:  Local project node: revealInExplorer, createFunction, deployProject, initProject (when not initialized).
                Local function node: executeFunction, copyFunctionUrl (HTTP; host running), enableFunction|disableFunction.
                Hint and invalid nodes: no actions except refresh.
```

- [ ] List functions directly under the project node (no group node): from
  `function.json` for script-model projects, from build output for precompiled
  projects, and from the running host otherwise. Closes
  [#178](https://github.com/microsoft/vscode-azure/issues/178).
  <- FUNC-182, FUNC-184, FUNC-185
- [ ] Hint nodes: "Run build task to update this list..." and "Start debugging
  to update this list...". <- FUNC-187, FUNC-188
- [ ] Invalid local function and invalid local project nodes. <- FUNC-186, FUNC-191
- [ ] Uninitialized-project state with an "Initialize project..." action
  (follows Slice 4's init design). <- FUNC-190
- [ ] Empty workspace: `viewsWelcome` content pointing at create project.
  <- FUNC-192
- [ ] Refresh on `function.json` changes and host start/stop through the
  workspace index watcher and host tracking events. <- FUNC-198
- [ ] Local execute / copy URL / enable / disable reuse the Slice 2 commands
  against `FunctionsHostClient` (local) and `local.settings.json` values.
  <- FUNC-041, FUNC-042, FUNC-043, FUNC-044
- [ ] Unit tests with the workspace index test fixtures.

## Slice 4 -- Local development (F5)

A contributed debug type resolves to the language debugger's attach
configuration after the extension has built the project and started the host
itself. Resolving to a different debug type is proven in the Container Tools
extension. Nothing is generated into `tasks.json` or `launch.json`, and no task
type, problem matcher, or process-pick command is contributed.

```
Pattern:        contributed `azure-functions` debugger (launch request, no adapter) whose DebugConfigurationProvider
                (Initial + Dynamic) builds, starts the host, and returns a config of the language's debug type
Target files:   extensions/vscode-azure/src/functions/debug/* (debug configuration provider, per-language attach configs)
                extensions/vscode-azure/src/functions/host/* (host process, host tracking, pre-debug validation)
Precedent:      Container Tools debug providers (resolve to another debug type); tools/FuncInstaller + ToolService (Core
                Tools discovery). SWA debugging builds on this (#339).
Sweep:          reused IProcessExecutor (packages/utils), createShellTask (packages/utils), CommandLineBuilder,
                ToolService/FuncInstaller, IWorkspaceIndexService, ExternalError. Searched
                "registerDebugConfigurationProvider", "DebugConfigurationProviderTriggerKind", "onDidTerminateDebugSession",
                "CustomExecution": none exist -> new product code under functions/debug and functions/host.
Activation:     only the implicit events VS Code generates for a contributed `debuggers` entry; justify any explicit
                onDebug* entry in this record before adding it.
External facts: implicit activation for contributed debuggers; attach settings for node (`--inspect`), debugpy, java
                (jdwp), PowerShell, and coreclr; `languageWorkers__<runtime>__arguments` env names; Core Tools
                `--dotnet-isolated-debug` / `--enable-json-output` worker PID output; host readiness signal
                (`/admin/host/status` or log line); Python extension environment and launcher APIs -- verify each against
                the pinned source and the owning extension's or Core Tools' docs.
```

Resolution flow for one session:

1. Pick the Functions project from the workspace index (remembered per
   workspace when a folder has several).
2. Pre-debug validation; failures are `ExternalError`s.
3. Build with in-code tasks (`npm run build`, `dotnet build`, `mvn package`,
   dependency install), using VS Code's own `$tsc` / `$msCompile` matchers.
4. Start `func host start` in an in-code pseudoterminal task with the worker
   debug arguments in its environment and a free debug port.
5. Wait for host readiness.
6. Return the attach configuration of the language's debug type; stop the host
   when the session ends.

- [ ] Contribute the `azure-functions` debugger (languages for the kept
  runtimes) and register its provider for initial and dynamic configurations,
  so projects appear in the Run and Debug dropdown with no `launch.json`.
  <- FUNC-030
- [ ] `initProjectForVSCode` writes no debug files; only non-debug workspace
  files such as `.vscode/extensions.json` recommendations, never project
  configuration in VS Code settings. <- FUNC-030
- [ ] Attach configurations for Node, Python (via the Python extension's
  launcher), Java, and PowerShell, with free debug ports.
  <- FUNC-210, FUNC-211, FUNC-212, FUNC-214, FUNC-268
- [ ] .NET isolated attach using the worker PID reported by
  `--dotnet-isolated-debug`, instead of a process picker.
  <- FUNC-033, FUNC-269
- [ ] Host process and tracking: build steps, start, readiness, port, terminal
  errors, stop on session end, and start/stop events for local listing and
  execute. <- FUNC-216
- [ ] Pre-debug validation: Core Tools present, `FUNCTIONS_WORKER_RUNTIME`,
  `AzureWebJobsStorage` / emulator reachable. <- FUNC-215
- [ ] Wire shared Core Tools install/update and version checks; no
  activation-time prompts. <- FUNC-021, FUNC-031, FUNC-217
- [ ] Opt-in minimal `launch.json` entry (`{ "type": "azure-functions",
  "request": "launch" }`) for compounds and per-project overrides; never
  generated automatically. <- FUNC-030
- [ ] Unit tests for configuration resolution and host tracking; integration
  test for the attach path where the precedent allows.

Existing projects' source-generated `tasks.json` / `launch.json` (task type
`func`, `$func-watch`, `${command:azureFunctions.pickProcess}`) are left
untouched: no compatibility registrations and no rewrite prompt. Users delete
them or re-initialize.

## Slice 5 -- Project and function scaffolding

```
Pattern:        ManagedCommand + Wizard PromptSteps wrapping Core Tools (`func init`, `func new`) through IProcessExecutor
Target files:   extensions/vscode-azure/src/commands/functions/{CreateFunctionProject,CreateFunction}.ts + steps/
Precedent:      SWA `swa init` wrapping (CLI owns detection); CreateFunctionApp steps (PickRuntimeStep)
Sweep:          reused ToolService/FuncInstaller, IProcessExecutor, CommandLineBuilder, workspace folder pick steps,
                PickRuntimeStep/runtimesAndVersions. Searched "func init", "func new", "templates", "venv",
                "createEnvironment": none exist -> new steps under commands/functions/steps.
Activation:     none (palette + view commands)
External facts: `func init` worker-runtime / language flags for each kept language (JavaScript, TypeScript, Python v2,
                dotnet-isolated, Java/Maven, PowerShell, custom), `func new --template` names, and whether Go can be
                scaffolded without the source template feed -- verify against Core Tools v4 `func init --help` /
                `func new --help` and docs. Python extension environment-creation command id -- verify.
```

- [ ] Create project: pick folder and language, run `func init`, open the
  folder in the current window only (no cross-session resume). Local-only
  commands carry `enablement: !virtualWorkspace`. <- FUNC-026, FUNC-004
- [ ] Languages through `func init`: JavaScript, TypeScript, Python (v2; offer
  the Python extension's environment creation instead of creating a venv
  directly), C# .NET isolated, Java (Maven), PowerShell, custom handler.
  <- FUNC-218, FUNC-219, FUNC-220, FUNC-221, FUNC-223, FUNC-224, FUNC-225
- [ ] Go: scaffold as a custom handler if Core Tools supports it without the
  source template feed; otherwise amend [TRIAGE.md](TRIAGE.md) and reconfirm.
  <- FUNC-226
- [ ] Create function: pick template and name from `func new`, prompt only for
  the settings the template requires, then open the created file.
  <- FUNC-028, FUNC-235, FUNC-236
- [ ] Unit tests with `respondToPrompts()` and a mocked `IProcessExecutor`.

## Slice 6 -- Creation and deployment (azd + Bicep)

```
Pattern:        Wizard + AzdJob (createNew / deploy), shared azd steps, GenerateBicepStep
Target files:   extensions/vscode-azure/src/commands/functions/CreateFunctionApp.ts + steps/
                extensions/vscode-azure/src/commands/functions/DeployFunctionApp.ts (node deploy)
                extensions/vscode-azure/resources/templates/functionApp/main.bicep
Precedent:      existing CreateFunctionApp, SWA creation (detection skips prompts), AzdDeployStep, ShowEndpointUrlStep
Sweep:          reused SelectIacFolderStep, HydrateAzdInfo, HydratableChooseSubscription/Location, ProjectName,
                PickRuntimeStep, ConfirmProvision, GenerateBicepStep, GenerateAzureYaml, CreateAzdEnv, AzdProvisionStep,
                AzdDeployStep, ShowEndpointUrlStep, AzdService (service map by azd-service-name), activity tree
                (CodeDeploymentDataProvider), DeleteAzureResource, ExternalError.
Activation:     none
External facts: azd service lookup by `azd-service-name` tag, verified against the azure.yaml v1.0 schema
                (`services.*.resourceName` description) on 2026-09-24; pattern-module parameters/outputs per the
                provisioning decision below.
Wizard:         SelectIacFolder -> HydrateAzdInfo -> subscription -> location -> ProjectName -> PickRuntime (skipped when
                the project language is detected) -> ConfirmProvision; execute GenerateBicep -> GenerateAzureYaml ->
                CreateAzdEnv -> AzdProvision (+ AzdDeploy -> ShowEndpointUrl for the deploy job). No hosting-plan,
                authentication, or Flex sizing prompts: Flex FC1, managed identity, and module defaults answer them.
```

- [ ] Close creation gaps against the source flow; no advanced/existing-
  resource variant. <- FUNC-057
- [ ] Remove `PickHostingPlanStep` and its Premium/App Service options; always
  provision Flex Consumption (users change plans in the Bicep).
  <- FUNC-241 (FC1 kept; Premium/App Service removal per FUNC-242)
- [ ] Managed identity only: no secrets or connection strings, no prompt
  (the module's user-assigned identity and `AzureWebJobsStorage__credential`).
  <- FUNC-246
- [ ] Skip `PickRuntimeStep` when the workspace project's language is
  detected. <- FUNC-247
- [ ] Flex instance memory / maximum instance count as module defaults, not
  prompts. <- FUNC-248
- [ ] Provisioning topology through the function-app pattern module (see
  below). <- FUNC-249
- [ ] Workspace deploy (`vscode-azure/functions/deploy` / azd from the
  project node). <- FUNC-047
- [ ] Node deploy for azd-tagged apps only: match the app's `azd-service-name`
  to a workspace `azure.yaml` service and run `azd deploy <service>`; otherwise
  explain and offer workspace deploy. <- FUNC-046
- [ ] `explorer/context` Deploy on a folder routes to workspace deploy.
  <- FUNC-202
- [ ] Completion reported in the activity log; `ShowEndpointUrlStep` lists
  HTTP trigger URLs. <- FUNC-255, FUNC-256
- [ ] Deleting a containerized Function App uses shared delete (applies once
  containerized apps return from Deferred). <- FUNC-258
- [ ] Unit tests with `respondToPrompts()`; Bicep build of the consumer.

### Provisioning decision

The topology is a Function App plus its Flex Consumption plan, storage
account, Application Insights, Log Analytics workspace, user-assigned managed
identity, and role assignments, so a pattern module is required (a resource
module does not cover it).

- **AVM search (2026-09-24):** `avm/ptn` has no published function-app module
  (`avm/ptn/web` does not exist; `mcr.microsoft.com/v2/bicep/avm/ptn/web/function-app/tags/list`
  returns 404). `avm/res/web/site` is a single-resource module and does not
  satisfy the topology.
- **Candidate:** `avm/ptn/app/function-app` in
  [Azure/bicep-registry-modules#7299](https://github.com/Azure/bicep-registry-modules/pull/7299)
  (open). It covers the whole topology: it creates the user-assigned identity
  (or accepts one), sets `AzureWebJobsStorage__credential = managedidentity`,
  disables local auth, and exposes `flexConsumptionInstanceMemoryMB` /
  `flexConsumptionMaximumInstanceCount` plus the name, resource ID, default
  hostname, and identity outputs.
- **Selected:** keep the pre-publication build at
  `br:bwaterpretendavm.azurecr.io/bicep/function-app:0.1.0` (reviewer
  decision), then replace it with a pinned `br/public:avm/ptn/app/function-app:<version>`
  once published. Tracked by [#112](https://github.com/microsoft/vscode-azure/issues/112).
- **Parameter map:** `environmentName` -> `functionAppName` (`<env>-func`);
  wizard runtime -> `functionWorkerRuntime`, `runtimeVersion`; `azdServiceName`
  -> `functionAppTags['azd-service-name']`; `appServicePlanSkuName` fixed to
  `FC1` (the consumer parameter is removed); `autoGeneratedDomainNameLabelScope`
  and portal CORS unchanged. `functionAppDefaultHostname` feeds
  `ShowEndpointUrlStep`.

- [ ] Replace the temporary registry reference with the pinned `br/public`
  module when #7299 publishes; rebuild the consumer. <- FUNC-249

## Slice 7 -- Manifest, reuse wiring, and documentation

```
Pattern:        package.json contributions + package.nls.json; shared framework wiring
Target files:   extensions/vscode-azure/package.json, package.nls.json, docs/products/functions.md (new)
Sweep:          reused functionsDetector (project detection), framework error toasts (Report Issue),
                existing jsonValidation block.
Activation:     none (jsonValidation and viewsWelcome add no activation events)
External facts: `https://json.schemastore.org/function.json` and `https://json.schemastore.org/host.json`, taken from
                the source manifest at the pinned SHA; both returned HTTP 200 on 2026-09-24.
```

- [ ] `jsonValidation` for `function.json` and `host.json`. <- FUNC-008, FUNC-009
- [ ] `enablement: !virtualWorkspace` on every retained local-only command.
  <- FUNC-004
- [ ] Project detection stays on `functionsDetector`; no
  `workspaceContains` activation. <- FUNC-002
- [ ] Report Issue stays on the framework error toast; user-actionable errors
  use `ExternalError`. <- FUNC-100
- [ ] No Functions settings are contributed: every source setting is Drop or
  Defer in [TRIAGE.md](TRIAGE.md).
- [ ] Product doc `docs/products/functions.md` (tree, commands, F5, creation,
  deploy constraints); framework docs get at most a link.
- [ ] Full `pnpm run lint` / `build` / `test` sweep before the PR.

## Deferred -- tracked, not built

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
- [ ] Go debugging and toolchain validation (Go scaffolding is Slice 5).
  <- FUNC-140, FUNC-141, FUNC-195
- [ ] Template Gallery and resource-backed binding settings (with their SDKs).
  <- FUNC-208, FUNC-240, FUNC-265
- [ ] GitHub connection for deployment. <- FUNC-055

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
