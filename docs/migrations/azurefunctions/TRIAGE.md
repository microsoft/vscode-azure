# Azure Functions -- Migration Triage (SIGNED)

Signed-off decision record for migrating the Azure Functions extension into
`vscode-azure`. Every row of [INVENTORY.md](INVENTORY.md) is dispositioned
here with a stable, permanent ID. The dispositions are read-only for the
mapping, sequencing, implementation, and verification phases; they change only
by editing this file and reconfirming with the reviewer.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurefunctions` at `801689c66f96b31bc9d7c79ff6cc8d65e41b6965` (v1.22.1) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Target** | `extensions/vscode-azure` plus `packages/azutils` |
| **Precedents** | `functions` (existing azd Function App creation and deploy, Web App tree, workspace detector), `swa` (product migration, CLI tools, azd deploy), `acr` (resource providers and virtual children), shared settings and tool services |
| **Scope** | Monorepo Phase 1 (beta): parity gaps are acceptable and non-core features may be deferred. Only Functions runtime v4 is in scope. |
| **Rows** | 271 (FUNC-001 through FUNC-271) |
| **Signed off by** | Brandon Waterloo (@bwateratmsft) |
| **Date** | 2026-09-24 |
| **Review** | Excel review workbook; 30 rows overridden, 241 accepted as recommended (blank decision = agreement). |
| **Last confirmed** | 2026-10-12; reviewer confirmed CLI v5 scaffolding ownership, including gallery-backed creation through `func quickstart`; dispositions are unchanged. Earlier, 2026-09-29: PR review moved FUNC-055 to Reuse (`azd pipeline config`) and FUNC-168 back to Migrate (remote Functions group node), added optional `launch.json` generation to FUNC-030, and clarified that `local.settings.json` stays. Earlier, 2026-09-24: F5 design review moved FUNC-203 through FUNC-207 to Drop. |

## Granularity

### Confirmed scaffolding scope

The reviewer approved: "Let's leave scaffolding to the v5 func CLI."
Project creation delegates to `func init` or gallery-backed `func quickstart`;
function creation delegates to `func new`. The CLI owns template discovery,
template-specific requirements and validation, generated files, dependencies,
and project configuration. The extension retains thin entry points, folder
selection, tool acquisition, cancellation/error handling, and editor/workspace
integration.

Kept language goals use verified CLI v5 workloads, including Java project
creation. Packaged capabilities must be verified before implementation; a
missing capability requires a scope decision, not bespoke scaffolding.
The Java sub-scope of FUNC-028, FUNC-235, and FUNC-236 remains deferred;
their other supported languages remain Adapt. FUNC-226 (Go) and FUNC-208
(gallery webview) remain Defer. Gallery-backed creation does not restore
separately deferred binding, Durable, MCP, or container integrations.

CLI v5 is distinct from Functions runtime v4. Runtime scope remains v4;
the implemented F5 path acquires Core Tools v4 independently of scaffolding.

One row per contributed or code-only command; per contributed setting; per
read-but-not-contributed setting family; per tree node type (trigger, state,
and access tokens on a function node are composed tokens on one node type);
per wizard flow and per independently keepable substep (language, hosting
plan, connection family); per integration surface (client, provider, parser,
exported API member); per debug configuration provider, task definition,
problem matcher and pattern; per manifest-level contract; per orphan.

## Dispositions

| Disposition | Count | Meaning in this record |
|---|---:|---|
| Migrate | 25 | Preserve the source capability using monorepo patterns |
| Adapt | 36 | Preserve the user goal with intentionally different behavior or UX |
| Reuse | 19 | Satisfy the feature by wiring an existing monorepo capability |
| Drop | 135 | Do not carry the source capability forward |
| Defer | 56 | Retain the goal for later tracked work |
| **Total** | **271** | |

## Cross-cutting decisions

- **Deployment is azd.** Deploy flows are rebuilt on `AzdJob`; the source's
  per-deploy settings, guards, and zip/`func publish` paths are not carried forward.
- **Flex Consumption only.** Function App creation always provisions Flex
  Consumption; users change plans in the generated Bicep.
- **Managed identity only.** Created apps use managed identity for connections;
  no secrets or connection strings.
- **Function tree shape.** Under a Function App, functions sit in one
  "Functions" group node beside Application Settings, so an app with many
  triggers does not bury its other children. Under the local project node
  (workspace), functions are listed directly, with no group node.
- **Log streaming follows Container Apps.** Streaming opens a pseudoterminal;
  closing it stops the stream. There is no Logs node.
- **`local.settings.json` stays; no settings file sync.** Projects keep
  `local.settings.json` (written by `func init`, read by `func host start` and
  local execute). Remote app settings are owned by IaC, so there is no upload,
  download, encrypt, decrypt, or tree node for the file.
- **Scaffolding delegates to CLI v5.** Project and function creation wrap
  `func init` / `func new`; gallery-backed projects use `func quickstart`.
  The CLI owns the catalog and generation pipeline; the source template
  subsystem and gallery webview are not carried forward in this phase.
  Shared tool acquisition keeps scaffolding's CLI version/workloads separate
  from the implemented Core Tools v4 F5 path.
- **F5 without `tasks.json` / `launch.json`.** A contributed `azure-functions`
  debug type builds the project, starts the host in-process, and resolves to the
  language debugger's attach configuration. `launch.json` is optional: F5
  works without it, and users who want more control can generate an
  `azure-functions` entry that exposes the configurable options. No
  `tasks.json` is generated, and no task type, problem matcher, or
  process-pick command is contributed. Existing projects' source-generated
  `tasks.json` / `launch.json` are left untouched; users delete them or re-initialize.
- **No exported API or agent contract.** The source's exported API and
  `agent.*` commands have no monorepo consumer. External consumers exist (see
  [Known external consumers](#known-external-consumers)); they are dropped
  anyway, and the owning teams are told before the source extension is retired.
- Telemetry informed these decisions qualitatively; see
  [INVENTORY.md Section 9](INVENTORY.md#9-usage-summary-telemetry). No raw counts are recorded here.

## Known external consumers

Extensions that depend on the source extension's API, commands, settings, or
task type. The affected rows stay dispositioned as recorded; the consumers
are listed so their owners can be told before the source extension is retired.

| Consumer | Dependency | Affected rows |
|---|---|---|
| C# Dev Kit | Exported API | FUNC-016, FUNC-017 |
| Logic Apps Standard (`Azure/LogicAppsUX`) | Hard `extensionDependencies`; runs source commands; generates `func` tasks | FUNC-032, FUNC-034, FUNC-035, FUNC-102, FUNC-203, FUNC-204 |
| Fabric User Data Functions (`microsoft/vscode-fabric-functions`) | Hard `extensionDependencies`; `func` tasks in templates; reads source settings | FUNC-116, FUNC-131, FUNC-133, FUNC-203, FUNC-204 |
| Static Web Apps | Exported API; also being migrated into `vscode-azure` | FUNC-011, FUNC-012, FUNC-013 |
| SQL Bindings (`mssql` / Azure Data Studio) | Exported API types; current upstream use unconfirmed | JC-API rows |
| Azure Resources | Hosts the source tree; also being migrated into `vscode-azure` | FUNC-005, FUNC-006 |

## Decision table

Judgment-call groups (`JC-*`) mark rows the reviewer was asked to weigh as a set.

| ID | Section | Inventory feature | Disposition | Rationale | Reviewer note | Group |
|---|---|---|---|---|---|---|
| FUNC-001 | 0 Extension | extensionDependencies on Azure Resources | **Drop** | Never depend on an extension being retired; the monorepo owns its own views. |  |  |
| FUNC-002 | 0 Extension | Project detection (`workspaceContains:**/host.json` activation) | **Reuse** | `functionsDetector` already tags `host.json` through the workspace index; no activation event needed. Core Tools project-info command requested in [Azure/azure-functions-core-tools#5344](https://github.com/Azure/azure-functions-core-tools/issues/5344). |  |  |
| FUNC-003 | 0 Extension | `onView:azureWorkspace` activation | **Drop** | Host view belongs to Azure Resources; the target has its own workspace view. |  |  |
| FUNC-004 | 0 Extension | virtualWorkspaces limited capability + `!virtualWorkspace` enablement gates | **Migrate** | Keep the gate on every retained local-only command (create project, deploy, debug). |  |  |
| FUNC-005 | 0 Extension | x-azResources azure/workspace branches + onFetch/onResolve activation | **Drop** | Azure Resources host contract; replaced by providers in `registerTrees`. |  |  |
| FUNC-006 | 0 Extension | x-azResources Create Resource entries (Function App, DTS) | **Drop** | Host create-resource picker contract; target palette create commands cover the goal. |  |  |
| FUNC-007 | 0 Extension | agentMetadata contract for the @azure Copilot agent | **Defer** | External consumer (@azure agent) keys on `azureFunctions.*` ids; needs a monorepo-level agent contract first. |  | JC-AGENT |
| FUNC-008 | 0 Extension | jsonValidation `function.json` schema | **Migrate** | Zero activation cost; `function.json` is still used by v4 script-model languages (PowerShell, JS v3, Python v1). |  |  |
| FUNC-009 | 0 Extension | jsonValidation `host.json` schema | **Migrate** | Zero activation cost; every Functions project has `host.json`. |  |  |
| FUNC-010 | 0 Extension | API `revealTreeItem` | **Drop** | No monorepo consumer; no telemetry in window. |  | JC-API |
| FUNC-011 | 0 Extension | API `createFunction` | **Drop** | Consumers are sibling extensions being retired; no monorepo consumer found. Known external consumer: Static Web Apps. |  | JC-API |
| FUNC-012 | 0 Extension | API `downloadAppSettings` | **Drop** | No monorepo consumer; App Service-family sync belongs to the shared settings framework. Known external consumer: Static Web Apps. |  | JC-API |
| FUNC-013 | 0 Extension | API `uploadAppSettings` | **Drop** | No monorepo consumer. Known external consumer: Static Web Apps. |  | JC-API |
| FUNC-014 | 0 Extension | API `listLocalProjects` | **Drop** | Very high-volume cross-extension poll, but its consumers are the extensions being retired; the monorepo uses the workspace index. |  | JC-API |
| FUNC-015 | 0 Extension | API `listLocalFunctions` | **Drop** | Same as listLocalProjects; the capability survives internally for the local function tree. |  | JC-API |
| FUNC-016 | 0 Extension | API `isFuncCoreToolsInstalled` | **Drop** | ToolService answers this internally; no monorepo consumer. Known external consumer: C# Dev Kit. |  | JC-API |
| FUNC-017 | 0 Extension | API `startFuncProcess` | **Drop** | No monorepo consumer; the host-start capability survives internally for F5. Known external consumer: C# Dev Kit. |  | JC-API |
| FUNC-018 | 0 Extension | Test-only API (`VSCODE_RUNNING_TESTS`, apiVersion 99) | **Drop** | Source test plumbing. |  |  |
| FUNC-019 | 0 Extension | Consumed Container Apps extension API (`deployWorkspaceProject`) | **Drop** | Never depend on a retiring extension. |  | JC-CONTAINER |
| FUNC-020 | 0 Extension | Activation: finish deferred post-create steps after reload | **Drop** | Don't want to support cross-session creation like this. | Override (recommended Adapt). | JC-SCAFFOLD |
| FUNC-021 | 0 Extension | Activation: outdated / multiple Core Tools warnings | **Reuse** | ToolService / FuncInstaller owns tool version checks; no activation-time prompt. |  |  |
| FUNC-022 | 0 Extension | Activation: verify/fix VS Code config per workspace folder | **Drop** | Activation-time prompts cost every user; init remains available on demand. |  | JC-SCAFFOLD |
| FUNC-023 | 0 Extension | Output channel "Azure Functions" + diagnostic collection | **Drop** | Target uses the shared output channel. |  |  |
| FUNC-024 | 0 Extension | Global error handler suppressing Report Issue | **Drop** | Target framework handles error UI per command. |  |  |
| FUNC-025 | 0 Extension | Experimentation service | **Drop** | No product experiments planned. |  |  |
| FUNC-026 | 1.1 Local project | `azureFunctions.createNewProject` | **Adapt** | High usage. Thin CLI v5 `func init` / gallery-backed `func quickstart` integration; CLI owns scaffolding. Functions runtime v4 only. | Confirmed reviewer decision. | JC-SCAFFOLD |
| FUNC-027 | 1.1 Local project | `azureFunctions.createNewProjectWithDockerfile` | **Defer** | Cancel-dominant; tied to the containerized-hosting decision. |  | JC-CONTAINER |
| FUNC-028 | 1.1 Local project | `azureFunctions.createFunction` | **Adapt** | High usage. Delegate discovery, validation, and generation to CLI v5 `func new`; Java add-function remains deferred. | Confirmed reviewer decision. | JC-SCAFFOLD |
| FUNC-029 | 1.1 Local project | `azureFunctions.addBinding` | **Drop** | Only `function.json` projects; near-zero successes per telemetry. |  |  |
| FUNC-030 | 1.1 Local project | `azureFunctions.initProjectForVSCode` | **Adapt** | Debugging needs no generated `tasks.json` / `launch.json`. Generating an `azure-functions` `launch.json` entry is optional and exposes the configurable options. Init otherwise writes only non-debug workspace files (for example `.vscode/extensions.json` recommendations), never project configuration in VS Code settings. | Adapt, but to the greatest extent possible, make debugging work without a tasks.json/launch.json needed. | JC-SCAFFOLD |
| FUNC-031 | 1.1 Local project | `azureFunctions.installOrUpdateFuncCoreTools` | **Reuse** | `vscode-azure/installFunc` + FuncInstaller already exist; source failure rate is a reliability lesson. |  |  |
| FUNC-032 | 1.1 Local project | `azureFunctions.uninstallFuncCoreTools` | **Drop** | Incidental; mostly fails; SWA precedent dropped CLI uninstall. Known external consumer: Logic Apps Standard. |  |  |
| FUNC-033 | 1.1 Local project | `azureFunctions.pickProcess` | **Adapt** | High usage; .NET attach depends on it. Rebuild on shared process/task services. |  | JC-LOCALDEV |
| FUNC-034 | 1.1 Local project | `azureFunctions.appSettings.encrypt` | **Drop** | Low usage; thin wrapper over `func settings encrypt`. Known external consumer: Logic Apps Standard. |  |  |
| FUNC-035 | 1.1 Local project | `azureFunctions.appSettings.decrypt` | **Drop** | Low usage; thin wrapper over `func settings decrypt`. Known external consumer: Logic Apps Standard. |  |  |
| FUNC-036 | 1.1 Local project | `azureFunctions.setAzureWebJobsStorage` | **Drop** | This sort of thing goes to IaC. | Override (recommended Defer). | JC-LOCALDEV |
| FUNC-037 | 1.1 Local project | `azureFunctions.addLocalMIConnections` | **Drop** | Low, cancel-dominant. |  | JC-IDENTITY |
| FUNC-038 | 1.1 Local project | `azureFunctions.eventGrid.sendMockRequest` | **Drop** | Very low usage; every recorded call failed. |  |  |
| FUNC-039 | 1.1 Local project | `azureFunctions.openWalkthrough` | **Drop** | Walkthrough is hidden; tiny usage. |  |  |
| FUNC-040 | 1.1 Local project | Walkthrough `functionsStart` (3 steps, hidden) | **Drop** | Hidden (`when: false`); tiny usage. |  |  |
| FUNC-041 | 1.2 Functions | `azureFunctions.executeFunction` | **Migrate** | High usage; local and remote. |  |  |
| FUNC-042 | 1.2 Functions | `azureFunctions.copyFunctionUrl` | **Migrate** | High usage. |  |  |
| FUNC-043 | 1.2 Functions | `azureFunctions.enableFunction` | **Migrate** | Moderate; writes `AzureWebJobs.<name>.Disabled`. v1 branch not needed. |  |  |
| FUNC-044 | 1.2 Functions | `azureFunctions.disableFunction` | **Migrate** | Pairs with enable. |  |  |
| FUNC-045 | 1.2 Functions | `azureFunctions.deleteFunction` | **Migrate** | Moderate; remote only. |  |  |
| FUNC-046 | 1.3 Deploy | `azureFunctions.deploy` (Function App node / explorer folder) | **Adapt** | Top command. Deploy goes through azd; open question: deploying to an existing app azd did not create. |  | JC-DEPLOY |
| FUNC-047 | 1.3 Deploy | `azureFunctions.deployProject` (workspace) | **Adapt** | High; maps to `vscode-azure/functions/deploy` / azd up from the workspace project node. |  | JC-DEPLOY |
| FUNC-048 | 1.3 Deploy | `azureFunctions.deploySlot` | **Defer** | Slots decided as a unit; Flex (the default plan) has no slots. |  | JC-SLOTS |
| FUNC-049 | 1.3 Deploy | `azureFunctions.deployByFunctionAppId` | **Drop** | Programmatic entry for other extensions/agents; all recorded calls failed. |  | JC-AGENT |
| FUNC-050 | 1.3 Deploy | `azureFunctions.redeploy` | **Drop** | Kudu deployments node; mostly fails; the Activity view tracks azd deployments. |  | JC-KUDU |
| FUNC-051 | 1.3 Deploy | `azureFunctions.viewDeploymentLogs` | **Drop** | Kudu deployments node (absent for Flex); Activity view covers azd deployments. |  | JC-KUDU |
| FUNC-052 | 1.3 Deploy | `azureFunctions.viewCommitInGitHub` | **Drop** | Zero successes per telemetry. |  |  |
| FUNC-053 | 1.3 Deploy | `azureFunctions.openInPortal` (deployment node) | **Drop** | Deployment node dropped; generic open-in-portal covers resources. |  | JC-KUDU |
| FUNC-054 | 1.3 Deploy | `azureFunctions.configureDeploymentSource` | **Drop** | Kudu SCM (None/LocalGit/GitHub); cancel-dominant. CI/CD goal is `vscode-azure/configureCicd`. |  | JC-KUDU |
| FUNC-055 | 1.3 Deploy | `azureFunctions.connectToGitHub` | **Reuse** | CI/CD setup goes through `azd pipeline config`, already wired as `vscode-azure/configureCicd`. |  | JC-KUDU |
| FUNC-056 | 1.3 Deploy | `azureFunctions.disconnectRepo` | **Drop** | Pairs with Kudu deployment source. |  | JC-KUDU |
| FUNC-057 | 1.4 App lifecycle | `azureFunctions.createFunctionApp` | **Adapt** | Already partly exists as `vscode-azure/functions/createNew`/`deploy` (azd + Bicep). Close gaps from the source flow. |  |  |
| FUNC-058 | 1.4 App lifecycle | `azureFunctions.createFunctionAppAdvanced` | **Drop** | No advanced variant (prompt budget); advanced deltas become Bicep parameters. |  |  |
| FUNC-059 | 1.4 App lifecycle | `azureFunctions.deleteFunctionApp` | **Reuse** | `vscode-azure/resources/delete`. |  |  |
| FUNC-060 | 1.4 App lifecycle | `azureFunctions.startFunctionApp` | **Migrate** | High usage; new command on the `Microsoft.Web/sites` node (shareable with App Service). |  |  |
| FUNC-061 | 1.4 App lifecycle | `azureFunctions.stopFunctionApp` | **Migrate** | Pairs with start. |  |  |
| FUNC-062 | 1.4 App lifecycle | `azureFunctions.restartFunctionApp` | **Migrate** | Moderate usage. |  |  |
| FUNC-063 | 1.4 App lifecycle | `azureFunctions.browseWebsite` | **Reuse** | `vscode-azure/resources/browseWebsite` (WebAppDataProvider already sets the website URL). |  |  |
| FUNC-064 | 1.4 App lifecycle | `azureFunctions.viewProperties` | **Reuse** | `vscode-azure/resources/viewProperties`. |  |  |
| FUNC-065 | 1.4 App lifecycle | `azureFunctions.startStreamingLogs` | **Adapt** | Moderate. Kudu log stream only on Windows; Linux/Flex opens App Insights Live Metrics. Decide which to keep. | Good pattern in ACA for how to do this. Maybe combine to share code. | JC-KUDU |
| FUNC-066 | 1.4 App lifecycle | `azureFunctions.stopStreamingLogs` | **Drop** | "Drop", but do it the ACA way--that is, opening a pseudoterminal; closing stops it. | Override (recommended Adapt). | JC-KUDU |
| FUNC-067 | 1.4 App lifecycle | `azureFunctions.startRemoteDebug` | **Drop** | Experimental, off by default, no usage. |  |  |
| FUNC-068 | 1.4 App lifecycle | `azureFunctions.startJavaRemoteDebug` | **Drop** | Experimental, off by default, Windows only, no usage. |  |  |
| FUNC-069 | 1.4 App lifecycle | `azureFunctions.createSlot` | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-070 | 1.4 App lifecycle | `azureFunctions.deleteSlot` | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-071 | 1.4 App lifecycle | `azureFunctions.swapSlot` | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-072 | 1.5 App settings | `azureFunctions.appSettings.add` | **Reuse** | Shared settings JSONC document (`vscode-azure/settings/edit` + WebAppSettingsAdapter). |  |  |
| FUNC-073 | 1.5 App settings | `azureFunctions.appSettings.download` | **Drop** | App settings are owned by IaC; no local.settings.json sync. | Override (recommended Defer). | JC-SETTINGSSYNC |
| FUNC-074 | 1.5 App settings | `azureFunctions.appSettings.upload` | **Drop** | App settings are owned by IaC; no local.settings.json sync. | Override (recommended Defer). | JC-SETTINGSSYNC |
| FUNC-075 | 1.5 App settings | `azureFunctions.appSettings.edit` | **Reuse** | Shared settings JSONC document. |  |  |
| FUNC-076 | 1.5 App settings | `azureFunctions.appSettings.rename` | **Reuse** | Shared settings JSONC document. |  |  |
| FUNC-077 | 1.5 App settings | `azureFunctions.appSettings.delete` | **Reuse** | Shared settings JSONC document. |  |  |
| FUNC-078 | 1.5 App settings | `azureFunctions.appSettings.toggleSlotSetting` | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-079 | 1.5 App settings | `azureFunctions.toggleAppSettingVisibility` | **Drop** | The shared framework shows no values in the tree; values are edited in one document. |  |  |
| FUNC-080 | 1.5 App settings | `azureFunctions.addRemoteMIConnections` | **Drop** | Zero successes per telemetry. |  | JC-IDENTITY |
| FUNC-081 | 1.6 Identity | `azureFunctions.assignManagedIdentity` | **Defer** | Identity belongs to a shared `Microsoft.Web/sites` capability, and IaC owns it for azd apps. |  | JC-IDENTITY |
| FUNC-082 | 1.6 Identity | `azureFunctions.unassignManagedIdentity` | **Defer** | Pairs with assign. |  | JC-IDENTITY |
| FUNC-083 | 1.6 Identity | `azureFunctions.enableSystemIdentity` | **Drop** | Going toward UAMI only future. | Override (recommended Defer). | JC-IDENTITY |
| FUNC-084 | 1.7 DTS | `durableTaskScheduler.createScheduler` | **Defer** | Separate resource type; cancel-dominant; later azd + Bicep (AVM) create. |  | JC-DTS |
| FUNC-085 | 1.7 DTS | `durableTaskScheduler.createTaskHub` | **Defer** | DTS as a unit; no usage in window. |  | JC-DTS |
| FUNC-086 | 1.7 DTS | `durableTaskScheduler.deleteScheduler` | **Defer** | Generic resource delete may cover it when the DTS tree lands. |  | JC-DTS |
| FUNC-087 | 1.7 DTS | `durableTaskScheduler.deleteTaskHub` | **Defer** | DTS as a unit; no usage in window. |  | JC-DTS |
| FUNC-088 | 1.7 DTS | `durableTaskScheduler.copySchedulerConnectionString` | **Defer** | DTS as a unit; no usage in window. |  | JC-DTS |
| FUNC-089 | 1.7 DTS | `durableTaskScheduler.copySchedulerEndpoint` | **Defer** | DTS as a unit. |  | JC-DTS |
| FUNC-090 | 1.7 DTS | `durableTaskScheduler.copyEmulatorConnectionString` | **Defer** | DTS emulator as a unit. |  | JC-DTS |
| FUNC-091 | 1.7 DTS | `durableTaskScheduler.openTaskHubDashboard` | **Defer** | DTS as a unit. |  | JC-DTS |
| FUNC-092 | 1.7 DTS | `durableTaskScheduler.startEmulator` | **Defer** | Would map onto the Emulators workspace group; mostly fails today (Docker availability). |  | JC-DTS |
| FUNC-093 | 1.7 DTS | `durableTaskScheduler.stopEmulator` | **Defer** | Pairs with start. |  | JC-DTS |
| FUNC-094 | 1.7 DTS | `durableTaskScheduler.getEmulators` (code-only) | **Defer** | Internal plumbing for the emulator flow. |  | JC-DTS |
| FUNC-095 | 1.8 Host debug view | `funcHostDebug.refresh` | **Defer** | Host debug view decided with the F5 loop. |  | JC-LOCALDEV |
| FUNC-096 | 1.8 Host debug view | `funcHostDebug.clearStoppedSessions` | **Defer** | Host debug view. |  | JC-LOCALDEV |
| FUNC-097 | 1.8 Host debug view | `funcHostDebug.showRecentLogs` | **Defer** | Host debug view. |  | JC-LOCALDEV |
| FUNC-098 | 1.8 Host debug view | `funcHostDebug.copyRecentLogs` | **Defer** | Host debug view. |  | JC-LOCALDEV |
| FUNC-099 | 1.8 Host debug view | `funcHostDebug.askCopilot` | **Defer** | Host debug view. |  | JC-LOCALDEV |
| FUNC-100 | 1.9 Plumbing | `azureFunctions.reportIssue` | **Reuse** | Target framework error toasts provide Report Issue. |  |  |
| FUNC-101 | 1.9 Plumbing | `azureFunctions.getMcpHostKey` | **Defer** | MCP projects reference it from `.vscode/mcp.json`; needs a monorepo command id and MCP scope decision. |  | JC-AGENT |
| FUNC-102 | 1.9 Plumbing | `azureFunctions.openFile` (code-only; Files/Logs file click) | **Drop** | Drop remote file browsing...the source is literally there in their repository. Known external consumer: Logic Apps Standard. | Override (recommended Defer). | JC-KUDU |
| FUNC-103 | 1.9 Plumbing | `azureFunctions.showOutputChannel` (code-only) | **Drop** | Target has its own output channel and activity children. |  |  |
| FUNC-104 | 1.9 Plumbing | `agent.getCommands` (code-only) | **Drop** | Removing agent deploy. | Override (recommended Defer). | JC-AGENT |
| FUNC-105 | 1.9 Plumbing | `agent.runWizardCommandWithoutExecution` (code-only) | **Drop** | Removing agent deploy. | Override (recommended Defer). | JC-AGENT |
| FUNC-106 | 1.9 Plumbing | `agent.runWizardCommandWithInputs` (code-only) | **Drop** | Removing agent deploy. | Override (recommended Defer). | JC-AGENT |
| FUNC-107 | 1.9 Plumbing | `agent.getAgentBenchmarkConfigs` (code-only) | **Drop** | Benchmark harness only. | Removing agent deploy. | JC-AGENT |
| FUNC-108 | 2 Settings | `durableTaskScheduler.emulatorRegistry` | **Defer** | Follows the DTS emulator. |  | JC-DTS |
| FUNC-109 | 2 Settings | `durableTaskScheduler.emulatorImage` | **Defer** | Follows the DTS emulator. |  | JC-DTS |
| FUNC-110 | 2 Settings | `durableTaskScheduler.emulatorTag` | **Defer** | Follows the DTS emulator. |  | JC-DTS |
| FUNC-111 | 2 Settings | `templateFilter` | **Drop** | Deprecated; not read by code. |  |  |
| FUNC-112 | 2 Settings | `projectRuntime` | **Drop** | v4-only scope; project config does not belong in VS Code settings. |  |  |
| FUNC-113 | 2 Settings | `projectLanguage` | **Drop** | Project config; detect from the workspace instead. |  | JC-SCAFFOLD |
| FUNC-114 | 2 Settings | `projectLanguageModel` | **Drop** | Project config; latest programming models only. |  |  |
| FUNC-115 | 2 Settings | `projectTemplateKey` | **Drop** | Source template subsystem not migrated. |  |  |
| FUNC-116 | 2 Settings | `deploySubpath` | **Drop** | Deployment config belongs in `azure.yaml` (service `dist`). Known external consumer: Fabric User Data Functions. |  | JC-DEPLOY |
| FUNC-117 | 2 Settings | `projectSubpath` | **Drop** | Workspace index discovers every `host.json`. |  |  |
| FUNC-118 | 2 Settings | `showCoreToolsWarning` | **Drop** | Tool version UX is owned by ToolService. |  |  |
| FUNC-119 | 2 Settings | `showMultiCoreToolsWarning` | **Drop** | Tool version UX is owned by ToolService. |  |  |
| FUNC-120 | 2 Settings | `show64BitWarning` | **Drop** | Incidental .NET Framework warning. |  |  |
| FUNC-121 | 2 Settings | `enableRemoteDebugging` | **Drop** | Feature dropped (FUNC-067). |  |  |
| FUNC-122 | 2 Settings | `enableJavaRemoteDebugging` | **Drop** | Feature dropped (FUNC-068). |  |  |
| FUNC-123 | 2 Settings | `showProjectWarning` | **Drop** | Activation verify dropped (FUNC-022). |  | JC-SCAFFOLD |
| FUNC-124 | 2 Settings | `showPythonVenvWarning` | **Drop** | Activation verify dropped. |  | JC-SCAFFOLD |
| FUNC-125 | 2 Settings | `showDeploySubpathWarning` | **Drop** | Not referenced by the source; deploySubpath dropped. |  |  |
| FUNC-126 | 2 Settings | `showTargetFrameworkWarning` | **Drop** | Activation verify dropped. |  | JC-SCAFFOLD |
| FUNC-127 | 2 Settings | `showExtensionsCsprojWarning` | **Drop** | Activation verify dropped. |  | JC-SCAFFOLD |
| FUNC-128 | 2 Settings | `pickProcessTimeout` | **Drop** | Excessive to keep this setting. | Override (recommended Migrate). | JC-LOCALDEV |
| FUNC-129 | 2 Settings | `templateVersion` | **Drop** | Source template subsystem not migrated. |  |  |
| FUNC-130 | 2 Settings | `projectOpenBehavior` | **Drop** | Scaffolding sort of thing. | Override (recommended Migrate). | JC-SCAFFOLD |
| FUNC-131 | 2 Settings | `preDeployTask` | **Drop** | Deployment config; azd hooks replace it. Known external consumer: Fabric User Data Functions. |  | JC-DEPLOY |
| FUNC-132 | 2 Settings | `postDeployTask` | **Drop** | Deployment config; azd hooks replace it. |  | JC-DEPLOY |
| FUNC-133 | 2 Settings | `pythonVenv` | **Drop** | Project config; detect the venv folder instead. Known external consumer: Fabric User Data Functions. |  | JC-LOCALDEV |
| FUNC-134 | 2 Settings | `createPythonVenv` | **Drop** | This belongs to scaffolding and/or the Python extension. | Override (recommended Migrate). | JC-SCAFFOLD |
| FUNC-135 | 2 Settings | `scmDoBuildDuringDeployment` | **Drop** | Deployment config; belongs in IaC/azd. |  | JC-DEPLOY |
| FUNC-136 | 2 Settings | `enableOutputTimestamps` | **Drop** | Shared output channel. |  |  |
| FUNC-137 | 2 Settings | `stopFuncTaskPostDebug` | **Defer** | See if we need it if we go to the v5 Func tools. | Override (recommended Migrate). | JC-LOCALDEV |
| FUNC-138 | 2 Settings | `showDeployConfirmation` | **Drop** | azd deploy has its own flow. |  | JC-DEPLOY |
| FUNC-139 | 2 Settings | `validateFuncCoreTools` | **Drop** | Validation done by the installer. | Override (recommended Migrate). | JC-LOCALDEV |
| FUNC-140 | 2 Settings | `validateDelve` | **Defer** | Follows Go debugging (FUNC-195). |  | JC-LOCALDEV |
| FUNC-141 | 2 Settings | `validateGo` | **Defer** | Follows Go projects. |  | JC-LOCALDEV |
| FUNC-142 | 2 Settings | `validateEmulators` | **Defer** | See if we need it if we go to the v5 Func tools. | Override (recommended Migrate). | JC-LOCALDEV |
| FUNC-143 | 2 Settings | `requestTimeout` | **Drop** | Template/feed requests are not migrated. |  |  |
| FUNC-144 | 2 Settings | `hostStartTimeout` | **Defer** | See if we need it if we go to the v5 Func tools. | Override (recommended Migrate). |  |
| FUNC-145 | 2 Settings | `defaultFunctionAppToDeploy` | **Drop** | Deployment config belongs in `azure.yaml` / azd env. |  | JC-DEPLOY |
| FUNC-146 | 2 Settings | `suppressProject` | **Drop** | Incidental. |  |  |
| FUNC-147 | 2 Settings | `showHiddenStacks` | **Drop** | Target uses a curated runtime list. |  |  |
| FUNC-148 | 2 Settings | `showDeprecatedStacks` | **Drop** | Target uses a curated runtime list. |  |  |
| FUNC-149 | 2 Settings | `showReloadTemplates` | **Drop** | Source template subsystem not migrated. |  |  |
| FUNC-150 | 2 Settings | `enableOpenFromPortal` | **Drop** | Open-from-portal dropped (FUNC-209). |  |  |
| FUNC-151 | 2 Settings | `javaBuildTool` | **Drop** | Project config; a create prompt answers it once. |  | JC-SCAFFOLD |
| FUNC-152 | 2 Settings | `templateSource` | **Drop** | Dev-only template override. |  |  |
| FUNC-153 | 2 Settings | `funcCliPath` | **Drop** | ToolService resolves `func`; revisit if users need a custom path. |  |  |
| FUNC-154 | 2 Settings | `endOfLifeWarning` | **Drop** | Target uses a curated, current runtime list. |  |  |
| FUNC-155 | 2 Settings | `functionSubpath` | **Drop** | Project config; Core Tools defaults. |  | JC-SCAFFOLD |
| FUNC-156 | 2 Settings | `showFlexEventGridWarning` | **Drop** | Source deploy guard. |  | JC-DEPLOY |
| FUNC-157 | 2 Settings | `showMarkdownPreview` | **Drop** | Template-subsystem behavior. |  |  |
| FUNC-158 | 2 Settings | `allowProgrammingModelSelection` | **Drop** | Latest programming models only. |  | JC-LANG |
| FUNC-159 | 2 Settings | `showBallerinaProjectCreation` | **Drop** | Ballerina dropped. |  | JC-LANG |
| FUNC-160 | 2 Settings | `mcpProjectType` | **Drop** | Project config; detect from `host.json` / project. |  | JC-AGENT |
| FUNC-161 | 2 Settings | `projectTemplates.cacheExpirationHours` | **Drop** | Template Gallery dropped. |  |  |
| FUNC-162 | 2 Settings | `enableTemplateGallery` | **Drop** | Template Gallery dropped. |  |  |
| FUNC-163 | 2 Settings | Deprecated `zipGlobPattern` / `zipIgnorePattern` (read-only warning) | **Drop** | Deprecated; `.funcignore` is used. |  |  |
| FUNC-164 | 2 Settings | Foreign `azurite.*` host/port/cert keys | **Defer** | Only needed for the storage emulator connection string. |  | JC-LOCALDEV |
| FUNC-165 | 2 Settings | Foreign `azureResourceGroups.groupBy` | **Drop** | Never read a retiring extension's settings; target has `vscode-azure.groupBy`. |  |  |
| FUNC-166 | 3 Tree | Function App node (production / Flex CV, state and Flex description) | **Migrate** | Node exists via WebAppViewProvider; add Functions context values for kept commands. | Consider flattening the tree and showing only individual functions under a Function App--no more grouping. Flatten the tree: individual functions directly under the Function App. Group node restored by FUNC-168 in PR review (2026-09-29). |  |
| FUNC-167 | 3 Tree | Internal SlotTreeItem wrapper CV (`...;slot`) | **Drop** | Source implementation artifact. |  |  |
| FUNC-168 | 3 Tree | Remote Functions group node | **Migrate** | One "Functions" group under the Function App keeps many triggers from burying Application Settings and other children. | Reconfirmed in PR review (2026-09-29); earlier override to flatten withdrawn. |  |
| FUNC-169 | 3 Tree | Remote Function node (trigger / state / access tokens) | **Migrate** | Backs execute/copy URL/enable/disable/delete. |  |  |
| FUNC-170 | 3 Tree | Invalid remote function node | **Migrate** | Preserve the error state. |  |  |
| FUNC-171 | 3 Tree | Identity node + System Assigned (enabled/disabled) + role children | **Adapt** | A command to jump from the fn app to the identity it is using, i.e. reveal. | Override (recommended Defer). | JC-IDENTITY |
| FUNC-172 | 3 Tree | User Assigned group + identity nodes | **Defer** | Identity as a unit. |  | JC-IDENTITY |
| FUNC-173 | 3 Tree | Application Settings node + items | **Reuse** | `getSettingsNodes` + WebAppSettingsAdapter already wired in WebAppDataProvider. |  |  |
| FUNC-174 | 3 Tree | Files node (Kudu VFS) + folders/files | **Drop** | Drop remote file browsing; the source is in the user's repository. | Override (recommended Defer). | JC-KUDU |
| FUNC-175 | 3 Tree | Logs node (Kudu, not Flex) | **Drop** | No logs node, just commands to do the log streaming, like we have with ACA. Log streaming is covered by FUNC-065 (ACA-style pseudoterminal). | Override (recommended Defer). | JC-KUDU |
| FUNC-176 | 5 Wizards | Connection family: Azure Storage (`AzureWebJobsStorage`, emulator, skip) | **Defer** | Used by F5 validation and create-function; decide with the local dev loop. |  | JC-LOCALDEV |
| FUNC-177 | 3 Tree | Deployments node + deployment items (Kudu) | **Drop** | Absent for Flex; Activity view tracks azd deployments. |  | JC-KUDU |
| FUNC-178 | 3 Tree | Slots node + slot nodes | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-179 | 3 Tree | Invalid slot node | **Defer** | Slots as a unit. |  | JC-SLOTS |
| FUNC-180 | 3 Tree | Invalid Function App node | **Migrate** | Preserve the error state. |  |  |
| FUNC-181 | 3 Tree | Containerized Function App (ACA-hosted) nodes: container, functions, settings, image | **Defer** | Containerized hosting decided as a unit; fixes the source infinite-recursion bug. |  | JC-CONTAINER |
| FUNC-182 | 3 Tree | Local Project node (workspace) | **Migrate** | Exists as FunctionsProjectNode; add context values for kept commands. |  |  |
| FUNC-183 | 3 Tree | Local Project `convert` variant (connection-string-like settings) | **Drop** | Only backs MI conversions (dropped). |  | JC-IDENTITY |
| FUNC-184 | 3 Tree | Local Functions group node | **Adapt** | Flatten this group away? Flattened: individual functions are shown directly under the local project node, with no group node. | Override (recommended Migrate). |  |
| FUNC-185 | 3 Tree | Local Function node | **Migrate** | Backs execute/copy URL/enable/disable locally. |  |  |
| FUNC-186 | 3 Tree | Invalid local function node | **Migrate** | Preserve the error state. |  |  |
| FUNC-187 | 3 Tree | "Run build task to update this list..." hint | **Migrate** | Precompiled projects list from build output. |  |  |
| FUNC-188 | 3 Tree | "Start debugging to update this list..." hint | **Migrate** | Host-listed projects when the host is not running. |  |  |
| FUNC-189 | 3 Tree | Local Settings node + items (`local.settings.json`) | **Drop** | Settings upload/download are dropped (FUNC-073, FUNC-074), so there is no local.settings.json node. | Override (recommended Defer). | JC-SETTINGSSYNC |
| FUNC-190 | 3 Tree | Init project node + "Initialize project..." child | **Adapt** | Follows initProjectForVSCode (FUNC-030). |  | JC-SCAFFOLD |
| FUNC-191 | 3 Tree | Invalid local project node | **Migrate** | Preserve the error state. |  |  |
| FUNC-192 | 3 Tree | "Create Function Project..." hint (empty workspace) | **Adapt** | Workspace-view empty state or welcome content pointing at create project. |  | JC-SCAFFOLD |
| FUNC-193 | 3 Tree | DTS scheduler + task hub nodes | **Defer** | DTS as a unit (azutils already has a DTS task-hub logical type). |  | JC-DTS |
| FUNC-194 | 3 Tree | DTS emulators group + emulator + hub + Docker-error nodes | **Defer** | DTS emulator as a unit; would join the Emulators workspace group. |  | JC-DTS |
| FUNC-195 | 4 Debug | Go debug provider (Delve attach) + Go toolchain validation | **Defer** | Go is preview; follow the language matrix. |  | JC-LANG |
| FUNC-196 | 3 Tree | Functions Host Exceptions Debugger view (`funcHostDebugView`) + host/stopped/error/no-host nodes | **Defer** | Own view in the debug container; follows the F5 loop decision. |  | JC-LOCALDEV |
| FUNC-197 | 3 Tree | Orphan icon `azFuncProxy.svg` | **Drop** | Dead asset. |  |  |
| FUNC-198 | 3 Tree | Tree refresh (file watchers on function.json/local.settings.json, func-task events) | **Migrate** | Needed by the local function tree; use workspace index watchers. |  |  |
| FUNC-199 | 3 Tree | Legacy pickers (`pickAppResource`, workspace pick by CV) | **Reuse** | `IResourceSelector`. |  |  |
| FUNC-200 | 3 Tree | ARG bulk listing + site cache in the resolver | **Reuse** | Target resource listing + WebAppDataProvider enrich. |  |  |
| FUNC-201 | 3 Tree | Submenu `workspaceActions` (create function/project, deploy) | **Drop** | No workspace actions submenu, this was an antipattern. | Override (recommended Adapt). |  |
| FUNC-202 | 3 Tree | `explorer/context` Deploy on a folder | **Adapt** | Follows the deploy decision. |  | JC-DEPLOY |
| FUNC-203 | 4 Debug | Task definition `func` | **Drop** | Host is started in-process by the Functions debug configuration provider; no `tasks.json` task or problem matcher is needed. Known external consumers: Logic Apps Standard, Fabric User Data Functions. | Override (recommended Adapt); reconfirmed after the F5 design review. | JC-LOCALDEV |
| FUNC-204 | 4 Debug | Task provider `FuncTaskProvider` (host start, extensions install, pack) | **Drop** | Host is started in-process by the Functions debug configuration provider; no `tasks.json` task or problem matcher is needed. Known external consumers: Logic Apps Standard, Fabric User Data Functions. | Override (recommended Adapt); reconfirmed after the F5 design review. | JC-LOCALDEV |
| FUNC-205 | 4 Debug | Problem matcher `func-watch` | **Drop** | Host is started in-process by the Functions debug configuration provider; no `tasks.json` task or problem matcher is needed. | Override (recommended Adapt); reconfirmed after the F5 design review. | JC-LOCALDEV |
| FUNC-206 | 4 Debug | Problem matchers per language (dotnet, java, node, python, golang, powershell watch) | **Drop** | Host is started in-process by the Functions debug configuration provider; no `tasks.json` task or problem matcher is needed. | Can we reuse existing problem matchers from other extensions? I hope we don't have our own defined? Override (recommended Adapt); reconfirmed after the F5 design review. | JC-LOCALDEV |
| FUNC-207 | 4 Debug | Problem pattern `func` | **Drop** | Host is started in-process by the Functions debug configuration provider; no `tasks.json` task or problem matcher is needed. | Override (recommended Adapt); reconfirmed after the F5 design review. | JC-LOCALDEV |
| FUNC-208 | 5 Wizards | Template Gallery webview panel (preview) | **Defer** | Visual gallery remains later work; gallery-backed project creation delegates to CLI v5 `func quickstart` under FUNC-026. | Override (recommended Drop); confirmed CLI ownership. | JC-SCAFFOLD |
| FUNC-209 | 5 Wizards | Open from portal (URI handler, `onUri`) | **Drop** | Experimental, gated off, no usage in window. |  |  |
| FUNC-210 | 4 Debug | Node debug provider (attach 9229) | **Adapt** | F5 for JS/TS. |  | JC-LOCALDEV |
| FUNC-211 | 4 Debug | Python debug provider (`python` + `debugpy`, 9091) | **Adapt** | F5 for Python. |  | JC-LOCALDEV |
| FUNC-212 | 4 Debug | Java debug provider (5005) | **Adapt** | F5 for Java. |  | JC-LOCALDEV |
| FUNC-213 | 4 Debug | Ballerina debug provider | **Drop** | Ballerina dropped. |  | JC-LANG |
| FUNC-214 | 4 Debug | PowerShell debug provider (pipe) | **Adapt** | F5 for PowerShell. |  | JC-LOCALDEV |
| FUNC-215 | 4 Debug | Pre-debug validation (Core Tools, worker runtime, emulator and connection checks) | **Adapt** | Keep a small subset: Core Tools present, `FUNCTIONS_WORKER_RUNTIME`, `AzureWebJobsStorage` / Azurite. |  | JC-LOCALDEV |
| FUNC-216 | 4 Debug | Func host task tracking (port, terminal error capture, start/stop events) | **Adapt** | Needed for local execute/listing and pickProcess. |  | JC-LOCALDEV |
| FUNC-217 | 4 Debug | Core Tools lifecycle (detect, brew/npm install, signature check) | **Reuse** | ToolService / FuncInstaller. |  |  |
| FUNC-218 | 5 Wizards | Language: JavaScript (Node v4 model) | **Adapt** | Keep; verified CLI v5 Node workload owns scaffolding. |  | JC-SCAFFOLD |
| FUNC-219 | 5 Wizards | Language: TypeScript (Node v4 model) | **Adapt** | Keep; verified CLI v5 Node workload owns scaffolding. |  | JC-SCAFFOLD |
| FUNC-220 | 5 Wizards | Language: Python (v2 model) + interpreter pick + venv create | **Adapt** | CLI v5 owns scaffolding; reuse Python extension environment APIs where the CLI leaves environment selection/creation to the editor. |  | JC-SCAFFOLD |
| FUNC-221 | 5 Wizards | Language: C# .NET isolated | **Adapt** | Keep; verified CLI v5 .NET workload owns isolated-project scaffolding. |  | JC-SCAFFOLD |
| FUNC-222 | 5 Wizards | Language: C# .NET in-process | **Drop** | In-process model is retiring; isolated only. |  | JC-LANG |
| FUNC-223 | 5 Wizards | Language: Java (Maven; Gradle preview) | **Adapt** | CLI v5 Java workload owns project creation, subject to packaged-capability verification; Java add-function remains deferred. | Confirmed reviewer decision. | JC-SCAFFOLD |
| FUNC-224 | 5 Wizards | Language: PowerShell | **Adapt** | Keep; delegate scaffolding to a verified CLI v5 workload. Missing packaged support requires a scope decision. |  | JC-SCAFFOLD |
| FUNC-225 | 5 Wizards | Language: Custom Handler | **Adapt** | Keep; delegate scaffolding to verified CLI v5 capability. Missing packaged support requires a scope decision. |  | JC-SCAFFOLD |
| FUNC-226 | 5 Wizards | Language: Go (preview) | **Defer** | Go scaffolding awaits a separate scope decision and native-worker integration verification. | Confirmed reviewer decision. | JC-LANG |
| FUNC-227 | 5 Wizards | Language: Ballerina (hidden) | **Drop** | Hidden behind a setting. |  | JC-LANG |
| FUNC-228 | 5 Wizards | Language: Self-hosted MCP server | **Defer** | MCP scope decision. |  | JC-AGENT |
| FUNC-229 | 5 Wizards | Languages via settings/API only: C# script, F#, F# script | **Drop** | Not reachable from UI. |  | JC-LANG |
| FUNC-230 | 5 Wizards | Legacy programming models (Node v3, Python v1) | **Drop** | Latest models only. |  | JC-LANG |
| FUNC-231 | 5 Wizards | Runtime versions ~1/~2/~3 and v1-only behavior | **Drop** | Out of scope: v4 only. |  |  |
| FUNC-232 | 5 Wizards | Source template subsystem (CentralTemplateProvider, feeds, backup templates) | **Drop** | CLI v5 owns catalogs and template generation. |  | JC-SCAFFOLD |
| FUNC-233 | 5 Wizards | HTTP triggers from OpenAPI spec (autorest) | **Drop** | Preview, niche, external tool. |  |  |
| FUNC-234 | 5 Wizards | Durable storage type prompt + durable project configure | **Defer** | Follows DTS/durable decisions. |  | JC-DTS |
| FUNC-235 | 5 Wizards | Per-template setting prompts + local app setting pick/create | **Adapt** | CLI v5 owns template-specific requirements and validation; thin integration only, no extension-owned form engine or connection wizard. Java add-function remains deferred. | Confirmed reviewer decision. | JC-SCAFFOLD |
| FUNC-236 | 5 Wizards | Post-function-create (open file, extension bundle/extensions.csproj, host config) | **Adapt** | Open created files and refresh the workspace; CLI v5 owns dependencies and generated project configuration. Java add-function remains deferred. | Confirmed reviewer decision. | JC-SCAFFOLD |
| FUNC-237 | 5 Wizards | Connection family: Durable Task Scheduler | **Defer** | DTS as a unit. |  | JC-DTS |
| FUNC-238 | 5 Wizards | Connection family: Netherite (Event Hubs) | **Drop** | Niche durable backend; DTS is the recommended backend. |  | JC-DTS |
| FUNC-239 | 5 Wizards | Connection family: SQL durable backend | **Drop** | Niche durable backend. |  | JC-DTS |
| FUNC-240 | 5 Wizards | Resource-backed binding settings (Cosmos DB, Event Hubs, Service Bus) | **Defer** | Follows the createFunction scope. |  | JC-SCAFFOLD |
| FUNC-241 | 5 Wizards | Create app: Flex Consumption plan | **Reuse** | Already satisfied: `functionApp/main.bicep` defaults `appServicePlanSkuName` to FC1. |  |  |
| FUNC-242 | 5 Wizards | Create app: Premium and App Service plans | **Drop** | "Drop" in the sense that we will always assume flex consumption--users can change plans if they want to in the Bicep. | Override (recommended Reuse). |  |
| FUNC-243 | 5 Wizards | Create app: legacy Consumption (Y1) plan | **Drop** | Legacy plan; Flex replaces it. |  |  |
| FUNC-244 | 5 Wizards | Create app: custom location (Azure Arc / Kubernetes) | **Drop** | Advanced-only, niche. |  |  |
| FUNC-245 | 5 Wizards | Create app: pick existing RG / plan / storage / App Insights | **Drop** | Advanced-only; azd provisions a fresh environment. |  |  |
| FUNC-246 | 5 Wizards | Create app: authentication (secrets vs managed identity for storage) | **Adapt** | Default to managed identity in the Bicep module; no prompt. | MI only, no more secrets ever period full stop. |  |
| FUNC-247 | 5 Wizards | Create app: stack filtered by detected project language | **Adapt** | Detect the runtime from the workspace to skip PickRuntimeStep when possible. |  |  |
| FUNC-248 | 5 Wizards | Create app: Flex max instance count / instance memory | **Adapt** | Bicep parameters with defaults, no prompt. |  |  |
| FUNC-249 | 5 Wizards | Create app: provisioning topology (RG, storage, App Insights, Log Analytics, plan, UAMI, role, site) | **Adapt** | Published AVM function-app pattern module (`br/public:avm/ptn/app/function-app:0.1.0`). |  |  |
| FUNC-250 | 5 Wizards | Create app: containerized (ACA-hosted) function app | **Defer** | Containerized hosting as a unit. |  | JC-CONTAINER |
| FUNC-251 | 5 Wizards | Deploy: guards and warnings (stopped app, emulator connections, EOL, bundle, Event Grid on Flex) | **Drop** | Source zip-deploy guards; azd deploy has its own validation. |  | JC-DEPLOY |
| FUNC-252 | 5 Wizards | Deploy: worker runtime / extension version mismatch fixups | **Drop** | Bicep sets app settings. |  | JC-DEPLOY |
| FUNC-253 | 5 Wizards | Deploy: custom handler on Flex via `func azure functionapp publish` | **Drop** | AZD will handle deploy. | Override (recommended Defer). | JC-DEPLOY |
| FUNC-254 | 5 Wizards | Deploy: add remote MCP server to `.vscode/mcp.json` | **Defer** | MCP scope decision. |  | JC-AGENT |
| FUNC-255 | 5 Wizards | Deploy: completion notification (output, stream logs, upload settings, MCP) | **Adapt** | ShowEndpointUrlStep + Activity view. Fixes the source eventVersion bug. | Use activity log. | JC-DEPLOY |
| FUNC-256 | 5 Wizards | Deploy: list HTTP trigger URLs after deploy | **Adapt** | Fold into ShowEndpointUrlStep. |  | JC-DEPLOY |
| FUNC-257 | 5 Wizards | Deploy: 64-bit alignment and Netherite config update | **Drop** | Source deploy fixups. |  | JC-DEPLOY |
| FUNC-258 | 5 Wizards | Delete containerized function app step | **Reuse** | Reuse deletion we have already (assuming we keep containerized fn apps). | Override (recommended Defer). | JC-CONTAINER |
| FUNC-259 | 5 Wizards | executeFunction Event Grid sample-file flow | **Drop** | Pairs with the dropped Event Grid mock request. |  |  |
| FUNC-260 | 6 Config files | Static-content virtual document provider (`onFileSystem` activation) | **Drop** | Backs template markdown previews that are not migrated. |  |  |
| FUNC-261 | 6 Config files | CodeLens "Save and execute..." on `*.eventgrid.json` | **Drop** | Pairs with the dropped Event Grid mock request. |  |  |
| FUNC-262 | 7 Integrations | Web Apps SDK surface (functions, keys, start/stop/restart, settings) | **Migrate** | Extend the azutils WebAppClient wrapper. |  |  |
| FUNC-263 | 7 Integrations | Functions host admin APIs (`/admin/functions`, host status, keys) | **Migrate** | Needed by execute, listing and pickProcess. |  |  |
| FUNC-264 | 7 Integrations | DTS REST client (`Microsoft.DurableTask`) | **Defer** | DTS as a unit. |  | JC-DTS |
| FUNC-265 | 7 Integrations | Event Hubs / Service Bus / Cosmos DB / SQL SDKs | **Defer** | Follow the connection families. |  | JC-SCAFFOLD |
| FUNC-266 | 7 Integrations | Flex deployment blob container creation (`@azure/storage-blob`) | **Drop** | Handled by Bicep/AVM. |  |  |
| FUNC-267 | 7 Integrations | Azurite extension integration (`azurite.start_*`) | **Defer** | Follows the storage emulator decision; target has an Azurite placeholder in the Emulators group. |  | JC-LOCALDEV |
| FUNC-268 | 7 Integrations | Python extension `getRemoteLauncherCommand` | **Adapt** | Follows the Python debug provider. |  | JC-LOCALDEV |
| FUNC-269 | 7 Integrations | Process picking (`ps-tree`, windows-process-tree) | **Adapt** | Follows pickProcess; use the shared process service. |  | JC-LOCALDEV |
| FUNC-270 | 5 Wizards | Deploy: durable / storage connection prompts on the remote app | **Defer** | Bicep provisions storage; durable backends follow DTS. |  | JC-DTS |
| FUNC-271 | 3 Tree | Host `azureResourceGroups.refresh` reused on Function App child nodes | **Reuse** | `vscode-azure/resources/refresh`. |  |  |
