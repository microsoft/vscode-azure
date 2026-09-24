# Azure Functions — Feature Inventory

Source: `microsoft/vscode-azurefunctions` @ `main` (`801689c66f96b31bc9d7c79ff6cc8d65e41b6965`, 2026-09-09), v1.22.1, publisher `ms-azuretools`, extension id `ms-azuretools.vscode-azurefunctions`. 513 TypeScript files under `src/`.
Method: reconcile `package.json` + `package.nls.json` + code (`activate()` / `registerCommands.ts` / `src/**`) + published docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: collected from `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt` (window: 90d; collected 2026-09-24; every emitted event name for the extension; activation pings excluded). Per the repo's telemetry policy the **raw counts are not committed** — this file carries a qualitative band plus an advisory suggestion. Bands are relative to this extension's own distribution: **very high** (the handful of events that make up the core loop), **high**, **moderate**, **low**, **very low** (a handful of users), **none** (no row in the window). The full-number working copy lives in the session artifacts dir (see [Section 9](#9-usage-summary-telemetry)). Roll-up deeplink: [all events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAACpWST2vbQBDF7%2FoU09OuwDa5lrC9BBcMdSh100spYbI7Shb2T9gZyVbwhw%2BSLEFKLj7um3m%2FmcdOIAE6CRhQkdf41haSnANvOrbZ0aQ0bbLic2J1WwUSOPrk8hEMfL1xt5UNLQsVrZwTCpNP1RuHgk%2FIpNWfw112tD2Jqje%2F8LjtKAkvYnWG4wsVggOVjspvH4kF4yt8A3zOeppVL13bk1Bin9M9RgJjhu2XomSW4tOz%2FlnyKxXxxH%2BVZ7TiOxwS0DBb%2FavhiwElpSVVnYHbGLH4N6oAAHapy3ZsZgAwYHObRNersThMLwnDA1NhMODGqm%2F0FGeP9sUn2rkV7HiXpt5hyQYD04Ux69cyhnUviENrLZEjNzzmHX2jP81fiNswhjYG1GJVF9Z39OECupY1WWfQHSZLC%2Boq0GydUT%2BQ5UCUZlSTS0R5dCgkPpKOeNL%2FnUu9AtX3fb%2Fe79fOqXrkPPUwXttwK9UZcnFURvHDNzpi%2Bw6VnksgCAMAAA%3D%3D)

Counts: **81 commands** (74 contributed `A+B`, 7 code-only `B`, 0 contributed-without-handler), **55 settings** (+ 2 deprecated keys read but not contributed, + 10 foreign keys read from `azurite.*` / `azureResourceGroups.*`), **~40 tree node types** across **4 tree surfaces** (+ 4 `invalid*` variants, + trigger/state/access context-value variants on every function node), **~22 `AzureWizard` flows** (+ 4 reusable connection-setting sub-wizard families, + 1 webview-panel flow), **7 debug configuration providers** (code), **1 `taskDefinition`** + **1 task provider**, **7 problemMatchers** + **1 problemPattern**, **2 `jsonValidation`**, **1 view** (in the built-in `debug` container), **1 submenu**, **1 walkthrough** (3 steps, hidden), **77 `view/item/context` entries**, **22 `commandPalette` entries** (19 `when: never`, 2 setting-gated, 1 unconditional), **15 `enablement: !virtualWorkspace` gates**, **1 URI handler**, **1 text document content provider**, **1 CodeLens provider**, **1 exported API** (`1.10.0`, 8 members) + **1 agent metadata contract** (4 commands), **0 dead NLS keys**.
Explicitly zero: **0 contributed debuggers** (debugging reuses the language extensions' debug types), **0 viewsContainers**, **0 viewsWelcome**, **0 keybindings**, **0 languages/grammars**, **0 `enabledApiProposals`**, **0 `!isWeb` gates**, **0 `browser` entry point**, **0 chat participants / LM tools / MCP server definition providers**, **0 webview views** (the Template Gallery is an on-demand webview *panel*), **0 orphan/dead NLS keys** (every one of the 157 `package.nls.json` keys is referenced by the manifest and every manifest `%key%` resolves).

---

## 0. Extension-level shape

- **extensionDependencies (A):** `ms-azuretools.vscode-azureresourcegroups` (hard dependency — the Function App, DTS, and workspace trees are all branches grafted onto the Azure Resources host views `azureResourceGroups`, `azureFocusView`, `azureWorkspace`).
- **activationEvents (A):** `onDebugInitialConfigurations`, `onFileSystem:vscode-azurefunctions-static-content`, `onUri`, `onView:azureWorkspace`, `workspaceContains:**/host.json`. Plus implicit activation via `x-azResources.activation` and contributed commands.
- **engines.vscode:** `^1.106.0`. **preview:** not set (GA). **main:** `./main.js` (Node host only; no `browser`).
- **capabilities (A):** `virtualWorkspaces = { supported: 'limited', description: 'In virtual workspaces, creating a new function project, deploying, and debugging are not supported.' }`. Backed by 15 per-command `enablement: !virtualWorkspace` gates (Section 1) and `when: !virtualWorkspace` on the host-debug view. `untrustedWorkspaces` is not declared.
- **x-azResources (A):**
  - `azure.branches`: `{ type: 'FunctionApp' }`, `{ type: 'DurableTaskScheduler' }`
  - `workspace.branches`: `{ type: 'func' }`, `{ type: 'DurableTaskSchedulerEmulator' }`; `workspace.resources: true`
  - `commands` (host "Create Resource" entries): `azureFunctions.createFunctionApp` (type `FunctionApp`, detail "For serverless, event driven apps and automation."), `azureFunctions.durableTaskScheduler.createScheduler` (type `DurableTaskScheduler`, detail "For long-running and reliable workflows.")
  - `activation.onFetch` and `activation.onResolve`: `microsoft.web/sites`, `microsoft.durabletask/schedulers`
- **agentMetadata (A, top-level manifest key):** `{ version: '1.0', getCommandsCommandId: 'azureFunctions.agent.getCommands', runWizardCommandWithoutExecutionCommandId: 'azureFunctions.agent.runWizardCommandWithoutExecution', runWizardCommandWithInputsCommandId: 'azureFunctions.agent.runWizardCommandWithInputs', getAgentBenchmarkConfigsCommandId: 'azureFunctions.agent.getAgentBenchmarkConfigs' }`. This is the GitHub Copilot for Azure (`@azure`) agent contract — see Section 7.
- **jsonValidation (A):** `function.json` -> `https://json.schemastore.org/function.json`; `host.json` -> `https://json.schemastore.org/host.json`.
- **Exported extension API (B)** — `activate()` returns `createApiProvider([...])`:
  - `apiVersion: '1.10.0'`
  - `revealTreeItem(resourceId)` — telemetry `api.revealTreeItem`.
  - `createFunction(options: ICreateFunctionOptions)` — telemetry `api.createFunction`. Options include `folderPath`, `templateId`, `functionName`, `functionSettings`, `language`, `languageModel`, `version`, `projectTemplateKey`, `suppressOpenFolder`, `executeStep`. Creates a project first when none exists.
  - `downloadAppSettings(client: IAppSettingsClient)` / `uploadAppSettings(client, exclude?)` — telemetry `api.downloadAppSettings` / `api.uploadAppSettings`. Generic local.settings.json <-> remote sync, callable by other App Service–family extensions.
  - `listLocalProjects()` / `listLocalFunctions(project)` — telemetry `listLocalProjects` / `listLocalFunctions`. **`listLocalProjects` is the single highest-volume event in the extension by an enormous margin** — it is polled by other extensions, so it is a critical external contract, not a user feature.
  - `isFuncCoreToolsInstalled(message)` — telemetry `azureFunctions.api.isFuncCoreToolsInstalled`.
  - `startFuncProcess(buildPath, args, env)` — telemetry `azureFunctions.api.startFuncProcess`.
  - **Test-only API (B):** when `VSCODE_RUNNING_TESTS` is set, `apiVersion` becomes `'99.0.0'` and `src/testApi.ts` exposes internals (template provider, `getFunctionTemplates`, etc.).
  - **Consumed API:** the Container Apps extension API (`deployWorkspaceProject` with `suppressContainerAppCreation`) is called by the containerized create flow (Section 5.4).
- **Activation wiring (B)** — `activate()` (`src/extension.ts:61-151`):
  1. `createAzExtOutputChannel('Azure Functions', ext.prefix)` (`ext.prefix = 'azureFunctions'`); diagnostic collection `Azure Functions`.
  2. `registerUIExtensionVariables`, `registerAzureUtilsExtensionVariables`, `registerAppServiceExtensionVariables`.
  3. Everything below runs inside `callWithTelemetryAndErrorHandling('azureFunctions.activate', ...)` with `isActivationEvent = 'true'` and a `mainFileLoad` measurement.
  4. `runPostFunctionCreateStepsFromCache()` (finishes post-create work deferred across a window reload / open-folder).
  5. `validateFuncCoreToolsIsLatest()` (async; outdated / multiple-install warnings).
  6. `verifyVSCodeConfigOnActivate(workspaceFolders)` under callback `azureFunctions.validateFunctionProjects`, re-run via `registerEvent` on `onDidChangeWorkspaceFolders`.
  7. `new CentralTemplateProvider()` -> `ext.templateProvider`.
  8. `registerErrorHandler(c => c.errorHandling.suppressReportIssue = true)` (global) + `registerReportIssueCommand('azureFunctions.reportIssue')`.
  9. DTS services: `HttpDurableTaskSchedulerClient`, `DockerDurableTaskSchedulerEmulatorClient` (via `ShellContainerClient` / `@microsoft/vscode-container-client`), `DurableTaskSchedulerDataBranchProvider`.
  10. `registerCommands(services)` — also registers a CodeLens provider for `**/*.eventgrid.json`.
  11. `registerFuncHostTaskEvents()`; `registerFunctionHostDebugView(context)`.
  12. `vscode.debug.registerDebugConfigurationProvider` for types `node`, `python`, `debugpy`, `java`, `ballerina`, `PowerShell`, `go` (no `coreclr` provider — .NET uses `${command:azureFunctions.pickProcess}` in launch.json). `registerGoDebugSessionCleanup()`.
  13. `vscode.tasks.registerTaskProvider('func', new FuncTaskProvider(...))`.
  14. `vscode.window.registerUriHandler(...)` -> `handleUri`.
  15. `vscode.workspace.registerTextDocumentContentProvider('vscode-azurefunctions-static-content', ...)` (read-only virtual docs).
  16. `createExperimentationService(context)`.
  17. Legacy Azure Resources API v1: `registerApplicationResourceResolver(AzExtResourceType.FunctionApp, new FunctionAppResolver())` and `registerWorkspaceResourceProvider('func', new FunctionsLocalResourceProvider())`.
  18. Azure Resources API v2 (`2.0.0`): DTS azure branch `'DurableTaskScheduler'`, `DurableTaskSchedulerWorkspaceResourceProvider`, workspace branch `'DurableTaskSchedulerEmulator'`.
  - **deactivate():** disposes the DTS emulator client (stops/removes emulator containers), the terminal event reader, and the func-host task emitters.
- **Telemetry (B):** EventName convention `<extensionId>/<callbackId>` lowercased. Handlers that set `context.telemetry.eventVersion = 2` emit `<id>v2` (`executeFunction`, `openFile`, `appSettings.upload`; `deploy`/`deployProject`/`deploySlot` split across `<id>` and `<id>v2` — see Section 9). `suppressIfSuccessful` is set on `provideDebugConfigurations`, `resolveDebugConfiguration` (lifted when `preLaunchTask` is the func host task), `provideTasks`, `resolveTask`, `postFunctionCreate`, `onFuncTaskChanged`, `refreshFileWatcher`, `verifyVSCodeConfigOnActivate`, `AzureAccountTreeItemWithProjects.*`, and the `registerEvent` task/debug listeners. No `suppressAll`. Non-command callback ids:

  | Callback id | Site | Purpose |
  |---|---|---|
  | `azureFunctions.activate` | `extension.ts` | activation (excluded from usage query) |
  | `azureFunctions.validateFunctionProjects` | `extension.ts` | project config verify on activate / folder change |
  | `listLocalProjects` / `listLocalFunctions` | `workspace/*.ts` | exported API (cross-extension) |
  | `azureFunctions.api.isFuncCoreToolsInstalled` / `azureFunctions.api.startFuncProcess` | `extension.ts`, `pickFuncProcess.ts` | exported API |
  | `api.createFunction` / `api.revealTreeItem` / `api.downloadAppSettings` / `api.uploadAppSettings` | `commands/api/*` | exported API |
  | `resolveResource` | `FunctionAppResolver.ts` | Function App resolve for the host tree |
  | `createlocalProjectTreeItem`, `onFuncTaskChanged`, `refreshFileWatcher` | `tree/localProject/*` | workspace tree |
  | `getData.initSite`, `functionApp.initSiteFailed`, `functionApp.pickTreeItem` | `tree/Resolved*` | remote tree |
  | `AzureAccountTreeItemWithProjects.onDidChangeWorkspaceFolders` / `.onDidChangeConfiguration` | `tree/AzureAccountTreeItemWithProjects.ts` | legacy tree refresh |
  | `provideDebugConfigurations`, `resolveDebugConfiguration` | `debug/FuncDebugProviderBase.ts` | F5 / pre-debug validation |
  | `provideTasks`, `resolveTask` | `debug/FuncTaskProvider.ts` | task provider |
  | `azureFunctions.onDidStartTask`, `.onDidEndTask`, `.onFuncTaskStarted`, `.onDidTerminateDebugSession` | `funcCoreTools/funcHostTask.ts` | host-task lifecycle listeners |
  | `azureFunctions.go.validateDelveBeforeDebug`, `azureFunctions.go.attachDlv`, `azureFunctions.validateDelveInstalled`, `azureFunctions.validateGoInstalled` | `debug/GoDebugProvider.ts`, `debug/validateDelveInstalled.ts`, `funcCoreTools/validateGoInstalled.ts` | Go toolchain |
  | `azureFunctions.validateFuncCoreToolsInstalled`, `azureFunctions.validateFuncCoreToolsIsLatest` | `funcCoreTools/*` | Core Tools gates |
  | `azureFunctions.createNewProjectStarted` | `ProjectCreateStepBase.ts` | project creation reached execute |
  | `azureFunctions.templateGallery.getTemplates` / `.getReadme` / `.createProject` / `.continueInChat` | `FunctionsTemplateGalleryController.ts` | Template Gallery webview RPC |
  | `postFunctionCreate`, `initializeTemplates`, `copyCSharpSettingsFromJS` | create-function / templates | post-create, template init |
  | `postDeploy` | `deploy/notifyDeployComplete.ts` | post-deploy notification buttons |
  | `eventGridSampleModified` | `EventGridFileOpenStep.ts` | Event Grid sample edited |
  | `azureFunctions.handleUri` | `downloadAzureProject/handleUri.ts` | open-from-portal URI |
  | `azureFunctions.createFunctionAppViaAgent` | `agent/agentIntegration.ts` | Copilot agent create |
  | `appservice.streamingLogs`, `listApplicationSettings`, `deployWarning.openInNewWindow` | shared `@microsoft/vscode-azext-azureappservice` / `-azureappsettings` (no reference in this repo's `src/`) | shared-lib callbacks emitted under this extension id (log stream session, settings list, "deploy folder is not open — open in new window?" prompt) |

## 1. Commands (A + B)

74 contributed + 7 code-only. Every contributed command has a handler (registered in `src/commands/registerCommands.ts`, except `azureFunctions.funcHostDebug.*` in `src/debug/registerFunctionHostDebugView.ts`). Unless noted, registration is `registerCommandWithTreeNodeUnwrapping` and the telemetry callback id equals the command id. All commands have category "Azure Functions". Several menu entries also reuse the host command `azureResourceGroups.refresh` (Section 3, Menus).

`when` abbreviations: `view~RG` = `view =~ /(azureResourceGroups|azureFocusView)/`; `view~ALL` = `view =~ /(azureWorkspace|azureResourceGroups|azureFocusView)/`; `view==WS` = `view == azureWorkspace`. **`!vw`** = `enablement: !virtualWorkspace`.

### 1.1 Local project authoring

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.createNewProject` | Create New Project... | A+B | **high** · lean Migrate | `!vw`; icon light/dark `CreateNewProject.svg`. Submenu `1_projects@2`; walkthrough step link; click command of the empty-workspace "Create Function Project..." node. Opens the Template Gallery panel when `enableTemplateGallery` is true. Cancel share is about half (wizard exploration); a separate `azureFunctions.createNewProjectStarted` event fires once execution begins. |
| `azureFunctions.createNewProjectWithDockerfile` | Create New Containerized Project... | A+B | moderate · needs a human | `!vw`. Submenu `1_projects@3`. Multi-line registration (passes `containerizedProject: true`). Cancel-dominant with a minority of successes. |
| `azureFunctions.createFunction` | Create Function... | A+B | **high** · lean Migrate | `!vw`; icon `AddFunction.svg`. `view==WS && viewItem =~ /azFuncLocalProject/i` @ `inline` and `1@1`; submenu `1_projects@1`; walkthrough completion event. Redirects to Create New Project when no project is found. Not supported for Go projects. |
| `azureFunctions.addBinding` | Add binding... | A+B | moderate · needs a human (**candidate Drop**) | `!vw`. `view~ALL && viewItem =~ /Local;ReadWrite;Function;/i` @ `3@1`; `explorer/context` and `editor/context` when `resourceFilename==function.json` @ `zzz_binding@1`. Only works for `function.json` (legacy script-model) projects. **Near-zero successes** — failures and cancels dominate. |
| `azureFunctions.initProjectForVSCode` | Initialize Project for Use with VS Code... | A+B | **high** · lean Migrate | `!vw`. Click command of the `initProject` tree node; walkthrough step. Also offered by the activation-time "project not initialized" prompt. |
| `azureFunctions.installOrUpdateFuncCoreTools` | Install or Update Azure Functions Core Tools | A+B | **high** · **Migrate + fix** | `!vw`. Palette only. **Failures dominate** (npm/brew shell-outs) — people want this; reliability work, not a drop. Blocked when `funcCliPath` is set. |
| `azureFunctions.uninstallFuncCoreTools` | Uninstall Azure Functions Core Tools | A+B | low · Migrate + fix | `!vw`. Palette only. Mostly fails. |
| `azureFunctions.pickProcess` | Pick Process | A+B | **high** · Migrate + fix | Palette `when: never`. Referenced as `${command:azureFunctions.pickProcess}` in generated .NET (`coreclr`) `launch.json`; starts the func host task and returns the worker PID. Notable failure share (host start / timeout — `pickProcessTimeout`). |
| `azureFunctions.appSettings.encrypt` | Encrypt Settings | A+B | low · lean Migrate | `!vw`. `explorer/context` when `resourceFilename==local.settings.json` @ `zzz_appSettings@2`. Shells out to `func settings encrypt`. |
| `azureFunctions.appSettings.decrypt` | Decrypt Settings | A+B | low · lean Migrate | `!vw`. `explorer/context` on `local.settings.json` @ `zzz_appSettings@1`. `func settings decrypt`. About a third fail. |
| `azureFunctions.setAzureWebJobsStorage` | Set AzureWebJobsStorage... | A+B | low · needs a human | Palette only. Runs the storage connection sub-wizard (Section 5.10) against `local.settings.json`. Cancel-dominant. |
| `azureFunctions.addLocalMIConnections` | Add Local Project Identity Connections... | A+B | low · needs a human | `view==WS && viewItem =~ /(azFuncLocalProject.*convert)\|(applicationSettingItem.*convertSetting.*localSettings)\|(applicationSettings.*convert.*localSetting)/i` @ `1@3`. Converts connection-string settings to identity-based settings in `local.settings.json`. Cancel-dominant. |
| `azureFunctions.eventGrid.sendMockRequest` | Save and execute... | A+B | very low · needs a human | `editor/title` when `resourceFilename=~/.*.eventgrid.json$/` @ `navigation@1`; icon `$(notebook-execute)`; also a CodeLens on `*.eventgrid.json`. **Every recorded invocation failed** (small N). |
| `azureFunctions.openWalkthrough` | Open Azure Functions Extension Walkthrough | A+B | low · lean Migrate | Palette only. The walkthrough itself is `when: "false"` so this command is the only way to reach it. Walkthrough `functionsStart` ("Get Started with Azure Functions") has 3 steps: `scenarios` (markdown `resources/walkthroughs/scenarios.md`, completes `onStepSelected`), `create` (links `createNewProject`, completes `onCommand:azureFunctions.createFunction`), `initialize` (links `initProjectForVSCode`, completes `onCommand:azureFunctions.initProjectForVSCode`). |

### 1.2 Functions (local + remote)

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.executeFunction` | Execute Function Now... | A+B | **high** · lean Migrate | `view~ALL && viewItem =~ /Function;/i` @ `1@1`. Emits `azureFunctions.executeFunctionv2` (`eventVersion = 2`). HTTP -> POST to trigger URL; non-HTTP -> POST `{input}` to `/admin/functions/<name>`; remote adds `x-functions-key` = master key; Event Grid triggers branch to the sample-file flow; request body pre-filled from template sample data. Notable failure share (local host not running -> "Failed to connect... running locally"). |
| `azureFunctions.copyFunctionUrl` | Copy Function Url | A+B | **high** · lean Migrate | `view~ALL && viewItem =~ /Function;Http;/i` @ `1@1`. Resolves auth level + key. |
| `azureFunctions.enableFunction` | Enable Function | A+B | moderate · lean Migrate | `view~ALL && viewItem =~ /Function;.*;Disabled;/i` @ `2@1`. Writes `AzureWebJobs.<name>.Disabled = false` through the owning project's settings (remote app settings or `local.settings.json`). Throws for Functions v1. |
| `azureFunctions.disableFunction` | Disable Function | A+B | moderate · lean Migrate | `view~ALL && viewItem =~ /Function;.*;Enabled;/i` @ `2@1`. Writes `AzureWebJobs.<name>.Disabled = true` (same mechanism). |
| `azureFunctions.deleteFunction` | Delete Function... | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /Remote;ReadWrite;Function;/i` @ `2@2`. `webApps.deleteFunction`. A quarter fail. |

### 1.3 Deploy + deployment source

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.deploy` | Deploy to Function App... | A+B | **very high** (the top user-invoked command) · lean Migrate | `!vw`; icon `$(cloud-upload)`. `view~RG && viewItem =~ /azFunc(ProductionSlot\|Flex)/` @ `2@1`; `explorer/context` when `explorerResourceIsFolder == true` @ `zzz_azuretools_deploy@2`. Handler `deployProductionSlot`. Counts split across `deploy` and `deployv2`. Meaningful failure and cancel shares on top of the highest volume — reliability matters most here. |
| `azureFunctions.deployProject` | Deploy to Azure... | A+B | **high** · lean Migrate | `!vw`; icon `$(cloud-upload)`. Submenu `2_deploy@1`; `view==WS && viewItem =~ /azFuncLocalProject/i` @ `inline` and `1@2`. Same handler as `deploy` (starts from the workspace). |
| `azureFunctions.deploySlot` | Deploy to Slot... | A+B | moderate · lean Migrate | `!vw`. `view~RG && viewItem =~ /azFuncSlot(?!s)/` @ `2@1`. |
| `azureFunctions.deployByFunctionAppId` | Deploy to Function App by ID... | A+B | very low · needs a human | `!vw`; palette `when: never`. Plain `registerCommand`; programmatic entry point taking a resource id (for other extensions / agents). **All recorded invocations failed** (small N, recently added). |
| `azureFunctions.redeploy` | Redeploy | A+B | low · Migrate + fix | `view~RG && viewItem =~ /azFunc.*deployment\//` @ `1@2`. Failures dominate. |
| `azureFunctions.viewDeploymentLogs` | View Deployment Logs | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /azFunc.*deployment\//` @ `1@1`. Registered via `registerSiteCommand`. |
| `azureFunctions.viewCommitInGitHub` | View Commit in GitHub | A+B | low · **candidate Drop** | `view~RG && viewItem =~ /azFunc.*deployment\/github/` @ `1@4`. **Zero successes** — every recorded invocation was canceled. |
| `azureFunctions.openInPortal` | Open in Portal | A+B | low · lean Migrate | Palette `when: never`. `view~RG && viewItem =~ /azFunc.*deployment\//` @ `1@3`. |
| `azureFunctions.configureDeploymentSource` | Configure Deployment Source... | A+B | moderate · needs a human | `view~RG && viewItem =~ /azFunc(Production\|)Slot(?!s)(?!.*container)/` @ `2@2`. Shared `editScmType` (None / LocalGit / GitHub). Cancel-dominant, few successes. |
| `azureFunctions.connectToGitHub` | Connect to GitHub Repository... | A+B | moderate · needs a human | **No menu entry** — palette only. **Near-zero successes**; failures and cancels dominate. |
| `azureFunctions.disconnectRepo` | Disconnect from Repo... | A+B | low · needs a human (pairs with deployment source) | `view~RG && viewItem =~ /azFunc.*deploymentsConnected/` @ `1@2`. |

### 1.4 Function App lifecycle, slots, logs, remote debug

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.createFunctionApp` | Create Function App in Azure... | A+B | **high** · Migrate + fix | Icon `$(add)`. `x-azResources` create command; `view == azureResourceGroups && viewItem =~ /functionapp/i && viewItem =~ /azureResourceTypeGroup/i` @ `1@1`; deploy's "Create new function app..." pick. Cancel-dominant, and failures are comparable to successes — the flagship Azure-side flow needs reliability work. |
| `azureFunctions.createFunctionAppAdvanced` | Create Function App in Azure... (Advanced) | A+B | moderate · Migrate + fix | Same type-group menu @ `1@2`. Success, failure, cancel roughly a third each. |
| `azureFunctions.deleteFunctionApp` | Delete Function App... | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /azFunc(ProductionSlot\|Flex)/` @ `3@5`. Containerized apps use a dedicated delete step (Section 5.5). |
| `azureFunctions.startFunctionApp` | Start | A+B | **high** · lean Migrate | `view~RG && viewItem =~ /azFunc(Production\|)(Slot\|Flex)(?!s)(?!.*container)/` @ `3@1`. |
| `azureFunctions.stopFunctionApp` | Stop | A+B | moderate · lean Migrate | same regex @ `3@2`. |
| `azureFunctions.restartFunctionApp` | Restart | A+B | moderate · lean Migrate | same regex @ `3@3`. |
| `azureFunctions.browseWebsite` | Browse Website | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /azFunc(Production\|)(Slot\|Flex)(?!s)/` @ `1@2`. |
| `azureFunctions.viewProperties` | View Properties | A+B | low · lean Migrate (host has a generic equivalent) | Palette `when: never`. `view~RG && viewItem =~ /azFunc(Production\|)(Slot\|Flex)(?!s).*slot/` @ `6@1`; click command of container/local function nodes. Remote function nodes instead click `azureResourceGroups.viewProperties`. |
| `azureFunctions.startStreamingLogs` | Start Streaming Logs | A+B | moderate · lean Migrate | App: `view~RG && viewItem =~ /azFunc(Production\|)Slot(?!s)(?!.*container)/` @ `4@1`; function: `view~RG && viewItem =~ /Remote;.*;Function;(?!.*container)/i` @ `3@1`. Windows: pings the app, offers to enable file application logging, then shared `appservice.startStreamingLogs` (Kudu log stream, callback `appservice.streamingLogs`). **Linux: no log stream** — requires `APPLICATIONINSIGHTS_CONNECTION_STRING`/`APPINSIGHTS_INSTRUMENTATIONKEY`, finds the App Insights component, and opens the portal Live Metrics (QuickPulse) blade. Also a post-deploy button. |
| `azureFunctions.stopStreamingLogs` | Stop Streaming Logs | A+B | moderate · lean Migrate (pairs with start) | same regexes @ `4@2` / `3@2`. |
| `azureFunctions.startRemoteDebug` | Start Remote Debugging | A+B | **none** · needs a human | `!vw`. `view~RG && viewItem =~ /azFunc(Production\|)Slot(?!.*container)/ && config.azureFunctions.enableRemoteDebugging == true` @ `5@1`; palette gated by the same setting (default `false`, "experimental"). Delegates to Java flow when `enableJavaRemoteDebugging` and `FUNCTIONS_WORKER_RUNTIME == java`; otherwise shared `appservice.startRemoteDebug` (Node on Linux dedicated plans). No telemetry row because the default-off gate hides it. |
| `azureFunctions.startJavaRemoteDebug` | Attach Debugger | A+B | **none** · needs a human (**candidate Drop**) | `!vw`. Same regex + `config.azureFunctions.enableJavaRemoteDebugging == true` @ `5@2`. After a modal confirm, updates site config (`use32BitWorkerProcess=false`, `webSocketsEnabled=true`) and app settings (`JAVA_OPTS`, `HTTP_PLATFORM_DEBUG_PORT`), starts a local `DebugProxy` websocket tunnel (publish credentials) on a free port, attaches a `java` `attach` debug session, disposes the proxy on session end. Default-off, experimental, Windows only. |
| `azureFunctions.createSlot` | Create Slot... | A+B | low · lean Migrate (slots decided as a unit) | `view~RG && viewItem == azFuncSlots` @ `1@1`. Delegates to `SlotsTreeItem.createChild`. |
| `azureFunctions.deleteSlot` | Delete Slot... | A+B | very low · lean Migrate (slots as a unit) | `view~RG && viewItem =~ /azFuncSlot(?!s)/` @ `3@5`. Multi-line registration via `deleteNode(..., pickSlotContextValue)`. |
| `azureFunctions.swapSlot` | Swap Slot... | A+B | low · lean Migrate (slots as a unit) | `view~RG && viewItem =~ /azFuncSlot(?!s)/` @ `3@4`. Shared `appservice.swapSlot`. |

### 1.5 App settings

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.appSettings.add` | Add New Setting... | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /applicationSettings.*azFunc/` @ `1@1`. Multi-line registration (shared `createChildNode`). |
| `azureFunctions.appSettings.download` | Download Remote Settings... | A+B | moderate · lean Migrate | same @ `1@2`. Merges into `local.settings.json` (re-encrypts if encrypted; prompts on conflicts). |
| `azureFunctions.appSettings.upload` | Upload Local Settings... | A+B | moderate · Migrate + fix | same @ `1@3`. Emits `appSettings.uploadv2`. Also a post-deploy button. A third fail. |
| `azureFunctions.appSettings.edit` | Edit Setting... | A+B | moderate · lean Migrate | `view~RG && viewItem =~ /applicationSettingItem.*azFunc/` @ `1@1`. About half cancel. |
| `azureFunctions.appSettings.rename` | Rename Setting... | A+B | low · lean Migrate | same @ `1@2`. Cancel-dominant. |
| `azureFunctions.appSettings.delete` | Delete Setting... | A+B | low · lean Migrate | same @ `1@3`. Multi-line registration. |
| `azureFunctions.appSettings.toggleSlotSetting` | Toggle as Slot Setting | A+B | low · lean Migrate (slots as a unit) | `view~RG && viewItem =~ /applicationSettingItem.*azFunc(?!.*container)/` @ `1@4`. |
| `azureFunctions.toggleAppSettingVisibility` | Toggle App Setting Visibility. | A+B | **high** · lean Migrate | Palette `when: never`; icon `$(eye)`. `view =~ /(azureResourceGroups\|azureFocusView\|azureWorkspace)/ && viewItem =~ /applicationSettingItem.*(azFunc\|localSettings)/` @ `inline`. Registered with 250 ms debounce. |
| `azureFunctions.addRemoteMIConnections` | Add Function App Identity Connections... | A+B | low · needs a human | `view~RG && viewItem =~ /(applicationSettings.*azFunc.*convert)(?!.*container)\|(applicationSettingItem.*azFunc(?!.*container).*convertSetting)/i` @ `1@4`. **Zero successes** — cancel-dominant. |

### 1.6 Managed identity

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.assignManagedIdentity` | Assign Managed Identity to Function App... | A+B | low · needs a human | Icon `$(add)`. `view~RG && viewItem =~ /userAssignedIdentities/` @ `inline` and `1@1`. Cancel-dominant. |
| `azureFunctions.unassignManagedIdentity` | Unassign Managed Identity from Function App... | A+B | very low · lean Migrate (pairs with assign) | Palette `when: never`. `view~RG && viewItem =~ /userAssignedIdentity/` @ `1@1` (note: also matches the `userAssignedIdentities` parent — no `\b`/`(?!s)` guard). |
| `azureFunctions.enableSystemIdentity` | Enable System Assigned Identity | A+B | low · lean Migrate | `view~RG && viewItem =~ /systemIdentity.*disabled/i` @ `1@1`. |

### 1.7 Durable Task Scheduler

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.durableTaskScheduler.createScheduler` | Create Durable Task Scheduler... | A+B | moderate · needs a human | `x-azResources` create command; palette entry with empty `when`; `view~RG && viewItem =~ /DurableTaskScheduler/i && viewItem =~ /azureResourceTypeGroup/i` @ `1@1`. **Overwhelmingly canceled, near-zero successes** (provider-not-registered and long-running create are likely factors). |
| `azureFunctions.durableTaskScheduler.createTaskHub` | Create Task Hub... | A+B | **none** · needs a human | Palette `when: never`. `view~RG && viewItem =~ /azFunc.dts.scheduler/` @ `1@1`. |
| `azureFunctions.durableTaskScheduler.deleteScheduler` | Delete Scheduler... | A+B | very low · needs a human | Palette `when: never`. `view~RG && viewItem =~ /azFunc.dts.scheduler/` @ `2@1`. |
| `azureFunctions.durableTaskScheduler.deleteTaskHub` | Delete Task Hub... | A+B | **none** · needs a human | Palette `when: never`. `view~RG && viewItem =~ /azFunc.dts.taskHub/` @ `2@1`. |
| `azureFunctions.durableTaskScheduler.copySchedulerConnectionString` | Copy Connection String | A+B | **none** · needs a human | Palette `when: never`. `view~RG && viewItem =~ /azFunc.dts.scheduler/` @ `3@1`. Builds `Endpoint=<url>;Authentication=<type>[;TaskHub=<hub>]`. |
| `azureFunctions.durableTaskScheduler.copySchedulerEndpoint` | Copy Endpoint | A+B | very low · needs a human | Palette `when: never`. `view =~ /(azureResourceGroups\|azureWorkspace\|azureFocusView)/ && viewItem =~ /azFunc.dts.schedulerEndpoint/` @ `3@2`. |
| `azureFunctions.durableTaskScheduler.copyEmulatorConnectionString` | Copy Connection String | A+B | very low · needs a human | Palette `when: never`. `view==WS && viewItem =~ /azFunc.dts.emulatorInstance/` @ `3@1`. |
| `azureFunctions.durableTaskScheduler.openTaskHubDashboard` | Open in Dashboard | A+B | low · lean Migrate | Palette `when: never`; icon `$(dashboard)`. `view =~ /(azureResourceGroups\|azureWorkspace\|azureFocusView)/ && viewItem =~ /azFunc.dts.taskHubDashboard/` @ `1@1` and `inline`. |
| `azureFunctions.durableTaskScheduler.startEmulator` | Start Durable Task Emulator | A+B | moderate · **Migrate + fix** | Icon `$(debug-start)`. `view==WS && viewItem =~ /azFunc.dts.emulators/` @ `1@1` and `inline`. `docker run` of `<emulatorRegistry>/<emulatorImage>:<emulatorTag>`. **Failures dominate** (Docker not installed/running is the likely cause). |
| `azureFunctions.durableTaskScheduler.stopEmulator` | Stop Emulator | A+B | low · lean Migrate | Palette `when: never`; icon `$(debug-stop)`. `view==WS && viewItem =~ /azFunc.dts.emulatorInstance/` @ `1@1` and `inline`. |
| `azureFunctions.durableTaskScheduler.getEmulators` | *(not contributed)* | **B only** | low · lean Migrate (internal) | Returns running emulator instances; invoked via `executeCommand` by `DTSEmulatorStartStep`. |

### 1.8 Functions Host debug view

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.funcHostDebug.refresh` | Refresh | A+B | moderate · lean Migrate | Palette `when: never`; icon `$(refresh)`. `view/title` when `view == azureFunctions.funcHostDebugView` @ `navigation@1`. |
| `azureFunctions.funcHostDebug.clearStoppedSessions` | Clear Stopped Sessions | A+B | moderate · lean Migrate | Icon `$(trash)`. `view/title` @ `navigation@2`. (Palette-visible.) |
| `azureFunctions.funcHostDebug.showRecentLogs` | Show Recent Host Logs | A+B | moderate · lean Migrate | Palette `when: never`; icon `$(output)`. `view == azureFunctions.funcHostDebugView && viewItem == azFunc.funcHostDebug.hostTask` / `...stoppedHostTask` @ `inline`. Opens an untitled `log` document. |
| `azureFunctions.funcHostDebug.copyRecentLogs` | Copy Recent Host Logs | A+B | low · lean Migrate | Palette `when: never`; icon `$(copy)`. Same two `when`s @ `inline`. |
| `azureFunctions.funcHostDebug.askCopilot` | Ask Copilot | A+B | low · lean Migrate | Palette `when: never`; icon `$(sparkle)`. `viewItem == azFunc.funcHostDebug.hostError` / `hostTask` / `stoppedHostTask` @ `1@1`. Builds a diagnostic prompt (port, workspace, cwd, ANSI-stripped error output) and runs `workbench.action.chat.open { mode: 'agent', query }`. |

### 1.9 Integration / plumbing

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureFunctions.reportIssue` | Report Issue... | A+B | very low · lean Migrate (framework-provided) | `registerReportIssueCommand`. Pairs with the global `suppressReportIssue` handler. |
| `azureFunctions.getMcpHostKey` | Retrieve the MCP host key for the Function App specified by the resource ID. | A+B | low · Migrate + fix | Palette `when: never`. Referenced as `${command:azureFunctions.getMcpHostKey}` in generated `.vscode/mcp.json` inputs. `webApps.listHostKeys` -> `systemKeys.mcp_extension` (`McpExtensionServer`) or `functionKeys.default` (`SelfHostedMcpServer`); returns the string (no clipboard). A third fail. |
| `azureFunctions.openFile` | *(not contributed)* | **B only** | **high** · lean Migrate | Emits `openFilev2`. Click command for shared-lib Site Files / Log Files file nodes (`${ext.prefix}.openFile` convention). |
| `azureFunctions.showOutputChannel` | *(not contributed)* | **B only** | **high** · lean Migrate | Opens the output channel; used as the activity-child command of `DeployFunctionCoreToolsStep` and in the OpenAPI "check output window" link. |
| `azureFunctions.agent.getCommands` | *(not contributed; referenced by `agentMetadata`)* | **B only** | no telemetry (raw `vscode.commands.registerCommand`) · needs a human | Returns the agent-invocable command list: `azureFunctions.createFunctionApp` ("Create Function App", wizard config), `azureFunctions.createFunction` ("Create Function Locally"), `azureFunctions.deploy` ("Deploy to Function App"). |
| `azureFunctions.agent.runWizardCommandWithoutExecution` | *(not contributed)* | **B only** | no telemetry of its own · needs a human | Runs `createFunctionApp` prompts only (`skipExecute`) under callback `azureFunctions.createFunctionAppViaAgent` (no row in window). |
| `azureFunctions.agent.runWizardCommandWithInputs` | *(not contributed)* | **B only** | no telemetry of its own · needs a human | Runs `createFunctionApp` with a pre-filled input queue. |
| `azureFunctions.agent.getAgentBenchmarkConfigs` | *(not contributed)* | **B only** | no telemetry · candidate Drop (benchmark harness only) | Returns `AgentBenchmarkConfig[]` ("Learn - ..." Q&A prompts and "Create Function App" prompts) for the agent test harness. |

## 2. Settings / Configuration (A)

55 contributed settings in two `configuration` groups ("Durable Task Scheduler": 3; "Azure Functions": 52). Settings emit no telemetry event of their own. "Scope" blank = default (`window`). Every key below is prefixed `azureFunctions.`.

| Key | Type / default | Scope | Consumer (B) / notes |
|---|---|---|---|
| `durableTaskScheduler.emulatorRegistry` | string / `mcr.microsoft.com` | | DTS emulator `docker run` image registry. |
| `durableTaskScheduler.emulatorImage` | string / `dts/dts-emulator` | | Emulator image name; also used to recognise running emulator containers. |
| `durableTaskScheduler.emulatorTag` | string / `latest` | | Emulator image tag. |
| `templateFilter` | enum `Verified`/`Core`/`All` / `Verified` | resource | **Deprecated** (`deprecationMessage`: no longer used to filter). Not read by code; template quick pick groups by each template's own `templateFilter` field. Do not migrate. |
| `projectRuntime` | enum `~1`..`~4` | resource | Project Functions version; written by init; default for create-function-app version. |
| `projectLanguage` | enum `C#`, `F#`, `C#Script` (Preview), `F#Script` (Preview), `Java`, `JavaScript`, `PowerShell`, `Python`, `TypeScript`, `Go` (Preview), `Custom` | resource | Project language; written by init/create; drives template, debug, deploy behavior. |
| `projectLanguageModel` | number | resource | Programming model (Node v4, Python v2). |
| `projectTemplateKey` | string | resource | Template provider key override (normally auto-detected). |
| `deploySubpath` | string | resource | Deploy folder under the workspace folder (e.g. `bin/Release/.../publish`); written by init for compiled languages; ignored for non-zip deploys. |
| `projectSubpath` | string | resource | Project root when not at the workspace-folder root / multi-project workspaces. |
| `showCoreToolsWarning` | boolean / `true` | | Outdated Core Tools warning (activation, deploy). |
| `showMultiCoreToolsWarning` | boolean / `true` | | Multiple Core Tools installs warning. |
| `show64BitWarning` | boolean / `true` | | .NET Framework project needs 64-bit Core Tools. |
| `enableRemoteDebugging` | boolean / `false` | | Only referenced in manifest `when` clauses gating `startRemoteDebug` (experimental). |
| `enableJavaRemoteDebugging` | boolean / `false` | | Gates `startJavaRemoteDebug` menus; read by `startRemoteDebug` to route Java apps. |
| `showProjectWarning` | boolean / `true` | | Uninitialized-project prompt on activation. |
| `showPythonVenvWarning` | boolean / `true` | | Missing Python venv warning. |
| `showDeploySubpathWarning` | boolean / `true` | | No reference in this repo's `src/` — presumably read by a shared deploy helper; **verify** before migrating. |
| `showTargetFrameworkWarning` | boolean / `true` | | .NET target-framework mismatch warning. |
| `showExtensionsCsprojWarning` | boolean / `true` | | `extensions.csproj` vs extension-bundle mismatch warning. |
| `pickProcessTimeout` | integer / `60` | | Seconds `pickProcess` waits for the host process. |
| `templateVersion` | string | | Pin template release version (restart required). |
| `projectOpenBehavior` | enum `AddToWorkspace`/`OpenInNewWindow`/`OpenInCurrentWindow` | | Post-create open behavior (skips the prompt). |
| `preDeployTask` | string | resource | Task run before zip deploy (written by init for compiled languages). |
| `postDeployTask` | string | resource | Task run after zip deploy (JavaScript init writes the `npm install` task label). |
| `pythonVenv` | string | resource | Venv folder name used by tasks/debug/deploy. |
| `createPythonVenv` | boolean / `true` | | Create a venv during Python project creation. |
| `scmDoBuildDuringDeployment` | boolean | resource | Remote (Oryx) build during deploy; not applicable to Flex. |
| `enableOutputTimestamps` | boolean / `true` | | Read by the shared `createAzExtOutputChannel` (not this repo's `src/`). |
| `stopFuncTaskPostDebug` | boolean / `true` | | Stop the func host task when a debug session ends. |
| `showDeployConfirmation` | boolean / `true` | | Deploy overwrite confirmation (existing app, zip deploy). |
| `validateFuncCoreTools` | boolean / `true` | | Pre-debug Core Tools install check. |
| `validateDelve` | boolean / `true` | | Pre-debug Delve (`dlv`) check for Go. |
| `validateGo` | boolean / `true` | | Go toolchain check before packaging. |
| `validateEmulators` | boolean / `true` | | Pre-debug storage / DTS / Netherite / SQL connection + emulator checks. |
| `requestTimeout` | number / `15` | | Seconds for template/feed requests. |
| `hostStartTimeout` | number / `60` | | Seconds to wait for the host to start (local function listing, API). |
| `defaultFunctionAppToDeploy` | string | resource | Default deploy target (full ARM id); prompted to save after deploy. |
| `suppressProject` | boolean / `false` | resource | Hide Functions project detection for this folder. |
| `showHiddenStacks` | boolean / `false` | | Show hidden runtime stacks in create-app. |
| `showDeprecatedStacks` | boolean / `false` | | Show deprecated stacks in create-app. |
| `showReloadTemplates` | boolean / `false` | | "$(sync) Reload templates" pick in create-function. |
| `enableOpenFromPortal` | boolean / `false` | | Gates the `onUri` open-from-portal flow (experimental). |
| `javaBuildTool` | enum `maven`/`gradle` / `maven` | resource | Java build tool (Gradle is preview). |
| `templateSource` | enum `""`/`Staging`/`Backup` | | Dev-only template source override (reload required). |
| `funcCliPath` | string | resource | Path to `func` used by tasks/deploy/version checks; disables install/update/uninstall commands. |
| `endOfLifeWarning` | boolean / `true` | | EOL stack warning in create-app, deploy, app-settings commands. |
| `functionSubpath` | string / `src/functions` | resource | Node v4 new-function folder. |
| `showFlexEventGridWarning` | boolean / `true` | | Warn when deploying an Event Grid blob trigger to Flex. |
| `showMarkdownPreview` | boolean / `true` | | Show the Python v2 template markdown preview after create. |
| `allowProgrammingModelSelection` | boolean / `false` | | Show the Node/Python programming-model prompt. |
| `showBallerinaProjectCreation` | boolean / `false` | | Show Ballerina in the project-language pick. |
| `mcpProjectType` | enum `NoMcpServer`/`McpExtensionServer`/`SelfHostedMcpServer` | | MCP integration type; drives create-function MCP host config, deploy MCP notification, `getMcpHostKey`. |
| `projectTemplates.cacheExpirationHours` | number / `24` | | Template Gallery manifest cache TTL. |
| `enableTemplateGallery` | boolean / `false` | | Replace the classic create-project wizard with the Template Gallery panel. |

**Read but not contributed (B):**
- `azureFunctions.zipGlobPattern` / `azureFunctions.zipIgnorePattern` — deprecated; `deploy.ts` warns if either is set (use `.funcignore`).
- `debug.internalConsoleOptions = "neverOpen"` — *written* to `.vscode/settings.json` by init.
- Foreign sections read: `azurite.blobHost` / `blobPort` / `queueHost` / `queuePort` / `tableHost` / `tablePort` / `cert` / `key` (build the Azurite emulator connection string, http vs https), `azureResourceGroups.groupBy`.

## 3. Tree view (A branch + B behavior)

**The extension contributes one view of its own** (`azureFunctions.funcHostDebugView`, in the built-in `debug` container); everything else is grafted onto the Azure Resources host views:

| Surface | Host API | Registration | Root |
|---|---|---|---|
| Function Apps (`azureResourceGroups` / `azureFocusView`) | **v1** `registerApplicationResourceResolver(AzExtResourceType.FunctionApp, FunctionAppResolver)` | `x-azResources.azure.branches: FunctionApp` | `ResolvedFunctionAppResource` / `ResolvedContainerizedFunctionAppResource` |
| Local projects (`azureWorkspace`) | **v1** `registerWorkspaceResourceProvider('func', FunctionsLocalResourceProvider)` | `workspace.branches: func` | `LocalProjectTreeItem` / `InitLocalProjectTreeItem` / `InvalidLocalProjectTreeItem` / "Create Function Project..." hint |
| DTS schedulers (`azureResourceGroups` / `azureFocusView`) | **v2** `registerAzureResourceBranchDataProvider('DurableTaskScheduler', DurableTaskSchedulerDataBranchProvider)` | `azure.branches: DurableTaskScheduler` | `DurableTaskSchedulerResourceModel` |
| DTS emulators (`azureWorkspace`) | **v2** `registerWorkspaceResourceProvider` + `registerWorkspaceResourceBranchDataProvider('DurableTaskSchedulerEmulator', ...)` | `workspace.branches: DurableTaskSchedulerEmulator` | `DurableTaskSchedulerEmulatorsWorkspaceResourceModel` |
| Functions Host Exceptions Debugger (own view) | `vscode.window.createTreeView('azureFunctions.funcHostDebugView')` | `views.debug` (`when: !virtualWorkspace`, `visibility: collapsed`, icon `resources/azure-functions.svg`) | `HostTaskNode` / `StoppedHostNode` / `NoHostNode` |

`FunctionAppResolver.matchesResource`: `type == microsoft.web/sites` && `kind` contains `functionapp` && **not** `workflowapp` (excludes Logic Apps Standard). It bulk-lists apps per subscription through **Azure Resource Graph** (`@azure/arm-resourcegraph`, paged by skip token) into a site cache; falls back to `webApps.get` when the app is not in the cache (fresh create) or is containerized (`kind == functionapp,linux,container,azurecontainerapps`). Duplicate site names get the location appended to the description when `azureResourceGroups.groupBy == resourceType`.

### Hierarchy with exact contextValues

Project nodes use `getProjectContextValue()` (`src/tree/projectContextValues.ts`): `azFunc;{Remote|Local};{ReadOnly|ReadWrite};{Functions|Function};[{Http|Timer|Unknown};{Enabled|Disabled};]` (always a trailing `;`). Shared App Service nodes get tokens via `contextValuesToAdd` (host-composed; order/separator owned by the shared lib — the menu regexes only rely on substrings).

```
Function App (host-resolved)            contextValuesToAdd: 'azFuncProductionSlot' | 'azFuncFlex'
  (internal SlotTreeItem wrapper)       'azFuncProductionSlot;slot'    (sorted/deduped [slotCV, 'slot'])
├── Functions (RemoteFunctionsTreeItem) 'azFunc;Remote;{ReadOnly|ReadWrite};Functions;'
│   └── Function (RemoteFunctionTreeItem) 'azFunc;Remote;{ReadOnly|ReadWrite};Function;{Http|Timer|Unknown};{Enabled|Disabled};'
│   └── (invalid)                       'azFuncInvalidFunction'
├── Identity (ManagedIdentityTreeItem)  'azFuncManagedIdentity'
│   ├── System Assigned                 'systemIdentity/enabled'  -> role-assignment children
│   │   or                              'systemIdentity/disabled'
│   └── User Assigned                   'userAssignedIdentities'
│       └── <identity>                  'userAssignedIdentity'
├── Application Settings (shared)       'applicationSettings' + 'azFunc' (+ shared 'convert')
│   └── <setting> (shared)              'applicationSettingItem' + 'azFunc' (+ shared 'convertSetting')
├── Files (shared SiteFilesTreeItem)    'siteFiles' + 'azFunc'  (read-only)
│   └── folders / files (shared)        'folder' / 'file'  -> click azureFunctions.openFile (`openFilev2`)
├── Logs (shared LogFilesTreeItem)      'logFiles' + 'azFunc'   (omitted for Flex)
├── Deployments (shared)                'deploymentsConnected' | 'deploymentsUnconnected' + 'azFunc'  (omitted for Flex)
│   └── <deployment> (shared)           'deployment/<provider>' + 'azFunc'   (e.g. 'deployment/github')
└── Slots (SlotsTreeItem)               'azFuncSlots'           (omitted for slots and Flex)
    ├── <slot> (SlotTreeItem)           'azFuncSlot;slot'       -> same children as the app (minus Slots)
    └── (invalid)                       'azFuncInvalidSlot'
(invalid app)                           'azFuncInvalidFunctionApp'

Containerized Function App (Azure Container Apps-hosted)   contextValuesToAdd: 'azFuncProductionSlot', 'container'
  (internal ContainerTreeItem)          'azFuncContainer'
├── Functions (ContainerFunctionsTreeItem)  'azFunc;Remote;ReadOnly;Functions;'
│   └── Function (ContainerFunctionTreeItem) 'azFunc;Remote;ReadOnly;Function;{Http|Timer|Unknown};{Enabled|Disabled};container'
├── Application Settings (shared)       'applicationSettings' + 'azFunc' + 'container'
└── Image (imageTreeItem)               'imageTreeItem'
    ├── registry (generic)              — 
    └── name (generic)                  —

Azure Workspace — local projects
├── Local Project (LocalProjectTreeItem)   'azFuncLocalProject' | 'azFuncLocalProject;convert' (local settings contain a connection-string-like value)
│   ├── Functions (LocalFunctionsTreeItem) 'azFunc;Local;{ReadWrite|ReadOnly};Functions;'   (ReadOnly for compiled languages)
│   │   ├── Function (LocalFunctionTreeItem) 'azFunc;Local;{ReadWrite|ReadOnly};Function;{Http|Timer|Unknown};{Enabled|Disabled};'
│   │   ├── (invalid)                    'azFuncInvalidLocalFunction'
│   │   ├── "Run build task to update this list..."    'runBuildTask'   -> workbench.action.tasks.build   (precompiled projects)
│   │   └── "Start debugging to update this list..."   'startDebugging' -> workbench.action.debug.start  (host-listed projects, host not running)
│   └── Local Settings (shared)          'applicationSettings' + 'localSettings' (+ 'convert')
│       └── <setting>                    'applicationSettingItem' + 'localSettings' (+ 'convertSetting')
├── Local Project (InitLocalProjectTreeItem)  'initAzFuncLocalProject'
│   └── "Initialize project for use with VS Code..."   'initProject' -> azureFunctions.initProjectForVSCode(projectPath)
├── Local Project (InvalidLocalProjectTreeItem) 'invalidAzFuncLocalProject'  (children throw the stored error)
└── "Create Function Project..." (no project in workspace)   'createNewProject' -> azureFunctions.createNewProject

Durable Task Scheduler (Azure branch)
└── <scheduler> (DurableTaskSchedulerResourceModel)   'azFunc.dts.scheduler;azFunc.dts.schedulerEndpoint'
    └── <task hub> (DurableTaskHubResourceModel)      'azFunc.dts.taskHub;azFunc.dts.taskHubDashboard'

Durable Task Scheduler Emulators (workspace branch)   'azFunc.dts.emulators'
├── <emulator container>                         'azFunc.dts.emulatorInstance;azFunc.dts.schedulerEndpoint'
│   └── <task hub>                               'azFunc.dts.emulatorTaskHub;azFunc.dts.taskHubDashboard'
└── (Docker error)                               'azFunc.dts.emulatorError'

Functions Host Exceptions Debugger (azureFunctions.funcHostDebugView)
├── <running host> (HostTaskNode)          'azFunc.funcHostDebug.hostTask'
│   └── <error> (HostErrorNode)            'azFunc.funcHostDebug.hostError'
├── <stopped host> (StoppedHostNode)       'azFunc.funcHostDebug.stoppedHostTask'
│   └── <error> (HostErrorNode)            'azFunc.funcHostDebug.hostError'
└── (NoHostNode)                           (no contextValue)
```

### Per-node details

| Node | Label | Description | Icon | Click command | Children source / behavior |
|---|---|---|---|---|---|
| Function App | site name | non-`Running` state; else "Flex Consumption" for Flex; `(location)` appended for duplicate names | `azFuncProductionSlot.svg` (by CV) | — | ARG/`webApps.get` model; `initSite` lazily fetches the full site (`getData.initSite` / `functionApp.initSiteFailed`). Children listed above. Read-only when `WEBSITE_RUN_FROM_PACKAGE` / `WEBSITE_RUN_FROM_ZIP` is set (or settings unreadable). |
| Slots | "Slots" | — | `azFuncSlots.svg` | — | `webApps.listSlots` (drained). Create child = `createSlot`. |
| Slot | slot name | state | `azFuncSlot.svg` | — | same as app. |
| Functions (remote) | "Functions" | "Read-only" when read-only | `ThemeIcon('list-unordered')` | — | `webApps.listFunctions` (or slot variant); **3 retries, 10 s minimum** while the host warms up; a lone `WarmUp` function is dropped. |
| Function (remote) | function name | "HTTP" / "Timer" + "Disabled", joined with ` - ` | `azFuncFunction.svg` | `azureResourceGroups.viewProperties` | Trigger from `config.bindings`; disabled from `AzureWebJobs.<name>.Disabled` / `config.disabled`. Invoke URL / keys from host admin APIs. |
| Identity | "Identity" | — | key icon | — | `site.identity`. |
| System Assigned | "System Assigned" | "Enabled" / "Disabled" | — | — | enabled: role assignments for the principal (shared `@microsoft/vscode-azext-azureutils` role nodes); disabled tooltip "System assigned identity is disabled. Right-click to enable." |
| User Assigned / identity | "User Assigned" / identity name | — | — | — | `site.identity.userAssignedIdentities`. |
| App settings / setting (shared) | "Application Settings" / `<key>=Hidden value. Click to view.` | slot-setting marker | shared | setting: `azureFunctions.toggleAppSettingVisibility` | shared `@microsoft/vscode-azext-azureappsettings`; values masked until toggled. |
| Files / Logs / Deployments (shared) | shared labels | shared | shared | file: `azureFunctions.openFile`; deployment: shared | shared `@microsoft/vscode-azext-azureappservice` (Kudu VFS + deployments API). |
| Container (internal) | app name | — | — | — | ⚠️ `ContainerTreeItem.initSite` calls itself (infinite recursion, `src/tree/containerizedFunctionApp/ContainerTreeItem.ts:29-30`). |
| Functions / Function (container) | "Functions" / name | "Read-only" / trigger | as remote | `azureFunctions.viewProperties` | `webApps.listFunctions`, same retry/WarmUp rules. |
| Image | "Image" | — | — | — | `siteConfig.linuxFxVersion` split into registry + name generic children. |
| Local Project | "Local Project" | project subpath (relative) | `CreateNewProject` themed | — | Functions + Local Settings. File watchers on `*/function.json` and `local.settings.json` (`refreshFileWatcher`); func-task start/stop refreshes the node (`onFuncTaskChanged`). |
| Functions (local) | "Functions" | "Read-only" (compiled) | list icon | — | Script / classic models: parse `function.json` files (compiled in-process .NET/Java: from the build output, plus a "Run build task to update this list..." hint). .NET isolated, native workers (custom handler / Go) and the Node v4 / Python v2 models have no `function.json`: query the **running local host** `/admin/functions` (retries `ECONNREFUSED` up to `hostStartTimeout`); if the host is not running, shows the "Start debugging to update this list..." hint. |
| Function (local) | name | trigger / disabled | `azFuncFunction.svg` | `azureFunctions.viewProperties` (only when a `function.json` exists) | — |
| Init project / child | "Local Project" / "Initialize project for use with VS Code..." | subpath | warning / `CreateNewProject` | child -> `azureFunctions.initProjectForVSCode` | — |
| Create hint | "Create Function Project..." | — | `CreateNewProject` themed | `azureFunctions.createNewProject` | shown when `listLocalProjects` finds nothing. |
| DTS scheduler | scheduler name | — | scheduler icon | — | DTS ARM REST `taskHubs` list (api-version `2025-11-01`). |
| DTS task hub | hub name | — | — | — | dashboard URL from scheduler endpoint. |
| DTS emulators | "Durable Task Scheduler Emulators" | — | scheduler icon | — | `docker ps` via `@microsoft/vscode-container-client` filtered on the emulator image; refreshes on emulator-client change events. |
| DTS emulator / hub | container name / hub name | — | — | — | emulator scheduler endpoint `http://localhost:<8080-mapped>`, dashboard `http://localhost:<8082-mapped>`; hubs from emulator metadata (`default`). |
| Host task (running) | `{workspace} ({port})` | start time | `server-process` | — | **Expanded**; error lines captured from the func host terminal output (newest first). Tooltip: scope, port, start time, cwd, PID. |
| Host task (stopped) | `{workspace} ({port}) — Stopped` | `{start} → {stop}` | `debug-stop` (disabled color) | — | expanded only when errors exist; retained until "Clear Stopped Sessions". |
| Host error | first line or "Error detected" | — | `error` | — | leaf; tooltip = full raw message. |
| No host | "No Function Host task is currently running." | "Start debugging (F5) to launch the host." | `debug` | — | shown when no host task is running. |

**Orphan icon:** `resources/azFuncProxy.svg` (Functions Proxies were removed; nothing references it) — do not migrate.

### Refresh / state

- No timer-based polling of Azure. Local tree refreshes on file-watcher events (`function.json`, `local.settings.json`), func-task start/end, workspace-folder changes and `azureFunctions.*` configuration changes (`AzureAccountTreeItemWithProjects.onDidChangeWorkspaceFolders` / `.onDidChangeConfiguration`).
- Remote function list retries while the host is warming up (3 x, 10 s); `enable/disableFunction`, deploy, and app-setting writes call `refresh` on the app.
- DTS emulator branch refreshes on the emulator client's change event (start/stop). Scheduler/task-hub create/delete refresh the parent.
- Host debug view: `onDidChangeTreeData` on task start/stop and each captured error; **auto-focuses the view on the first host error** of a session; `funcHostDebug.refresh` and `clearStoppedSessions` title actions.
- Pagination: `RemoteFunctionsTreeItem` and `SlotsTreeItem` expose `_nextLink` (`hasMoreChildrenImpl`) but drain everything with `uiUtils.listAllIterator` in practice.

### Menus (A)

- **`view/title`** (3): submenu `azureFunctions.submenus.workspaceActions` when `view == azureWorkspace` @ `navigation@1`; `funcHostDebug.refresh` @ `navigation@1` and `funcHostDebug.clearStoppedSessions` @ `navigation@2` when `view == azureFunctions.funcHostDebugView`.
- **`submenus`** (1): `azureFunctions.submenus.workspaceActions`, label "Azure Functions", icon `resources/azure-functions.svg`; members `createFunction` (`1_projects@1`), `createNewProject` (`1_projects@2`), `createNewProjectWithDockerfile` (`1_projects@3`), `deployProject` (`2_deploy@1`).
- **`view/item/context`** (77): the extension-owned entries are listed per command in Section 1. **Host command reuse** — `azureResourceGroups.refresh` is contributed on: `/azFunc(Production|)(Slot|Flex)(?!s).*slot/` @ `6@2`, `viewItem == azFuncSlots` @ `6@1`, `/azFunc.*Functions;/i` @ `1@1`, `/applicationSettings.*azFunc/` @ `2@1`, `/azFunc.*(deployments(C|Unc)onnected)/` @ `2@1`, `/azFunc.*siteFiles/`, `/azFunc.*logFiles/`, `/azFunc.*folder/` (each @ `1@1`), all under `view~RG`.
- **`explorer/context`** (4): `addBinding` (`resourceFilename==function.json`, `zzz_binding@1`), `appSettings.decrypt` / `appSettings.encrypt` (`resourceFilename==local.settings.json`, `zzz_appSettings@1/@2`), `deploy` (`explorerResourceIsFolder == true`, `zzz_azuretools_deploy@2`).
- **`editor/context`** (1): `addBinding` (`resourceFilename==function.json`). **`editor/title`** (1): `eventGrid.sendMockRequest` (`resourceFilename=~/.*.eventgrid.json$/`, `navigation@1`).
- **`commandPalette`** (22): `when: never` — `deployByFunctionAppId`, `openInPortal`, `pickProcess`, `toggleAppSettingVisibility`, `viewProperties`, `unassignManagedIdentity`, `getMcpHostKey`, `durableTaskScheduler.{copyEmulatorConnectionString, copySchedulerConnectionString, copySchedulerEndpoint, createTaskHub, deleteScheduler, deleteTaskHub, openTaskHubDashboard, stopEmulator}`, `funcHostDebug.{refresh, showRecentLogs, copyRecentLogs, askCopilot}`; setting-gated — `startRemoteDebug` (`config.azureFunctions.enableRemoteDebugging == true`), `startJavaRemoteDebug` (`config.azureFunctions.enableJavaRemoteDebugging == true`); unconditional — `durableTaskScheduler.createScheduler` (empty `when`, a no-op entry).

**`when`-clause quirks to not port verbatim:**
- **No `\b` anywhere**; several regexes are case-insensitive substring matches. `/azFuncLocalProject/i` also matches `initAzFuncLocalProject` and `invalidAzFuncLocalProject` (case-insensitive), so **Create Function / Deploy Project show on uninitialized and invalid project nodes**.
- `/userAssignedIdentity/` (unassign) also matches the parent `userAssignedIdentities` node.
- `/azFunc.dts.scheduler/` (unescaped `.`) also matches `azFunc.dts.schedulerEndpoint`, which the **emulator** node carries — but those entries are gated to `view~RG`, so the collision is latent.
- `/azFunc.*folder/` targets shared-lib folder nodes under Files/Logs; no extension-owned node has `folder`.
- `viewProperties` / `refresh` on the app use `/azFunc(Production|)(Slot|Flex)(?!s).*slot/` (case-sensitive lowercase `slot` token), relying on the internal `SlotTreeItem` CV (`...;slot`) — confirm on the host-composed CV when porting.

### Pick steps (the command -> node contract, B)

Commands invoked without a node use the **legacy** v1 picker: `ext.rgApi.pickAppResource(context, { filter, expectedChildContextValue })` (remote) or `ext.rgApi.workspaceResourceTree` / `AzureAccountTreeItemWithProjects.pickTreeItemImpl` (local; sets `childTypeLabel` to "project", "subscription" or "project or subscription" based on whether the expected CVs are `Local`/`Remote`), and `ResolvedFunctionAppResource.pickTreeItemImpl` routes into Slots / App Settings / Deployments / Functions by matching the expected CV. Filters: `functionFilter = { type: AzExtResourceType.FunctionApp }`.

| Command family | Expected CV |
|---|---|
| deploy / start / stop / restart / delete / browse / logs / properties | `ResolvedFunctionAppResource.productionContextValue` / `flexContextValue` (`/azFunc(ProductionSlot|Flex)/` etc.) |
| slot commands | `ResolvedFunctionAppResource.pickSlotContextValue` = `/azFuncSlot(?!s)/` |
| function commands | `new RegExp('Function;')` variants; enable/disable: `/Function;.*;{Enabled|Disabled};/`; delete: `Remote;ReadWrite;Function;`; add binding: `Local;ReadWrite;Function;` |
| app settings | shared `AppSettingsTreeItem.contextValue` / `AppSettingTreeItem.contextValue` |
| deployments | shared `DeploymentsTreeItem.contextValueConnected` / `DeploymentTreeItem.contextValue` |
| identity | `UserAssignedIdentitiesTreeItem.contextValue`, `SystemIdentityTreeItem` disabled CV |
| DTS | v2 host `azureResourceTreeDataProvider` + `ContextValueQuickPickStep`s on `azFunc.dts.scheduler` / `azFunc.dts.taskHub`; emulator commands require a node |

---

## 4. Debugging + tasks (A + B)

**0 contributed debuggers.** Debugging piggybacks on each language extension's debug type; this extension supplies configuration providers, a task provider, pre-launch validation, and process picking.

**Task definition (A):** `type: func`, `required: [command]`, properties `command: string`, `args: string[]`.

**Task provider (B, `FuncTaskProvider`, `provideTasks` / `resolveTask`, both success-suppressed):** for each workspace folder with a detected project root, provides:
- `func: extensions install` (always).
- `func: host start` — unless the folder's `tasks.json` already defines one (then `resolveTask` handles the user's customised copy). Background task with problem matcher `$func-<lang>-watch`; `dependsOn` build/pip/npm tasks come from init-written `tasks.json`.
- Python: `func: pack` and `func: pack --build-native-deps`. Go: `func: pack`.
- `createTask` injects `env.AzureWebJobsStorage` when `local.settings.json` points at the storage emulator, and resolves the `func` path from `funcCliPath`.

**Problem matchers (A):** `func-watch` (label "Azure Functions problems (watch mode)", owner "Azure Functions", source `func`, `applyTo: allDocuments`, `fileLocation: [relative, ${workspaceFolder}]`, `pattern: $func`, `severity: error`, `background.activeOnStart: true`, begins `^.*(Job host stopped|signaling restart).*$`, ends `^.*(Worker process started and initialized|Host lock lease acquired by instance ID).*$`), plus `func-dotnet-watch`, `func-java-watch`, `func-node-watch`, `func-python-watch`, `func-golang-watch` (all `base: $func-watch`) and `func-powershell-watch` (ends only on `Host lock lease acquired by instance ID`). **problemPattern (A):** `func`.

**Debug configuration providers (B)** — `vscode.debug.registerDebugConfigurationProvider` for 7 types, each a `FuncDebugProviderBase` subclass providing an "Attach to <Language> Functions" config: `NodeDebugProvider` (`node`, port 9229), `PythonDebugProvider` (`python` and `debugpy`, port 9091; injects the Python extension's `getRemoteLauncherCommand` into the host env), `JavaDebugProvider` (`java`, 5005), `BallerinaDebugProvider` (`ballerina`, 5005), `PowershellDebugProvider` (`PowerShell`, custom pipe `AzureFunctionsPSWorker`), `GoDebugProvider` (`go`, Delve on 2345: waits for the Go worker process `app` under the host, kills stale `dlv`, polls and attaches — `azureFunctions.go.attachDlv`). The worker debug arguments are injected into the host task env via `workerArgKey` (`languageWorkers__node__arguments`, `languageWorkers__java__arguments`, `languageWorkers__python__arguments`) unless already set. **.NET has no provider**: init writes a `coreclr` `attach` config with `processId: ${command:azureFunctions.pickProcess}`.
- `provideDebugConfigurations` returns the attach config with `preLaunchTask: func: host start`.
- `resolveDebugConfiguration` runs **pre-debug validation** only when `preLaunchTask` is the func host task (and then lifts success suppression — the event is an honest F5 signal): Core Tools installed (`validateFuncCoreTools`) -> project root found -> language / model detectable -> durable storage backend detection -> Python v2 model requires Core Tools >= `4.0.4742` -> `FUNCTIONS_WORKER_RUNTIME` present in `local.settings.json` -> when `validateEmulators`: DTS connection (offers to start the DTS emulator), Netherite / SQL connection presence, `AzureWebJobsStorage` present and, if `UseDevelopmentStorage=true`, Azurite reachable (buttons **Run Emulator** -> `azurite.start_blob` / `start_table` / `start_queue`, **Install Azurite**, **Debug anyway**).
- `pickProcess` / `startFuncProcess`: stops a previous host (30 s), starts/reuses the host task (`IfNotActive`), polls the local host `/admin/host/status` with a doubling request timeout until `pickProcessTimeout` expires ("You may want to adjust the ... setting"), then returns the worker child PID (Windows `@vscode/windows-process-tree`; Unix `ps-tree`).
- `stopFuncTaskPostDebug`: `onDidTerminateDebugSession` terminates the host task. `registerGoDebugSessionCleanup` kills `dlv` on session end.
- **Go:** `validateDelve` checks `dlv version` and opens the Delve install docs; `validateGo` checks the toolchain before packaging.

**Func host task tracking (B, `funcCoreTools/funcHostTask.ts`):** tracks running `func host start` tasks per workspace folder (port from `-p`/`--port` in the command line, else `local.settings.json` `Host.LocalHttpPort`, else `7071`; on Windows also confirms via `netstat` LISTENING lines), reads the terminal output stream for errors (feeds the Host Debug view and `copyRecentLogs` / `askCopilot`), and emits start/stop events that refresh the local tree and let `executeFunction` / local function listing target the right port.

**Core Tools lifecycle (B):** detection by `func --version` (or `funcCliPath`). Package managers: **Homebrew** (macOS only; `brew tap azure/functions` behind a trust prompt, formula `azure-functions-core-tools@<major>`) and **npm** (`azure-functions-core-tools@<major>`, version from the npm registry `dist-tags` via `aka.ms/AA2qmnu`). No other package manager is automated — when none is available the install prompt links to per-OS docs (`aka.ms/AAb9zn8` / `AAb9zn6` / `Dqur4e`). Install and update run `validateFuncCoreToolsCodeSignature` (Windows and macOS signature checks, v4+). Activation checks for outdated (`showCoreToolsWarning`, "Learn more" -> `aka.ms/azFuncOutdated`) and multiple installs (`showMultiCoreToolsWarning`, "Select version to uninstall"). `funcCliPath` disables install/update/uninstall.

## 5. Wizards (B)

~22 `AzureWizard` flows plus 4 reusable connection-setting sub-wizard families. All use `@microsoft/vscode-azext-utils` `AzureWizard` with Prompt/Execute steps; most Azure-writing flows run with an activity context (`createActivityContext()`) so they show in the host Activity Log.

### 5.1 Cross-cutting step conventions

- Execute-step priorities are explicit and used to interleave shared-lib steps (RG/Storage/Plan/AppInsights come from `@microsoft/vscode-azext-azureutils` / `-azureappservice`; their priorities are owned by those libraries).
- Language detection (`verifyInitForVSCode`, `getProjectLanguage`, `getProjectLanguageModel`) runs before most local and deploy flows and can trigger init.
- EOL stack warnings (`showEolWarningIfNecessary`, setting `endOfLifeWarning`) run before create-app, deploy, and app-settings commands.
- Durable backend detection (`getStorageTypeFromWorkspace`: Azure Storage / Netherite / DTS / SQL from `host.json` + project deps) feeds create-function, create-app plan filtering, debug validation and deploy connection prompts.

### 5.2 `createNewProject` — `azureFunctions.createNewProject` (+ `createNewProjectWithDockerfile`)

Flow selection: `enableTemplateGallery == true` opens the Template Gallery (5.3); explicit `startFromScratch` / `templateId` / Dockerfile creation always uses the classic wizard.

**Prompt order:** `FolderListStep` (browse; validates; multi-root aware) -> `NewProjectLanguageStep` -> language-specific prompts -> `FunctionListStep` (first function; "`$(clock) Skip for now`") -> `OpenBehaviorStep` (skipped by `projectOpenBehavior` / `suppressOpenFolder`).

**Language picks:** JavaScript, TypeScript, C#, Python, Go (preview), Java, PowerShell, Custom Handler, **Self-hosted MCP server**, Ballerina (only with `showBallerinaProjectCreation`), "`$(library) Browse Template Gallery (Preview)...`" (non-container only). `C#Script` / `F#` / `F#Script` are only reachable via settings/API.

| Language | Extra prompts | Create step / tooling | Notes |
|---|---|---|---|
| JavaScript / TypeScript | programming model **Model V4** (default) / **Model V3** — prompt hidden unless `allowProgrammingModelSelection` | `JavaScriptProjectCreateStep` / `TypeScriptProjectCreateStep` (package.json, tsconfig, `main` glob from `functionSubpath`); `npm install` (warns on failure) | Node v4 functions live in `functionSubpath`. |
| Python | **Model V2** (default) / **Model V1** (same gate); interpreter pick (`PythonAliasListStep`, "Enter the Python interpreter or full path"), version validation | `PythonProjectCreateStep`; `PythonVenvCreateStep` (priority 12, `python -m venv`, when `createPythonVenv`) | `requirements.txt`, `.funcignore`; v2 uses `function_app.py` schema templates. |
| C# (.NET) | `DotnetRuntimeStep` — runtime `~1..~4` x in-process / **isolated** x target framework (from installed SDK/templates; "Unrecognized target frameworks") | `DotnetProjectCreateStep` via `dotnet new` with the Functions template pack (downloaded / backup) | `deploySubpath` + `preDeployTask` (`publish`) written by init. |
| Java | Java version -> group ID -> artifact ID -> version -> package -> app name -> build tool (**Maven** / **Gradle** preview) | Maven archetype (`mvn archetype:generate`) or Gradle scaffolding; validates `mvn`/`gradle` | No first-function step for Java. |
| PowerShell | — | script project (`profile.ps1`, `requirements.psd1`) | — |
| Custom Handler | — | `CustomProjectCreateStep` | — |
| Go (preview) | — | `GoProjectCreateStep` (validates Go; `go.mod` etc.; first function scaffolded) | `createFunction` is **unsupported** for Go ("Adding new functions is currently not supported for Go projects"). |
| Ballerina (hidden) | backend `jvm` / `native` | `bal` CLI init; `Ballerina.toml` | — |
| Self-hosted MCP server | MCP language pick -> "download snippets?" | `MCPDownloadSnippetsExecuteStep` (12), MCP project create, `MCPOpenFileStep` (240) | Writes `mcpProjectType: SelfHostedMcpServer`; creates/updates `.vscode/mcp.json`. |

**Execute priorities:** `ProjectCreateStep*` 10, `PythonVenvCreateStep` 12, MCP snippet download 12, `InitVSCodeStep*` 20, first-function create (220, see 5.4), `MCPOpenFileStep` 240, `OpenFolderStep` 250, `CreateDockerfileProjectStep` 100 (Dockerfile variant: `func init --docker-only`, run after .NET `dotnet new` to avoid Core Tools' own `dotnet new`). `azureFunctions.createNewProjectStarted` fires once execute begins. Version default: explicit -> `projectRuntime` -> local Core Tools major -> `~4` (`~1` hidden off Windows; v2/v3 EOL warning).

Post-create work that needs a reload/open-folder is cached in global state and finished by `runPostFunctionCreateStepsFromCache()` on next activation.

### 5.3 Template Gallery (webview panel, preview) — `FunctionsTemplateGalleryController`

- `@microsoft/vscode-azext-webview` panel; RPC callbacks `azureFunctions.templateGallery.getTemplates` / `.getReadme` / `.createProject` / `.continueInChat`.
- Manifest `https://cdn.functions.azure.com/public/templates-manifest/manifest.json`, cached in global state for `projectTemplates.cacheExpirationHours`. Readmes fetched from `raw.githubusercontent.com` (repo URL rewritten).
- Filters by language / metadata; target-folder validation with non-empty-folder confirmation; downloads the template repo with **git** if available, else **zip** (`yauzl`); then the classic open-behavior prompt.
- "Continue in chat" -> `workbench.action.chat.open` with a prefilled prompt.
- Telemetry props: `templateId`, `templateName`, `language`, `entryPoint`, `downloadMethod`, `result`, `nonEmptyTarget`.

### 5.4 `createFunction` / `addBinding` / `initProjectForVSCode`

**`createFunction`** (`azureFunctions.createFunction`, API `createFunction`): locate project (`tryGetFunctionProjectRoot` — `silent` / `prompt` / `modalPrompt`, multi-project pick; no project -> offers Create New Project, `noWorkspaceResult`) -> detect language/model/version/template schema -> durable backend detection -> `FunctionListStep`:
- Groups by each template's `templateFilter` category; order: plain HTTP trigger, other HTTP variants, Timer, then alphabetical. Placeholder "Select a template for your function" (+ `(Template source: "{0}")`).
- Extra picks: "HTTP trigger(s) from OpenAPI V2/V3 Specification (Preview)" (`autorest` + OpenAPI plugin, supported languages only), "`$(sync) Reload templates`" (`showReloadTemplates`).
- Durable templates that need storage are filtered or trigger `DurableStorageTypePromptStep` (Azure Storage / Netherite / DTS / SQL) + `DurableProjectConfigureStep` (225: `host.json` `extensions.durableTask.storageProvider`, package deps).
- Per-template setting prompts (schema v1 `function.json` settings or v2 action-schema prompts: string / boolean / enum / existing file / new file / quick pick). Resource-backed settings use `LocalAppSettingListStep` ("Select the app setting with your {1} string from "{0}"", "`$(plus) Create new local app setting`") and connection sub-wizards (5.10): Storage, Cosmos DB, Event Hubs, Service Bus, SQL, DTS.
- Execute: `FunctionCreateStep` 220 (language-specific: script template copy, Node v4 file under `<functionSubpath>/<name>`, Python v2 action execution incl. `AppendToFile` / `ReplaceTokensInText` / `WriteToFile` / `GetTemplateFileContent` / `ShowMarkdownPreview` (`showMarkdownPreview`), `dotnet new <template>`, Java/Ballerina generators), `JobNameStep` 500 (v2 schema). Post-create (`postFunctionCreate`, success-suppressed): open created file (MCP: side-by-side with `.vscode/mcp.json`), `verifyExtensionBundle` / `extensions.csproj` install, dynamic-concurrency host config, MCP host config (`mcpProjectType`), durable deps.

**`addBinding`** (`function.json` projects only; else "Add binding is not supported for this project type."): `BindingDirectionStep` (in/out) -> `BindingListStep` -> binding setting prompts (same prompt types as above) -> connection sub-wizards. Execute: `EventHubCreateStep` 191, `AzureConnectionCreateStep` 200, `LocalAppSettingCreateStep` 210, `BindingCreateStep` 220 (writes `function.json`).

**`initProjectForVSCode`**: detect language (prompt if unknown) -> language prompts (Python venv, Java build tool) -> `InitVSCodeStep` per language (priority 20): merges `.vscode/tasks.json` (overwrite confirmation "This will overwrite the following tasks in your tasks.json", version check "The version in your {0} must be "{1}""), `launch.json` (attach configs from Section 4; .NET `coreclr` + `pickProcess`), `settings.json` (`azureFunctions.projectLanguage`, `projectRuntime`, `projectLanguageModel`, `deploySubpath`, `preDeployTask`, `postDeployTask`, `projectSubpath`, `pythonVenv`, `scmDoBuildDuringDeployment`, `mcpProjectType`, `debug.internalConsoleOptions: neverOpen`), `extensions.json` (recommends `ms-azuretools.vscode-azurefunctions` + language extension); removes a bare `.vscode` line from `.gitignore`. .NET checks: 64-bit Core Tools for .NET Framework, target-framework mismatch, `extensions.csproj` vs bundle.

**Activation verify (`verifyVSCodeConfigOnActivate`)**: per workspace folder, detects uninitialized / outdated config and prompts to initialize or fix (`showProjectWarning`, `showPythonVenvWarning`, `showTargetFrameworkWarning`, `showExtensionsCsprojWarning`); also migrates legacy settings.

### 5.5 `createFunctionApp` (basic) / `createFunctionAppAdvanced` / Flex / containerized

Entry: palette, `Create Resource` host entry (type `FunctionApp`), RG `azureResourceTypeGroup` node for function apps, deploy's "`$(plus) Create new function app`", agent (`createFunctionAppViaAgent`), and `getOrCreateFunctionApp` (deploy). Title / activity "Create Function App "{0}"".

**Prompt order — basic:** `LocationListStep` (Flex regions only when Flex: `GET .../providers/Microsoft.Web/geoRegions?api-version=2023-01-01&sku=FlexConsumption`; provider filter `Microsoft.Storage`) -> `SiteDomainNameLabelScopeStep` (auto **Tenant** scope in basic) -> `SiteNameStep('functionApp')` (global name check) -> `FunctionAppHostingPlanStep` (basic: **Flex Consumption preselected** unless a Dockerfile is detected) -> `FunctionAppStackStep` (stack filtered by project language; Go -> custom handler stack) -> `AuthenticationPromptStep` (Secrets / Managed identity) -> `ConfigureCommonNamesStep`.

**Advanced adds:** `CustomLocationListStep` (Azure Arc / Kubernetes), `ResourceGroupListStep`, domain-name-label scope prompt, hosting plan pick, `AppServicePlanListStep` (existing plans filtered by SKU family), `StorageAccountListStep` (excludes `BlobStorage` kind and Premium performance — needs blobs, queues, tables), `AppInsightsListStep`, Flex `MaximumInstanceCountPromptStep` / `InstanceMemoryMBPromptStep`.

**Hosting plans:** Flex Consumption (Linux, `FC1` / tier `FlexConsumption`), Consumption (description "Legacy"; `Y1` / `Dynamic`), Premium (`/^EP$/i`), App Service Plan (`/^((?!EP|Y|FC).)*$/i`). Basic = Flex only; DTS projects in advanced = Flex + Premium; otherwise all four.

**Stacks:** `GET providers/Microsoft.Web/functionAppStacks?api-version=2020-10-01` / `locations/{loc}/functionAppStacks?api-version=2023-12-01` (Flex), backup copy in `backupStacks.ts`; `showHiddenStacks`, `showDeprecatedStacks`, EOL warning step; v1 forces Windows. Default version: `projectRuntime` -> local Core Tools -> `~4` (telemetry `runtimeSource`).

**Execute (in order):** `ResourceGroupCreateStep` -> `StorageAccountCreateStep` (`StorageV2` / `Standard` / `LRS`) -> `AppInsightsCreateStep` -> `LogAnalyticsCreateStep` + `AppServicePlanCreateStep` (both skipped for containerized; plan names `FLEX-{site}-{4hex}` / `ASP-{site}-{4hex}`) -> user-assigned identity create (MI auth) -> `RoleAssignmentExecuteStep` (**Storage Blob Data Contributor** on the storage account) -> `FunctionAppCreateStep` (1000). Containerized: `DeployWorkspaceProjectStep` (137, calls the **Container Apps extension API** `deployWorkspaceProject` with `suppressContainerAppCreation` to build/push the image and managed environment) -> `ContainerizedFunctionAppCreateStep` (140; site hosted on Azure Container Apps, `kind: functionapp,linux,container,azurecontainerapps`).

**Site written by `FunctionAppCreateStep`:** `Microsoft.Web/sites`, kind `functionapp[,linux][,kubernetes]`, `clientAffinityEnabled: false`, optional user-assigned identity. App settings: `AzureWebJobsStorage` (connection string) **or** identity-based `AzureWebJobsStorage__*` settings; `FUNCTIONS_EXTENSION_VERSION = ~<major>`; stack runtime settings (e.g. `FUNCTIONS_WORKER_RUNTIME`); `AzureWebJobsDashboard` (v1 only); `WEBSITE_CONTENTAZUREFILECONNECTIONSTRING` + `WEBSITE_CONTENTSHARE` (`<site>-<6hex>`, Consumption and Elastic Premium); `DEPLOYMENT_STORAGE_CONNECTION_STRING` (Flex without MI); `WEBSITE_RUN_FROM_PACKAGE = 1` (Windows, not v1 C# script); `APPLICATIONINSIGHTS_CONNECTION_STRING`; `APPLICATIONINSIGHTS_ENABLE_AGENT = true` (EP Java). Flex `functionAppConfig`: `deployment.storage` `{ type: blobContainer, value: <blobEndpoint>app-package-<name32>-<7hex>, authentication: UserAssigned(identity id) | StorageAccountConnectionString(DEPLOYMENT_STORAGE_CONNECTION_STRING) }`, `runtime {name, version}`, `scaleAndConcurrency {maximumInstanceCount, instanceMemoryMB, alwaysReady: []}`; then creates the deployment blob container if absent (`@azure/storage-blob`). Windows: enables file application logging.

**Provisioning topology (source facts):**

| Flow | Primary resource | Supporting resources | Order |
|---|---|---|---|
| Basic (Flex) | `Microsoft.Web/sites` (+ `functionAppConfig`) | new RG, `Microsoft.Storage/storageAccounts`, `Microsoft.Insights/components`, `Microsoft.OperationalInsights/workspaces`, `Microsoft.Web/serverfarms` (FC1), optional `Microsoft.ManagedIdentity/userAssignedIdentities`, role assignment (Storage Blob Data Contributor), deployment blob container | RG -> storage / monitoring / plan / identity -> role -> site -> container |
| Advanced | `Microsoft.Web/sites` | new-or-existing RG, storage, plan (Y1 / EP / ASP / FC1), App Insights; optional custom location | as above; existing resources are referenced |
| Containerized | `Microsoft.Web/sites` on Container Apps | image + ACA managed environment via Container Apps extension, RG, storage, App Insights | image deploy -> site |
| Slot | `Microsoft.Web/sites/slots` | parent app | shared `createSlot` |
| DTS scheduler / task hub | `Microsoft.DurableTask/schedulers` / `.../taskHubs` | RG, provider registration check | provider -> RG -> scheduler -> hub |
| Netherite connection | `Microsoft.EventHub/namespaces` / `eventhubs` / `authorizationRules` | RG | namespace -> hub -> rule -> setting |
| SQL connection | `Microsoft.Sql/servers` / `databases` | RG | server -> db -> setting |
| Identity assign / enable | `Microsoft.Web/sites` update | existing UAMI | — |

### 5.6 Delete / slots / deployment source

- `deleteFunctionApp` / `deleteSlot`: shared `AppServiceTreeItem` delete (`DeleteConfirmationStep`; offers to delete the last plan). Containerized apps: `DeleteContainerizedFunctionAppStep` (100, `webApps.delete`, site only).
- `createSlot`: `SlotsTreeItem.createChildImpl` -> shared slot name + config-source prompts.
- `swapSlot`: shared `appservice.swapSlot` (source slot -> target pick incl. production).
- `configureDeploymentSource`: shared `editScmType` (None / LocalGit / GitHub ...; telemetry `updatedScmType`). `connectToGitHub`: shared GitHub connect on the Deployments node. `disconnectRepo`, `viewDeploymentLogs`, `redeploy`, `viewCommitInGitHub`: shared deployment-node actions.

### 5.7 Deploy — `deploy` / `deployProject` / `deploySlot` / `deployByFunctionAppId`

1. Resolve deploy folder (`getDeployFsPath`: explorer folder, workspace pick; `deploySubpath` applied; "deploy folder not open — open in new window?" shared prompt `deployWarning.openInNewWindow`) and project root (error if no `host.json`).
2. Pick target: tree node, `defaultFunctionAppToDeploy`, `functionAppId` arg, or `SubscriptionListStep` + `FunctionAppListStep` (with "Create new function app" -> 5.5; progress "Loading deployment configurations..."). Slot deploy uses `/azFuncSlot(?!s)/`. Offers to save `defaultFunctionAppToDeploy` afterwards.
3. Guards: stopped app -> error; **containerized apps -> not supported** (warning + learn-more); Python on Windows -> error; Go requires Linux (Flex) and `validateGo`.
4. Deploy method: zip deploy unless scm type set (Linux Consumption forces zip with a warning); Linux Consumption without remote build -> `storage` (run-from-package blob); Flex -> `flexconsumption` (one-deploy). `scmDoBuildDuringDeployment` -> `validateRemoteBuild` ("Downgrade config" offer).
5. Durable backend -> connection prompts on the remote app (`getDTSConnectionIfNeeded`, Netherite, SQL (Flex SQL modal warning)); always `getStorageConnectionIfNeeded` for `AzureWebJobsStorage`.
6. Warnings folded into one confirmation: connection strings pointing at local emulators, EOL stack, extension bundle, deprecated `zipGlobPattern`/`zipIgnorePattern` settings, Event Grid blob trigger on Flex (`showFlexEventGridWarning`, learn-more `aka.ms/learnMoreEventGridSubscription`). Confirmation "overwrite" dialog when `showDeployConfirmation` (existing app, zip deploy).
7. `runPreDeployTask` (`preDeployTask`; `func:` tasks require Core Tools; Python Linux uses `func: pack --build-native-deps`).
8. 64-bit worker alignment for .NET x64 / durable projects ("Update remote app to 64 bit?" / "Deploy Anyway"); Netherite config update.
9. `verifyAppSettings`: `FUNCTIONS_WORKER_RUNTIME` and `FUNCTIONS_EXTENSION_VERSION` mismatch modals ("Update and Deploy" / "Deploy Anyway"), merges `AzureWebJobsFeatureFlags`, adds `WEBSITE_RUN_FROM_PACKAGE=1` where useful, removes `WEBSITE_RUN_FROM_ZIP`; polls until settings propagate.
10. Execute with temporary tree description "Deploying...": **Custom handler on Flex** -> `DeployFunctionCoreToolsStep` (100, `func azure functionapp publish <site>`); otherwise shared `innerDeploy` (zip / one-deploy / storage) with `CreateRemoteMcpServerExecuteStep` (999, adds a remote MCP server entry to `.vscode/mcp.json` for MCP projects). `postDeployTask` runs after zip deploy.
11. `notifyDeployComplete` ("Deployment to "{0}" completed."; buttons **View output**, **Stream logs**, **Upload settings**, **Connect to MCP Server**; callback `postDeploy`) and background trigger listing (4 retries, 2 s) that logs HTTP trigger URLs (anonymous only; warns for keyed).

### 5.8 Durable Task Scheduler — `createScheduler` / `createTaskHub` / delete

- `createScheduler`: name ("Enter a name for the new scheduler") -> SKU (**Consumption** / **Dedicated**) -> `ResourceGroupListStep` -> `LocationListStep` (provider `Microsoft.DurableTask`, type `schedulers`). Execute: `VerifyProvidersStep([Microsoft.DurableTask])` (error if not registered) -> RG create -> `SchedulerCreationStep` (110, waits up to 30 min; activity "Create Durable Task Scheduler "{0}"").
- `createTaskHub`: name -> `TaskHubCreationStep` (1). Title "Create Durable Task Hub".
- `deleteScheduler` / `deleteTaskHub`: confirmation + DTS REST delete, refresh parent.
- `startEmulator`: validates Docker, `docker run` `<emulatorRegistry>/<emulatorImage>:<emulatorTag>` with random host ports for 8080 (gRPC endpoint) and 8082 (dashboard); `stopEmulator` removes the container; emulators are also removed on deactivate.

### 5.9 Managed identity

- `assignManagedIdentity`: `UserAssignedIdentityListStep` (incl. "`$(plus) Assign new user-assigned identity`") -> `ManagedIdentityAssignStep` (500; type None -> `UserAssigned`, `SystemAssigned` -> `SystemAssigned, UserAssigned`; `webApps.beginCreateOrUpdateAndWait`).
- `unassignManagedIdentity`: confirmation ("'{0}' will not be able to request access tokens ...") -> `ManagedIdentityUnassignStep` (510; collapses type back).
- `enableSystemIdentity`: `EnableSystemIdentityAssignStep` (`webApps.update`; temporary description "Enabling system assigned identity...").
- `addLocalMIConnections` / `addRemoteMIConnections`: `ConnectionsListStep` ("Select the connections to add identity settings for."; connection-string-like settings) -> `SettingsAddBaseStep` (150; e.g. a storage connection string becomes `<account>__blobServiceUri` / `__queueServiceUri` / `__tableServiceUri`, or `AzureWebJobsStorage__*`) -> `LocalSettingsAddStep` (160, `local.settings.json`) or `RemoteSettingsAddStep` (160, app settings). The remote flow first warns "This command will assign a managed identity and roles", picks a user-assigned identity (`UserAssignedIdentityListStep`) and adds `RoleAssignmentExecuteStep` for the resources' roles.

### 5.10 Connection-setting sub-wizards (reused by create-function, add-binding, debug validation, deploy)

| Family | Choices | Execute steps (priority) | Setting keys written |
|---|---|---|---|
| Azure Storage (`AzureWebJobsStorage`) | "Connect Azure Storage Account" / emulator / "Skip for now" | `StorageAccountGetConnectionStep` 230, `StorageConnectionSetSettingStep` 240 | `AzureWebJobsStorage` (emulator: `UseDevelopmentStorage=true` / Azurite endpoints from `azurite.*`) |
| Durable Task Scheduler | Azure scheduler (existing / create) + task hub, **emulator** (start if needed), custom string | `DurableTaskSchedulerCreateStep` 150, `DurableTaskHubCreateStep` 160, `DTSEmulatorStartStep` 190, `DurableTaskSchedulerGetConnectionStep` / `DTSEmulatorGetConnectionsStep` 200, `DTSConnectionSetSettingStep` 240, `DTSHubNameSetSettingStep` 241 | `DURABLE_TASK_SCHEDULER_CONNECTION_STRING`, `TASKHUB_NAME` (referenced from `host.json` as `%TASKHUB_NAME%`); custom string must contain `Endpoint=<http(s) URL>` and a non-empty `Authentication=` |
| Netherite (Event Hubs) | namespace (existing / create), event hub, auth rule, emulator | steps in the 190–245 priority band (namespace create/get, hub create/get, rule, emulator, set-setting) | `EventHubsConnection`, hub name setting |
| SQL | server (existing / create) + database, username/password, custom string | steps in the 205–250 band (server create, db create, get connection, set setting) | `SQLDB_Connection` |

`setAzureWebJobsStorage` wraps the storage family for `local.settings.json` ("Setting "AzureWebJobsStorage" in "local.settings.json"").

### 5.11 Non-wizard interactive flows

- **executeFunction**: Event Grid triggers -> `executeEventGridFunction` (sample-file flow below); other triggers prompt "Enter request body" (default from the template provider's sample data); HTTP triggers POST to the invoke URL, non-HTTP POST `/admin/functions/<name>` with `{ input }`; remote uses the master key (host keys API); local uses the running host port; `ECONNREFUSED` -> "make sure the project is running" message.
- **eventGrid.sendMockRequest / CodeLens**: `*.eventgrid.json` sample files generated from `https://api.github.com/repos/Azure/azure-rest-api-specs/contents/specification/eventgrid/data-plane/...` (source/event type picks); CodeLens "Save and execute..." sends to the local host (`eventGridSampleModified` when edited).
- **copyFunctionUrl**, **getMcpHostKey** (`webApps.listHostKeys`; returns system key `mcp_extension` for `McpExtensionServer` projects), **enable/disableFunction** (Section 1.2), **app settings upload/download** (shared `azureappsettings`), **encrypt/decrypt** (`func settings encrypt|decrypt` in the `local.settings.json` folder), **startStreamingLogs** (Section 1.4).
- **Open from portal (`onUri` / `handleUri`)** — gated by `enableOpenFromPortal`: `vscode://ms-azuretools.vscode-azurefunctions/?resourceId=...&defaultHostName=...&devcontainer=...&language=...&action=downloadContentAndSetupProject`. Downloads the app content zip (skipped for compiled languages) and extracts it, writes `.devcontainer/devcontainer.json` + `Dockerfile` from `raw.githubusercontent.com/microsoft/vscode-dev-containers/...`, initializes the project, then reopens VS Code on the folder ("Restarting VS Code with your function app project").
- **Host debug view `askCopilot`**: builds a prompt from the error + recent logs and opens `workbench.action.chat.open` in `agent` mode.

---

## 6. Config-file features (A + B)

| File | Read / written | Feature |
|---|---|---|
| `host.json` | R/W | project detection (`workspaceContains:**/host.json`), version, `extensionBundle`, durable `storageProvider`, dynamic concurrency, MCP extension config; JSON schema via `jsonValidation`. |
| `local.settings.json` | R/W | `Values` (worker runtime, `AzureWebJobsStorage`, connection settings, `AzureWebJobs.<fn>.Disabled`), `IsEncrypted`, `Host.LocalHttpPort`; Local Settings tree node; encrypt/decrypt; upload/download. |
| `function.json` | R/W | script-model functions (list, trigger type, add binding); JSON schema via `jsonValidation`; `explorer/context` + `editor/context` menus. |
| `.vscode/tasks.json` / `launch.json` / `settings.json` / `extensions.json` | W (merge) | init (5.4). |
| `.vscode/mcp.json` | R/W | local and remote MCP server entries. |
| `.funcignore` / `.gitignore` | W | project scaffolding (deploy honors `.funcignore`). |
| `requirements.txt`, `package.json`, `tsconfig.json`, `*.csproj`, `extensions.csproj`, `pom.xml`, `build.gradle`, `settings.gradle`, `go.mod`, `Ballerina.toml`, `profile.ps1`, `requirements.psd1` | R/W | language detection, scaffolding, durable deps, target framework / platform target, Java function-app name. |
| `*.eventgrid.json` | W / R | Event Grid mock requests + CodeLens + `editor/title` action. |
| `Dockerfile` | R/W | `createNewProjectWithDockerfile`; detection switches create-app to containerized. |
| `.devcontainer/devcontainer.json` + `Dockerfile` | W | open-from-portal. |
| `vscode-azurefunctions-static-content:` documents | virtual | read-only content provider (`utils/textUtils.ts`) backing markdown previews (e.g. Python v2 template docs, `showMarkdownPreview`). |

---

## 7. External integrations (B)

- **Azure SDKs:** `@azure/arm-appservice` (sites, slots, functions, keys, stacks), `@azure/arm-appinsights`, `@azure/arm-storage` + `@azure/storage-blob` (Flex deployment container), `@azure/arm-resourcegraph` (bulk app listing), `@azure/arm-eventhub`, `@azure/arm-servicebus`, `@azure/arm-cosmosdb`, `@azure/arm-sql`, `@azure/arm-resources-profile-2020-09-01-hybrid`; raw ARM REST for Flex geo-regions, Flex stacks, and the **DTS** `Microsoft.DurableTask` API (`2025-11-01`).
- **Shared azext libraries:** `@microsoft/vscode-azext-utils` (wizard, tree, telemetry, agent contracts), `-azureutils` (RG/storage/location/identity/role steps, request helpers), `-azureappservice` (site tree nodes, deploy, log stream, slots, Kudu), `-azureappsettings` (settings tree + upload/download), `-webview` (Template Gallery), `@microsoft/vscode-azureresources-api` (host v1 + v2 APIs).
- **Kudu / SCM and Functions host admin APIs:** zip/one-deploy, log stream, VFS files, deployment logs, `/admin/functions`, `/admin/host/status`, host/master/system keys.
- **Local processes:** `func` (Core Tools: host start, pack, extensions install, settings encrypt/decrypt, publish, `init --docker-only`), `npm`, `brew`, `dotnet`, `mvn`, `gradle`, `python` / venv, `go`, `dlv`, `bal`, `git`, `autorest` (OpenAPI), `docker` (via `@microsoft/vscode-container-client`, DTS emulator); `ps-tree` / VS Code's `@vscode/windows-process-tree` for process picking; `@microsoft/vscode-processutils`.
- **Extensions:** hard dependency Azure Resources; runtime calls to Azure Container Apps (`deployWorkspaceProject`), Python (`getRemoteLauncherCommand`), Azurite (`azurite.start_*`), language debuggers (node, debugpy, java, PowerShell, go, ballerina, coreclr), VS Code git API (`git.d.ts`).
- **GitHub:** deployment source connect / commit view (shared); `api.github.com` (Event Grid samples); `raw.githubusercontent.com` (template readmes, dev containers).
- **CDN / feeds:** Core Tools feed (`aka.ms/funcCliFeedV4`), extension-bundle index, templates (`cdn.functions.azure.com`), template-gallery manifest, npm registry dist-tags.
- **Copilot:** `agentMetadata` contract for the `@azure` agent (4 `azureFunctions.agent.*` commands); `workbench.action.chat.open` from the Template Gallery and the Host Debug view.
- **Experimentation:** `createExperimentationService`.

---

## 8. Docs layer (C) — supplementary only

- Primary: [Develop Azure Functions by using Visual Studio Code](https://learn.microsoft.com/azure/azure-functions/functions-develop-vs-code) — sections: create project, generated project files, add function, connect to services (add binding), sign in, create Azure resources (basic/advanced), create Azure Container Apps deployment, deploy project files, get URL of HTTP function, run functions (Azure / local), work with app settings locally, publish / download settings, install binding extensions, monitoring (streaming logs, Application Insights), C# script projects, command palette reference.
- `code.visualstudio.com/docs/azure/overview` — generic Azure-in-VS Code material only.
- **Stale in docs:** the command-palette table lists "Delete Proxy", which has no command in the source (Proxies were removed; only the orphan icon `azFuncProxy.svg` remains).
- **Not covered by docs:** Durable Task Scheduler (tree, emulator, create/delete, connection wizards), MCP projects / `getMcpHostKey` / `mcp.json`, Functions Host Exceptions Debugger view, Template Gallery, managed identity nodes and MI connections, slots, Go projects, Copilot agent integration, open-from-portal.

---

## 9. Usage Summary (telemetry)

Window 90d, `ddtelvscode` / `VSCodeExt` / `RawEventsVSCodeExt`, collected 2026-09-24, external users only (internal users were zero for every event). Raw counts are kept in the session working copy only.

- **Core loop (very high / high):** `deploy` is by far the top user-invoked command, followed by `postDeploy`, `resolveDebugConfiguration` (honest F5 signal — only unsuppressed for func-host pre-launch), `validateFuncCoreToolsInstalled`, `createNewProject` (+ `createNewProjectStarted`), `deployProject`, `pickProcess`, `createFunction`, `listLocalFunctions`.
- **Framework / plumbing rows (not features):** `call-tas-error` and `unhandlederror` (framework), `listLocalProjects` (enormous — cross-extension API poll), `resolveResource`, `createLocalProjectTreeItem`, `listApplicationSettings`, `appservice.streamingLogs`, `getData.initSite`, `functionApp.pickTreeItem`, `onFuncTaskChanged`, `api.isFuncCoreToolsInstalled` / `api.startFuncProcess` (called by other extensions).
- **Failure-only rows (successes suppressed):** `refreshFileWatcher`, `onDidTerminateDebugSession`, `onDidEndTask`, `onFuncTaskStarted`, `onDidStartTask` report *only* failures, so every row is Failed — worth investigating as background errors, not as evidence of breakage in a feature.
- **eventVersion splits:** `deploy`+`deployv2`, `deployProject`+`deployProjectv2`, `deploySlot`+`deploySlotv2`, `postDeploy`+`postDeployv2` — sum both when sizing. Root cause: `notifyDeployComplete.ts:52` sets `context.telemetry.eventVersion = 2` on the **outer** deploy context inside the `postDeploy` callback (almost certainly meant `postDeployContext`), so a deploy whose user clicks a notification button re-emits as `v2`. `openFilev2`, `executeFunctionv2`, `appSettings.uploadv2` are intentional.
- **Fix signals (high failure share among successes):** `installOrUpdateFuncCoreTools` and `uninstallFuncCoreTools` (fail far more often than succeed), `durableTaskScheduler.startEmulator` (mostly failures — Docker availability), `redeploy`, `createFunctionApp` / `createFunctionAppAdvanced` (success is a minority; most of the rest are cancels), `pickProcess` (about a third fail — host start timeouts), `appSettings.upload`, `getMcpHostKey`, `deployByFunctionAppId`, `eventGrid.sendMockRequest` (every recorded call failed), `listLocalFunctions` (large failure share — host not running).
- **Cancel-dominant / near-zero success:** `addBinding`, `connectToGitHub`, `configureDeploymentSource`, `viewCommitInGitHub`, `addRemoteMIConnections`, `addLocalMIConnections`, `assignManagedIdentity`, `durableTaskScheduler.createScheduler`, `createNewProjectWithDockerfile`.
- **No row in window:** `startRemoteDebug`, `startJavaRemoteDebug` (both setting-gated, off by default), `durableTaskScheduler.createTaskHub`, `.deleteTaskHub`, `.copySchedulerConnectionString`, `api.revealTreeItem`, `handleUri` (gated by `enableOpenFromPortal`), `createFunctionAppViaAgent`, `agent.*` (no telemetry wrapper).
- **Small but alive:** Host Debug view (`clearStoppedSessions`, `refresh`, `showRecentLogs`, `askCopilot`, `copyRecentLogs`), Template Gallery RPCs, identity commands, slots, Go (`validateGoInstalled`, `attachDlv`), DTS dashboard / emulator.

Per-feature drill-down (replace the feature name):

```kusto
let ext = 'ms-azuretools.vscode-azurefunctions';
let feature = 'azurefunctions.deploy';  // <-- any callbackId (lowercased)
let window = 90d;
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(window)
| where ExtensionName == ext
| where EventName == strcat(ext, '/', feature)
| summarize
    Invocations   = count(),
    ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
    Succeeded     = countif(tostring(Properties['result']) == 'Succeeded'),
    Failed        = countif(tostring(Properties['result']) == 'Failed'),
    Canceled      = countif(tostring(Properties['result']) == 'Canceled')
    by ExtensionVersion
| order by ExternalUsers desc
```

Drill-down deeplink: [feature = `azurefunctions.deploy`, by extension version](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAACpWRzW7bMBCE736KvVEC%2FNNr4aqXwAV0SFDUbS5FD2tylBClSIO7suwgD19Ismz0mBNBzs435DBACWelikwrK37rMjSlIOuT2OQwnTRdtOpTFLNdBCg1YO0yBtP%2F%2BtrhGNLFbIk2G%2FqyWhHHC1kO4cD2b%2B2oCKlHtixw5YjqfXSpp4o%2Bf3LbhQ2dKHJhnFOE6QqmXDtWPrCgMM%2F7h%2BSwO6sp1z%2B4350QVW6Hi3fqX5FBe%2BQT8k%2FfQpTbI30lfknFlFXepnZnRRSf4hO3oKoairiLA3oWRLNlLXDWJZmNWc4NDCzp2pazf8OCiKiOp2R5LIOIKrKpi1qUy1EcAnPk8EuQhSpyo%2BqbYnrBI9tXH1G7JdVSx2l2iG84CK6MfWct4OCGzRzgm0KTaPbxpfie0xFZPeS3yZAuqPlTDhRzs5or6xv7cAV9lDVZZ9ADR4sb6kOg2WrKkXS43L%2FlGXlYFu%2BUskOetXuDDmL%2FAZlZau%2FBAgAA)

---

## Migration-relevant cross-cutting notes

- **Host API split.** Function Apps and local projects use the **legacy v1** Azure Resources APIs (`registerApplicationResourceResolver`, `registerWorkspaceResourceProvider`, `AzExtTreeItem` + `pickAppResource`), while DTS uses **v2** branch data providers. A monorepo port should re-model the whole tree on `DataProvider` / `ViewProvider`.
- **Shared-library coupling.** Large parts of the UX (settings, files/logs, deployments, slots, swap, log stream, deploy engine, RG/storage/plan/App Insights steps, identity picker) live in `@microsoft/vscode-azext-azureappservice` / `-azureappsettings` / `-azureutils`, not in this repo. Their behavior must be re-inventoried from those packages (or the App Service extension migration) before porting.
- **External contracts.** Exported API `1.10.0` (`listLocalProjects` / `listLocalFunctions` / `startFuncProcess` / `isFuncCoreToolsInstalled` / app-settings sync / `createFunction` / `revealTreeItem`) is consumed by other extensions at high volume; the `agentMetadata` contract is consumed by the `@azure` Copilot agent. Keep or deliberately version both.
- **Templates subsystem is the largest scope item.** `CentralTemplateProvider` + per-language providers (script, bundle, Node v4, Python v2 action schema, .NET via `dotnet new` JSON CLI, Java, Ballerina), sources (latest / `Staging` / `Backup`), global-state caching, and shipped `resources/backupTemplates`. Plus the separate Template Gallery manifest.
- **Language matrix.** 9+ languages x programming models x runtime versions drive project create, init, debug, tasks, deploy guards. Candidates to trim: Functions v1–v3 (EOL), Node v3 / Python v1 models, C#/F# script, Ballerina (hidden), Java remote debug (off by default, no telemetry).
- **`when`-clause regexes** have no `\b` and several collide (Section 3); rebuild them from explicit context-value constants.
- **Bugs to fix, not port:** `ContainerTreeItem.initSite` infinite recursion; `postDeploy` `eventVersion` set on the outer context; `/azFuncLocalProject/i` matching init/invalid nodes; `/userAssignedIdentity/` matching the parent; `durableTaskScheduler.createScheduler` has an empty-`when` `commandPalette` entry (no-op); `showDeploySubpathWarning` has no reference in this repo (verify in shared libs); `azFuncProxy.svg` orphan icon; deprecated `templateFilter` setting.
- **Candidate drops (advisory):** `templateFilter` (dead setting), `startJavaRemoteDebug` / `startRemoteDebug` (off by default, no usage), `viewCommitInGitHub` / `connectToGitHub` / `configureDeploymentSource` (cancel-dominant, shared-lib features), `agent.getAgentBenchmarkConfigs` (test harness), `openWalkthrough` + hidden walkthrough (tiny usage), `eventGrid.sendMockRequest` (all failures).
- **Migrate first (advisory):** create project / create function / init, local F5 (task provider + debug providers + pick process + pre-debug validation), deploy (incl. Flex and custom-handler publish), create Function App (Flex basic), Core Tools lifecycle (with the install failure rate addressed), app settings sync, local/remote function tree with execute / copy URL.



