# Azure Functions -- Parity Report

Phase 6 verification against the signed [TRIAGE.md](TRIAGE.md) and source
[INVENTORY.md](INVENTORY.md). This is an implementation/wiring audit, not a
certificate of live debugger or Azure service behavior.

| | |
|---|---|
| Source | `microsoft/vscode-azurefunctions` at `801689c66f96b31bc9d7c79ff6cc8d65e41b6965` (v1.22.1) |
| Implementation verified | Source and tests committed alongside this report; prior audit baseline `72ebf165d8ae534d94a2c7529fdc42bd67707e31` |
| Target base | `25585e883e234fdba29824c701e1fb33da5e5b1a` |
| Verified | 2026-10-28 |
| Inventory coverage | 271 unique IDs; no missing or duplicate outcomes |
| Overall result | Active scope implemented and code conformance checks satisfied; conditional containerized integration, live verification, and retirement communication remain |

## Summary

| Signed disposition | IDs | Verified outcome |
|---|---:|---|
| Migrate | 24 | Implemented and wired; HTTP invocation, read-only deletion gating, and clickable project hints have behavioral coverage |
| Adapt | 21 | Implemented with the recorded target UX; live checks remain separate |
| Reuse | 19 | 18 wired; FUNC-258 has the generic delete capability but its product integration is conditional on deferred containerized Functions |
| Drop | 143 | No corresponding source-specific public surface; scoped absence evidence below |
| Defer | 64 | Each appears exactly once in the plan's Deferred section |
| **Total** | **271** | **All accounted for; not all release verification is complete** |

No disposition is changed by this report. The open items are tracked under
[Verification follow-ups](MIGRATION-PLAN.md#verification-follow-ups).

## Artifact and catalog checks

| Check | Result |
|---|---|
| Inventory tracked, source pinned, telemetry redacted | Passed. Only qualitative usage statements and query text/links; no raw telemetry result tables |
| Signed triage tracked | Passed. Original sign-off and subsequent reviewer decisions are recorded |
| Plan tracked; implementation and follow-up tasks cite IDs | Passed |
| Artifacts committed before feature code | Passed. All three are in `47de2cb4` ([#351](https://github.com/microsoft/vscode-azure/pull/351)), an ancestor of the first implementation commit `03a19a5c` |
| Literal first commit of this PR contains the artifacts | Not applicable: the prerequisite artifacts were already committed separately on the base branch, not introduced by this PR |
| Stable catalog preserved | All 271 `(ID, inventory section, feature label)` tuples equal the original committed triage catalog |
| Inventory reconciled | Extension contracts; 81 commands plus the walkthrough; contributed/foreign settings; tree states; debug/task contracts; wizard/language/connection families; integrations and orphan assets map to the catalog |
| Drop/Defer partitions | Exact set equality with the corresponding plan sections: 143/64 IDs, each once, with no kept IDs in either partition |
| Main drift recorded | Plan identifies each main merge and the current shared-primitive re-sweep; retrospective evidence is distinguished from contemporaneous records |
| Scratch-only process deliverables | None. Inventory, decisions, plan, and this report are repository artifacts |

The inventory is not itself ID-keyed. Preserving the original catalog's IDs
alone is therefore not the inventory check: the source's command, settings,
tree, debugging, wizard, integration, and orphan sections were also read and
reconciled. Related implementation subfeatures share IDs where the signed
granularity groups them.

## Evidence conventions

Code paths are relative to `extensions/vscode-azure/src/`. `ext:` means relative
to `extensions/vscode-azure/`; `packages/` paths are repository-relative.
Kept rows name the implementation or shared consumer; registration is in
`products/registerFunctions.ts`, `products/registerGenericAzure.ts`,
`products/registerSettings.ts`, and `commands/registerCommands.ts`.

Drop evidence codes below name the audited boundary, not a claim that the
capability is absent from every unrelated product:

| Code | Boundary inspected and result |
|---|---|
| D1 | `ext:package.json`, `extension.ts`, `products/registerFunctions.ts`: no source extension dependency, Azure Resources branch contract, exported Functions API, separate output/diagnostic/experimentation service, or global error-handler override |
| D2 | `ext:package.json`, `products/registerFunctions.ts`, `commands/functions/`, `functions/`: no standalone initialization, source authoring/binding/encryption/storage wizard, walkthrough, Event Grid sample/CodeLens, source template subsystem, or static-content provider |
| D3 | `ext:package.json` configuration and `functions/`, `commands/functions/`, `tree/resources/webApp/`: no source settings or reads of the retiring extensions' settings/state; no replacement project/deployment VS Code configuration |
| D4 | `products/registerFunctions.ts`, `commands/functions/CreateFunctionApp.ts`, remote providers: no Functions-specific deploy, zip/publish, Kudu files/logs/deployments, deployment-source controls, source post-deploy fixups, or HTTP-route listing step |
| D5 | `ext:package.json`, `FunctionsDebugProvider.register`, `functions/host/`: no source task definition/provider, problem matcher/pattern, process-pick command, remote debugger, or Ballerina adapter. Owned custom tasks are internal execution, not a contributed task contract |
| D6 | `CreateFunctionApp.ts`, `steps/PickRuntimeStep.ts`, `resources/templates/functionApp/main.bicep`: one create-only Flex flow; no advanced/existing-resource/location/plan/authentication wizard or direct blob-container SDK operation |
| D7 | Remote/local data and view providers, `WorkspaceNode.ts`: no source slot wrapper, local settings/identity-conversion/init subtree, Kudu subtree, workspace-actions submenu, or proxy SVG |
| D8 | Manifest and Functions registration/production source: no agent metadata/agent commands, MCP project setting, portal URI handler, or source language/template/backend implementation |

Deferred evidence codes refer to the exact unchecked task in the plan's
[Deferred section](MIGRATION-PLAN.md#deferred----tracked-not-built):

| Code | Tracked task |
|---|---|
| F1 | Project/function scaffolding and quickstarts; [#364](https://github.com/microsoft/vscode-azure/issues/364) |
| F2 | Deployment slots |
| F3 | Durable Task Scheduler and durable backends |
| F4 | User-assigned identity management |
| F5 | Containerized Function Apps |
| F6 | MCP projects and deployed integration; [#361](https://github.com/microsoft/vscode-azure/issues/361) |
| F7 | Host exceptions debugger view |
| F8 | Revisit Azure Functions CLI v5 host/emulator/timeout options |
| F9 | Storage emulator configuration and integration |
| F10 | Go scaffolding [#364](https://github.com/microsoft/vscode-azure/issues/364); native provisioning blocker [#366](https://github.com/microsoft/vscode-azure/issues/366) |
| F11 | Gallery/binding tooling and SDKs; [#365](https://github.com/microsoft/vscode-azure/issues/365) |

All four linked deferral issues were confirmed open. A plan task, rather than a
separate issue, is the tracking surface for the other deferred families.

## ID-by-ID coverage

### Extension contracts and commands

| ID | Feature | Signed disposition | Outcome | Evidence |
|---|---|---|---|---|
| FUNC-001 | Azure Resources dependency | Drop | Absent | D1 |
| FUNC-002 | Project detection/activation | Reuse | Wired through shared index | `functions/functionsDetector.ts`; `utils/workspaceIndex/WorkspaceIndexService.ts` |
| FUNC-003 | Source workspace-view activation | Drop | Absent | D1 |
| FUNC-004 | Virtual/local workspace gates | Migrate | Wired | `FunctionsProjectSelector.assertLocal`; `LocalFunctionTarget`; manifest local-menu gates |
| FUNC-005 | Azure Resources branches/activation | Drop | Absent | D1 |
| FUNC-006 | Host create-resource entries | Drop | Absent | D1; target create command is FUNC-057 |
| FUNC-007 | Agent metadata | Drop | Absent | D8 |
| FUNC-008 | `function.json` schema | Migrate | Contributed | `ext:package.json` `jsonValidation` |
| FUNC-009 | `host.json` schema | Migrate | Contributed | `ext:package.json` `jsonValidation` |
| FUNC-010 | API revealTreeItem | Drop | Absent | D1; internal shared navigation is not an exported Functions API |
| FUNC-011 | API createFunction | Drop | Absent | D1 |
| FUNC-012 | API downloadAppSettings | Drop | Absent | D1 |
| FUNC-013 | API uploadAppSettings | Drop | Absent | D1 |
| FUNC-014 | API listLocalProjects | Drop | Absent | D1; internal index reuse is FUNC-002 |
| FUNC-015 | API listLocalFunctions | Drop | Absent | D1; internal tree listing is FUNC-185 |
| FUNC-016 | API isFuncCoreToolsInstalled | Drop | Absent | D1; internal tool acquisition is FUNC-217 |
| FUNC-017 | API startFuncProcess | Drop | Absent | D1; internal owned host is FUNC-216 |
| FUNC-018 | Test-only exported API | Drop | Absent | D1 |
| FUNC-019 | Retiring Container Apps extension API | Drop | Absent | D1 |
| FUNC-020 | Reload-deferred post-create work | Drop | Absent | D2 |
| FUNC-021 | Core Tools warnings/checks | Reuse | On-demand shared checks | `tools/ToolService.ts`; `tools/FuncInstaller.ts`; `FunctionsDebugPreparation.executable` |
| FUNC-022 | Activation-time config fixing | Drop | Absent | D2 |
| FUNC-023 | Separate output/diagnostics | Drop | Absent | D1; shared output is used |
| FUNC-024 | Global Report Issue suppression | Drop | Absent | D1; per-error framework behavior remains |
| FUNC-025 | Experimentation | Drop | Absent | D1 |
| FUNC-026 | Create project | Defer | Tracked | F1 |
| FUNC-027 | Create containerized project | Defer | Tracked | F5 |
| FUNC-028 | Create function | Defer | Tracked | F1 |
| FUNC-029 | Add binding | Drop | Absent | D2 |
| FUNC-030 | Existing-project debug setup | Adapt | F5 runtime selection and persistence | `functions/debug/FunctionsDebugPreparation.ts`; `LocalFunctionSettings.setWorkerRuntime` |
| FUNC-031 | Install/update Core Tools | Reuse | Wired | `vscode-azure/installFunc` -> `AcquireTool`; shared `FuncInstaller` |
| FUNC-032 | Uninstall Core Tools | Drop | Absent | D2 |
| FUNC-033 | .NET worker process selection | Adapt | Owned worker PID, no picker | `host/workerProcessId.ts` under `functions/`; `FunctionsDebugProvider` coreclr attach; attached in reviewer testing on Windows |
| FUNC-034 | Encrypt local settings | Drop | Absent | D2 |
| FUNC-035 | Decrypt local settings | Drop | Absent | D2; encrypted files produce actionable guidance |
| FUNC-036 | Set storage connection wizard | Drop | Absent | D2; validation does not create connections |
| FUNC-037 | Convert local identity connections | Drop | Absent | D2 |
| FUNC-038 | Event Grid mock request | Drop | Absent | D2 |
| FUNC-039 | Open walkthrough | Drop | Absent | D2 |
| FUNC-040 | Hidden walkthrough | Drop | Absent | D2 |
| FUNC-041 | Execute function | Migrate | HTTP POST to actual route; non-HTTP admin submission | `commands/functions/ExecuteFunction.ts`; `FunctionUrlResolver`; `FunctionsHostClient.invokeHttp/invoke` |
| FUNC-042 | Copy function URL | Migrate | Local and remote, fresh metadata | `commands/functions/CopyFunctionUrl.ts`; `functions/FunctionUrlResolver.ts` |
| FUNC-043 | Enable function | Migrate | Local/remote settings edit | `SetFunctionState` registered with `false`; `LocalFunctionSettings`; `WebAppSettingsAdapter` |
| FUNC-044 | Disable function | Migrate | Local/remote settings edit | `SetFunctionState` registered with `true`; same writers |
| FUNC-045 | Delete function | Migrate | Confirmed ARM delete, current editability check | `commands/functions/DeleteFunction.ts`; `isFunctionAppReadOnly`; success-only tree removal |
| FUNC-046 | Deploy to Function App | Drop | Absent | D4; initialized projects use shared azd deployment |
| FUNC-047 | Deploy workspace project | Drop | Absent | D4 |
| FUNC-048 | Deploy to slot | Defer | Tracked | F2 |
| FUNC-049 | Programmatic deploy by app ID | Drop | Absent | D4 |
| FUNC-050 | Redeploy | Drop | Absent | D4 |
| FUNC-051 | Kudu deployment logs | Drop | Absent | D4 |
| FUNC-052 | View deployment commit | Drop | Absent | D4 |
| FUNC-053 | Deployment-node portal action | Drop | Absent | D4; resource portal action is shared |
| FUNC-054 | Configure Kudu deployment source | Drop | Absent | D4 |
| FUNC-055 | Connect GitHub/CI/CD | Reuse | Shared azd pipeline command | `commands/deploy/ConfigureCicd.ts`; `azd/wizard/AzdPipelineConfigStep.ts` |
| FUNC-056 | Disconnect Kudu repository | Drop | Absent | D4 |
| FUNC-057 | Create Function App | Adapt | Create-only azd/Bicep wizard | `commands/functions/CreateFunctionApp.ts`; pinned AVM consumer |
| FUNC-058 | Advanced creation | Drop | Absent | D6 |
| FUNC-059 | Delete Function App | Reuse | Wired | `DeleteAzureResource`; `resourceContextValue` on Function App view |
| FUNC-060 | Start app | Migrate | Shared Web App lifecycle | `commands/webApp/WebAppLifecycle.ts`; registration prefix `start` |
| FUNC-061 | Stop app | Migrate | Shared Web App lifecycle | Same command; registration prefix `stop` |
| FUNC-062 | Restart app | Migrate | Shared Web App lifecycle | Same command; registration prefix `restart` |
| FUNC-063 | Browse website | Reuse | Enriched hostname enables action | `FunctionAppDataProvider`; `resourceContextValue`; `BrowseWebsite` |
| FUNC-064 | View properties | Reuse | Wired on ARM app | `resourceContextValue`; shared `ViewProperties` |
| FUNC-065 | Stream logs | Adapt | Cancellable Insights polling terminal | `FunctionAppLogStream`; `StreamFunctionLogs`; shared `BufferedPseudoterminal` |
| FUNC-066 | Stop-stream command | Drop | Absent | D4; terminal closure owns cancellation |
| FUNC-067 | Remote debugging | Drop | Absent | D5 |
| FUNC-068 | Java remote debugging | Drop | Absent | D5 |
| FUNC-069 | Create slot | Defer | Tracked | F2 |
| FUNC-070 | Delete slot | Defer | Tracked | F2 |
| FUNC-071 | Swap slot | Defer | Tracked | F2 |
| FUNC-072 | Add app setting | Reuse | Shared JSONC settings document | `getSettingsNodes`; `WebAppSettingsAdapter`; `EditSettings` |
| FUNC-073 | Download settings | Drop | Absent | D2; shared editor is not local-settings sync |
| FUNC-074 | Upload settings | Drop | Absent | D2 |
| FUNC-075 | Edit app setting | Reuse | Shared settings document | `WebAppSettingsAdapter`; `SettingsFileSystemProvider` |
| FUNC-076 | Rename app setting | Reuse | Shared settings document | Same adapter's whole-dictionary write; edit key in document |
| FUNC-077 | Delete app setting | Reuse | Shared settings document | Same adapter; omitted keys are deleted |
| FUNC-078 | Slot-setting toggle | Defer | Tracked | F2 |
| FUNC-079 | Reveal setting value in tree | Drop | Absent | D7; values are in the shared editor |
| FUNC-080 | Convert remote identity connections | Drop | Absent | D2 |
| FUNC-081 | Assign managed identity | Defer | Tracked | F4 |
| FUNC-082 | Unassign managed identity | Defer | Tracked | F4 |
| FUNC-083 | Enable system-assigned identity | Drop | Absent | D6/D7; provisioning uses UAMI |
| FUNC-084 | Create DTS scheduler | Defer | Tracked | F3 |
| FUNC-085 | Create DTS task hub | Defer | Tracked | F3 |
| FUNC-086 | Delete DTS scheduler | Defer | Tracked | F3 |
| FUNC-087 | Delete DTS task hub | Defer | Tracked | F3 |
| FUNC-088 | Copy scheduler connection | Defer | Tracked | F3 |
| FUNC-089 | Copy scheduler endpoint | Defer | Tracked | F3 |
| FUNC-090 | Copy emulator connection | Defer | Tracked | F3 |
| FUNC-091 | Open task hub dashboard | Defer | Tracked | F3 |
| FUNC-092 | Start DTS emulator | Defer | Tracked | F3 |
| FUNC-093 | Stop DTS emulator | Defer | Tracked | F3 |
| FUNC-094 | Get DTS emulators | Defer | Tracked | F3 |
| FUNC-095 | Refresh host debug view | Defer | Tracked | F7 |
| FUNC-096 | Clear stopped host sessions | Defer | Tracked | F7 |
| FUNC-097 | Show recent host logs | Defer | Tracked | F7 |
| FUNC-098 | Copy recent host logs | Defer | Tracked | F7 |
| FUNC-099 | Ask Copilot about host | Defer | Tracked | F7 |
| FUNC-100 | Report Issue | Reuse | Framework error action | `packages/utils/src/base/IActionExecutor.ts`; `ExternalError` for user-actionable errors |
| FUNC-101 | Retrieve MCP key | Defer | Tracked | F6 |
| FUNC-102 | Open remote file | Drop | Absent | D4 |
| FUNC-103 | Source output-channel command | Drop | Absent | D1 |
| FUNC-104 | Agent getCommands | Drop | Absent | D8 |
| FUNC-105 | Agent wizard without execution | Drop | Absent | D8 |
| FUNC-106 | Agent wizard with inputs | Drop | Absent | D8 |
| FUNC-107 | Agent benchmark configs | Drop | Absent | D8 |

### Settings

The setting rows describe the source setting contract, not whether an internal
implementation has a fixed timeout or performs validation.

| ID | Feature | Signed disposition | Outcome | Evidence |
|---|---|---|---|---|
| FUNC-108 | DTS emulator registry | Defer | Tracked | F3 |
| FUNC-109 | DTS emulator image | Defer | Tracked | F3 |
| FUNC-110 | DTS emulator tag | Defer | Tracked | F3 |
| FUNC-111 | templateFilter | Drop | Absent | D3 |
| FUNC-112 | projectRuntime | Drop | Absent | D3 |
| FUNC-113 | projectLanguage | Drop | Absent | D3 |
| FUNC-114 | projectLanguageModel | Drop | Absent | D3 |
| FUNC-115 | projectTemplateKey | Drop | Absent | D3 |
| FUNC-116 | deploySubpath | Drop | Absent | D3 |
| FUNC-117 | projectSubpath | Drop | Absent | D3 |
| FUNC-118 | showCoreToolsWarning | Drop | Absent | D3 |
| FUNC-119 | showMultiCoreToolsWarning | Drop | Absent | D3 |
| FUNC-120 | show64BitWarning | Drop | Absent | D3 |
| FUNC-121 | enableRemoteDebugging | Drop | Absent | D3/D5 |
| FUNC-122 | enableJavaRemoteDebugging | Drop | Absent | D3/D5 |
| FUNC-123 | showProjectWarning | Drop | Absent | D3 |
| FUNC-124 | showPythonVenvWarning | Drop | Absent | D3 |
| FUNC-125 | showDeploySubpathWarning | Drop | Absent | D3 |
| FUNC-126 | showTargetFrameworkWarning | Drop | Absent | D3 |
| FUNC-127 | showExtensionsCsprojWarning | Drop | Absent | D3 |
| FUNC-128 | pickProcessTimeout | Drop | Absent | D3; owned-host deadlines are not this setting |
| FUNC-129 | templateVersion | Drop | Absent | D3 |
| FUNC-130 | projectOpenBehavior | Drop | Absent | D3 |
| FUNC-131 | preDeployTask | Drop | Absent | D3; standard debug preLaunchTask is a different contract |
| FUNC-132 | postDeployTask | Drop | Absent | D3 |
| FUNC-133 | pythonVenv | Drop | Absent | D3; Python public environment API is used |
| FUNC-134 | createPythonVenv | Drop | Absent | D3 |
| FUNC-135 | scmDoBuildDuringDeployment | Drop | Absent | D3 |
| FUNC-136 | enableOutputTimestamps | Drop | Absent | D3 |
| FUNC-137 | stopFuncTaskPostDebug toggle | Defer | Tracked; owned hosts always stop | F8 |
| FUNC-138 | showDeployConfirmation | Drop | Absent | D3 |
| FUNC-139 | validateFuncCoreTools toggle | Drop | Absent | D3; mandatory shared acquisition remains |
| FUNC-140 | Delve validation | Adapt | Mandatory native-Go check | `FunctionsDebugPreparation.validateGo`; Go extension tool API |
| FUNC-141 | Go validation | Adapt | Mandatory Go 1.24+ check | Same preparation method; version command uses shared builder |
| FUNC-142 | validateEmulators options | Defer | Tracked; limited checks in FUNC-215 | F8 |
| FUNC-143 | requestTimeout | Drop | Absent | D3 |
| FUNC-144 | hostStartTimeout setting | Defer | Tracked; fixed startup deadlines | F8 |
| FUNC-145 | defaultFunctionAppToDeploy | Drop | Absent | D3 |
| FUNC-146 | suppressProject | Drop | Absent | D3 |
| FUNC-147 | showHiddenStacks | Drop | Absent | D3 |
| FUNC-148 | showDeprecatedStacks | Drop | Absent | D3 |
| FUNC-149 | showReloadTemplates | Drop | Absent | D3 |
| FUNC-150 | enableOpenFromPortal | Drop | Absent | D3/D8 |
| FUNC-151 | javaBuildTool | Drop | Absent | D3; CLI owns Java preparation |
| FUNC-152 | templateSource | Drop | Absent | D3 |
| FUNC-153 | funcCliPath | Drop | Absent | D3; shared ToolService resolves the executable |
| FUNC-154 | endOfLifeWarning | Drop | Absent | D3 |
| FUNC-155 | functionSubpath | Drop | Absent | D3 |
| FUNC-156 | showFlexEventGridWarning | Drop | Absent | D3 |
| FUNC-157 | showMarkdownPreview | Drop | Absent | D3 |
| FUNC-158 | allowProgrammingModelSelection | Drop | Absent | D3/D8; no scaffolding model picker |
| FUNC-159 | showBallerinaProjectCreation | Drop | Absent | D3/D8 |
| FUNC-160 | mcpProjectType | Drop | Absent | D3/D8 |
| FUNC-161 | Template cache expiration | Drop | Absent | D3 |
| FUNC-162 | enableTemplateGallery | Drop | Absent | D3 |
| FUNC-163 | Deprecated zip glob/ignore keys | Drop | Absent | D3 |
| FUNC-164 | Foreign Azurite endpoint/cert settings | Defer | Tracked | F9 |
| FUNC-165 | Foreign resource grouping setting | Drop | Absent | D3; grouping uses the target framework |

### Trees, debug providers, wizards, and integrations

| ID | Feature | Signed disposition | Outcome | Evidence |
|---|---|---|---|---|
| FUNC-166 | Function App node/state/Flex | Migrate | Wired | `tree/resources/webApp/FunctionAppDataProvider.ts`; `FunctionAppViewProvider.ts` |
| FUNC-167 | Slot wrapper context | Drop | Absent | D7 |
| FUNC-168 | Remote Functions group | Migrate | Wired beside settings | `FunctionAppDataProvider.getChildren`; `FunctionAppViewProvider` |
| FUNC-169 | Remote function leaf | Migrate | Wired, trigger/access/state | `FunctionApp.ts`; `FunctionAppViewProvider.virtualTreeItem` |
| FUNC-170 | Invalid remote function | Migrate | Error leaf with refresh | `FunctionAppDataProvider.toFunction`; view invalid branch |
| FUNC-171 | Reveal attached identity | Adapt | Shared resource navigation | `commands/functions/RevealFunctionAppIdentity.ts` -> `RevealResource` |
| FUNC-172 | Identity-management nodes | Defer | Tracked | F4 |
| FUNC-173 | Application Settings tree | Reuse | Shared adapter/node/editor | `FunctionAppDataProvider` -> `getSettingsNodes`; `WebAppSettingsAdapter` |
| FUNC-174 | Remote Files tree | Drop | Absent | D7 |
| FUNC-175 | Logs tree | Drop | Absent | D7; streaming command is FUNC-065 |
| FUNC-176 | Storage connection wizard | Defer | Tracked | F9; current preflight does not create connections |
| FUNC-177 | Kudu Deployments tree | Drop | Absent | D7 |
| FUNC-178 | Slots tree | Defer | Tracked | F2 |
| FUNC-179 | Invalid slot node | Defer | Tracked | F2 |
| FUNC-180 | Invalid Function App | Migrate | Error state and recovery | `FunctionAppDataProvider.readSite`; `FunctionAppViewProvider.appTreeItem` |
| FUNC-181 | Containerized app tree | Defer | Tracked | F5 |
| FUNC-182 | Local project | Migrate | Indexed and wired | `tree/workspace/functions/FunctionsWorkspaceDataProvider.ts`; corresponding view |
| FUNC-183 | Local identity-conversion variant | Drop | Absent | D7 |
| FUNC-184 | Local Functions group | Adapt | Direct project children | `FunctionsProjectReader.functions`; local data/view providers |
| FUNC-185 | Local function leaf | Migrate | Ready-host metadata | `FunctionsProjectReader.functionNode`; `FunctionsWorkspaceViewProvider` |
| FUNC-186 | Invalid local function | Migrate | Error siblings preserved | `FunctionsProjectReader.functions`; local view |
| FUNC-187 | Build/list-update hint | Adapt | No-host debug hint | `FunctionsProjectReader.functions`; only ready-host listing |
| FUNC-188 | Start-debugging hint | Migrate | Click starts the owning project's debugger | `FunctionsWorkspaceViewProvider`; `debug.startFromConfig`; provider launch test with multiple projects |
| FUNC-189 | Local settings tree | Drop | Absent | D7; local settings file still exists |
| FUNC-190 | Initialization tree action | Drop | Absent | D2/D7; runtime choice belongs to F5 |
| FUNC-191 | Invalid local project | Migrate | Visible validation failure | `FunctionsProjectReader.project`; local view |
| FUNC-192 | Empty-workspace creation hint | Defer | Tracked | F1 |
| FUNC-193 | DTS scheduler/task-hub nodes | Defer | Tracked | F3 |
| FUNC-194 | DTS emulator nodes | Defer | Tracked | F3 |
| FUNC-195 | Go debugger/toolchain | Adapt | Native worker/Delve F5 wired; Go stack and worker workloads ensured; Delve stdin redirected on Windows | `FunctionsDebugPreparation`; `FunctionsDebugProvider`; owned host; the host starts in reviewer testing, Delve attach and macOS/Linux unverified |
| FUNC-196 | Host Exceptions Debugger view | Defer | Tracked | F7 |
| FUNC-197 | Orphan proxy icon | Drop | Absent | D7; no new product SVG |
| FUNC-198 | Local tree refresh | Migrate | Index/settings/host events | `functionsDetector`; `FunctionsWorkspaceDataProvider`; `LocalFunctionsHostTracker` |
| FUNC-199 | Resource pickers | Reuse | Shared selector actually consumed | Remote commands inject `IResourceSelector`; local project selector uses shared quick pick/index |
| FUNC-200 | Resource listing/site cache | Reuse | Shared listing/cache plus enrichment | `AzureResourceDataProvider`; `FunctionAppDataProvider`; `DataItemTree` |
| FUNC-201 | Workspace-actions submenu | Drop | Absent | D7 |
| FUNC-202 | Explorer folder deploy action | Drop | Absent | D4 |
| FUNC-203 | Contributed func task definition | Drop | Absent | D5 |
| FUNC-204 | Func task provider | Drop | Absent | D5 |
| FUNC-205 | func-watch matcher | Drop | Absent | D5 |
| FUNC-206 | Per-language matchers | Drop | Absent | D5 |
| FUNC-207 | func problem pattern | Drop | Absent | D5 |
| FUNC-208 | Template Gallery panel | Defer | Tracked | F11 |
| FUNC-209 | Open from portal | Drop | Absent | D8 |
| FUNC-210 | Node debugger | Adapt | Owned pwa-node attach, started as its own session | `FunctionsDebugPreparation.workerOverrides`; `FunctionsDebugProvider`; attached in reviewer testing on Windows |
| FUNC-211 | Python debugger | Adapt | Selected venv/debugpy attach | Same preparation/provider; public Python APIs; attached in reviewer testing on Windows |
| FUNC-212 | Java debugger | Adapt | JDWP attach, CLI-owned build | Same preparation/provider; attached in reviewer testing on Windows (needs Debugger and Language Support for Java) |
| FUNC-213 | Ballerina debugger | Drop | Absent | D5/D8 |
| FUNC-214 | PowerShell debugger | Adapt | Per-session pipe attach | Same preparation/provider; attached in reviewer testing on Windows |
| FUNC-215 | Pre-debug validation | Adapt | Retained subset wired; workloads ensured; emulator left to the CLI's managed Azurite | `FunctionsDebugPreparation.prepare/validateStorage/executable/ensureWorkloads`; selector trust gates |
| FUNC-216 | Owned host lifecycle | Adapt | Tasks, ports, readiness, cleanup; task terminal always stays open | `LocalFunctionsHostProcess`; `OwnedFunctionsHostSession`; `LocalFunctionsHostTracker` |
| FUNC-217 | Core Tools lifecycle | Reuse | Shared v5 acquisition | `ToolService`; `FuncInstaller`; on-demand `FunctionsDebugPreparation.executable` |
| FUNC-218 | JavaScript scaffolding | Defer | Tracked | F1; existing-project debugging is FUNC-210 |
| FUNC-219 | TypeScript scaffolding | Defer | Tracked | F1 |
| FUNC-220 | Python scaffolding/venv creation | Defer | Tracked | F1; selected existing venv is FUNC-211 |
| FUNC-221 | .NET isolated scaffolding | Defer | Tracked | F1 |
| FUNC-222 | .NET in-process creation | Drop | Absent | D8; curated creation picker is isolated-only |
| FUNC-223 | Java scaffolding | Defer | Tracked | F1 |
| FUNC-224 | PowerShell scaffolding | Defer | Tracked | F1 |
| FUNC-225 | Custom-handler scaffolding | Defer | Tracked | F1; native-Go debugging is not custom-handler support |
| FUNC-226 | Go scaffolding | Defer | Tracked | F10 |
| FUNC-227 | Ballerina scaffolding | Drop | Absent | D8 |
| FUNC-228 | Self-hosted MCP creation | Defer | Tracked | F6 |
| FUNC-229 | API-only script/F# creation | Drop | Absent | D8 |
| FUNC-230 | Legacy programming-model creation | Drop | Absent | D8; schema association is separately kept under FUNC-008 |
| FUNC-231 | Runtime v1/v2/v3 behavior | Drop | Absent | D8; local validation accepts runtime v4 |
| FUNC-232 | Source template subsystem | Drop | Absent | D2/D8 |
| FUNC-233 | OpenAPI function generation | Drop | Absent | D2/D8 |
| FUNC-234 | Durable project configuration | Defer | Tracked | F3 |
| FUNC-235 | Template/setting prompts | Defer | Tracked | F1 |
| FUNC-236 | Post-function-create integration | Defer | Tracked | F1 |
| FUNC-237 | DTS connection wizard | Defer | Tracked | F3 |
| FUNC-238 | Netherite connection wizard | Drop | Absent | D8 |
| FUNC-239 | SQL durable connection wizard | Drop | Absent | D8 |
| FUNC-240 | Resource-backed bindings | Defer | Tracked | F11 |
| FUNC-241 | Flex Consumption provisioning | Reuse | Consumer fixes FC1 | `ext:resources/templates/functionApp/main.bicep` |
| FUNC-242 | Premium/App Service plan picker | Drop | Absent | D6; module editability is not a wizard choice |
| FUNC-243 | Legacy Consumption picker | Drop | Absent | D6 |
| FUNC-244 | Custom location picker | Drop | Absent | D6 |
| FUNC-245 | Existing supporting-resource picks | Drop | Absent | D6 |
| FUNC-246 | Storage authentication | Adapt | UAMI/module-managed connections | Pinned AVM pattern in Function App consumer; no auth prompt |
| FUNC-247 | Deploy-time runtime inference | Drop | Absent | D4; create prompts for runtime |
| FUNC-248 | Flex memory/max instances | Adapt | AVM parameters/defaults, no prompt | Compiled pinned module exposes both parameters; consumer uses defaults |
| FUNC-249 | Provisioning topology | Adapt | Pinned AVM pattern | `br/public:avm/ptn/app/function-app:0.1.0`; successful Bicep build |
| FUNC-250 | Containerized app creation | Defer | Tracked | F5 |
| FUNC-251 | Source deploy guards | Drop | Absent | D4 |
| FUNC-252 | Deploy-time runtime fixups | Drop | Absent | D4 |
| FUNC-253 | Custom-handler func publish | Drop | Absent | D4 |
| FUNC-254 | Deploy MCP integration | Defer | Tracked | F6 |
| FUNC-255 | Functions post-deploy notification | Drop | Absent | D4 |
| FUNC-256 | Functions post-deploy URL listing | Drop | Absent | D4 |
| FUNC-257 | Deploy architecture/Netherite fixups | Drop | Absent | D4 |
| FUNC-258 | Containerized app deletion | Reuse | Conditional, not product-certified | Generic `DeleteAzureResource` accepts ARM sites; containerized tree/create remain F5; P6-01 |
| FUNC-259 | Event Grid sample execution | Drop | Absent | D2 |
| FUNC-260 | Static-content provider | Drop | Absent | D2 |
| FUNC-261 | Event Grid CodeLens | Drop | Absent | D2 |
| FUNC-262 | Web Apps client surface | Migrate | Shared client wired | `packages/azutils/src/rest/clients/WebAppClient.ts`; registration and command/provider consumers |
| FUNC-263 | Host admin client | Migrate | Shared client wired | `packages/azutils/src/rest/clients/FunctionsHostClient.ts`; local/remote invoke, listing, readiness |
| FUNC-264 | DTS client | Defer | Tracked | F3 |
| FUNC-265 | Binding-service SDKs | Defer | Tracked | F11 |
| FUNC-266 | Direct deployment blob creation | Drop | Absent | D6; topology module owns it |
| FUNC-267 | Azurite extension startup | Defer | Tracked | F9; reachability checks do not start an emulator |
| FUNC-268 | Python launcher API | Adapt | Public API wired | `FunctionsDebugPreparation.pythonWorkerEnvironment`; selected environment and debugpy package |
| FUNC-269 | Worker process picking | Adapt | Owned-process output/termination | `workerProcessId`; `OwnedFunctionsHostSession`; shared `IProcessExecutor`, not unrelated process enumeration |
| FUNC-270 | Remote connection prompts | Defer | Tracked | F3 |
| FUNC-271 | Resource refresh | Reuse | Shared global refresh | `RefreshResourcesView` contexts on app/group/function/errors; manifest menus |

## Verification boundaries and conformance evidence

| Tracking | Finding / boundary | Consequence |
|---|---|---|
| P6-01 | FUNC-258 is conditional on FUNC-181/FUNC-250. The generic ARM delete command exists, but containerized Functions discovery/presentation and a product deletion scenario are not verified | Do not count this as a fully integrated nineteenth Reuse feature |
| P6-02 | Live Go attach, macOS/Linux F5 and ownership cleanup, storage/emulator integration on a clean machine, real Azure commands/log queries/provisioning remain manual work; Node/TypeScript, Python, Java, PowerShell, and .NET isolated attached in reviewer testing on Windows | Passing mocks/configuration tests and a Bicep build do not certify the remaining paths |
| P6-03 | Satisfied: Functions domain nodes carry URIs, function names, and validation state; `FunctionsWorkspaceViewProvider` derives labels and localized hints | Typed workspace variants preserve the other products' required fields; nested/multi-root rendering and refresh are covered |
| P6-04 | Satisfied: `test/tree/treeMenuMatches.ts` reads the real manifest and compares its independent predicates with rendered nodes; remaining tests exercise behavior | Menu drift can fail the cross-boundary checks without pinning a source constant to itself |
| P6-05 | Satisfied: `LocalFunctionsNetwork` receives `IVsCode` and localizes the reservation-address error | Existing real-loopback integration coverage and build/lint validate the injected service |
| P6-06 | The signed known-consumer list includes external extensions depending on dropped APIs/tasks/settings | Owner notification is required before source retirement; this audit does not claim that communication has occurred |
| P6-07 | Satisfied: HTTP triggers receive raw POST requests on their actual route; deletion checks current deployment state; hints launch their owning project | Reviewer confirmed HTTP-trigger invocation on 2026-10-27. No disposition changes |
| P6-08 | Satisfied: manual F5 testing found and fixed host/debugger startup, attach, activation, terminal, workload, and Delve issues (see the plan's P6-08) | Fixes are covered by behavioral tests where they can regress; no disposition changes |
| P6-09 | Open: language-prerequisite setup ([#391](https://github.com/microsoft/vscode-azure/issues/391)), a debug-toolbar Execute Function button ([#392](https://github.com/microsoft/vscode-azure/issues/392)), and the upstream `func setup` workload gap ([Azure/azure-functions-core-tools#5777](https://github.com/Azure/azure-functions-core-tools/issues/5777)) | Not implemented; the extension works around the workload gap in `ensureWorkloads` |

P6-07 contracts:

- FUNC-041 posts HTTP input as UTF-8 bytes to the validated current route.
  Function keys travel in a header; master-key use requires confirmation;
  redirects and other origins are rejected. Non-HTTP admin invocation reports
  acceptance, while an HTTP success reports request completion.
- FUNC-045 exposes deletion only when editability is known. Current settings
  are checked after confirmation, before activity/deletion. Package-backed
  and Flex deployments are read-only; settings-read failures block the delete
  without hiding otherwise readable functions.
- FUNC-188 uses VS Code's built-in `debug.startFromConfig` command with an
  explicit project path, independently of the selected debug configuration.
  The provider test consumes the hint's configuration and starts the intended
  nested project in a multi-project workspace.

These contracts retain the signed dispositions. Deferred
toggles/options do not imply that mandatory host cleanup or the approved minimal
Azurite reachability checks are absent.

## Conformance and wiring

| Area | Result and evidence |
|---|---|
| Tree ownership/dispatch | Functions data/view providers precede Web App fallbacks in `registerFunctions`; products precede generic providers in `registerProducts`; local providers are in `registerTrees` |
| Menus and state | All retained product command menus use case-insensitive word-boundary regexes. Local menu entries independently require trust and non-virtual workspaces. Running/stopped, disabled, HTTP, identity, error, and deployment-editability branches match manifest predicates |
| Invalid nodes | Remote app/function/listing and local project/function failures remain visible; invalid nodes offer refresh, not destructive/resource capabilities |
| Icons | Existing `packages/azutils/resources/azureIcons/microsoft.web/sites~functionapp.svg` matches the logical type; virtual nodes use ThemeIcons; no SVG is added |
| Data/view separation | Views do not fetch/mutate the data model. The Functions view derives relative labels, error presentation, and localized clickable hints from domain nodes |
| DI/commands | Managed commands and shared client-provider wiring are present; action/bool prefix arguments match registrations. CreateFunctionApp fixes `job: 'createNew'` internally because there is only one supported job, not an unused job prefix |
| Local settings | Shared JSONC parsing/editing, case-insensitive values, queued writes, dirty/encrypted/malformed rejection; only runtime selection and disable flags are written |
| Ownership boundaries | No Functions code authors/parses azd files or generates project scaffolding/debug/recommendation files. Creation uses shared azd steps. No source extension commands/dependency/settings/API shim |
| Activation budget | Two type-scoped debug events only, `onDebugResolve:azure-functions` and `onDebugDynamicConfigurations:azure-functions` (human decision during manual testing; F5 was otherwise ignored until another contribution activated the extension). No unbounded workspaceContains glob, startup CLI/auth check, or product prompt; host/tool work is on demand |
| Imports/source hygiene | All 34 added/modified production TypeScript files in the remaining PR diff have headers and ASCII source; extension code has no runtime vscode import, direct Azure SDK import, or Node filesystem import. Type checking and lint pass |
| Errors/logs | Product failures use shared handling and localized operation-level diagnostics; local settings/payloads/keys/log rows are not deliberately copied to the output channel. Host output and selected Insights rows belong in their user-visible terminals |
| Public surface/cancellation | Provider/debug hooks and shared services have external callers; no test-only visibility widening found. User cancellation uses CancellationError; process ownership is limited to launched trees |
| Tests | Root labels and shared fixtures used for Functions suites; behavioral coverage includes metadata, settings, raw HTTP requests, URL/key policy, editability, project-hint launches, readiness, ownership, cancellation, and polling. Menu checks read both the manifest and rendered nodes |
| Docs | Product documentation is in `docs/products/functions.md`; framework edits update existing provider/creation examples rather than add a product section |

### Shared-primitive re-sweep

The current sweep covered `packages/utils/src`, `packages/azutils/src`,
`extensions/vscode-azure/src`, and both `test/testing.ts` barrels.
The slice mapping records and the following refinements cover the current helpers:

| Product concept | Reused shared surface / justified product logic |
|---|---|
| CLI creation/output/cleanup | Reused `command`, `IProcessExecutor`, streamed generators and tree cancellation. All four direct Functions spawn sites use the builder. `quoteWorkerArgument` serializes a worker-owned environment string, not an argv/shell command |
| Host sessions/ports/PIDs | Searched host ownership, port reservation/probing, and worker PID parsing: no shared equivalent. Functions host status, worker PID events, lifecycle registry, and bounded network helper remain product contracts |
| File/index/project selection | Reused `IWorkspaceIndexService`, `WorkspaceDetector`, URI/path helpers, quick picks, `readRequiredJson`, `readText`, and `isFileNotFoundError`. Product selector preserves filesystem errors that `fileExists` intentionally suppresses |
| JSONC/local settings | Reused `JsoncSettingsFormat`, `parseJsoncObject`, `editJsonc`, and caseless readers. Product writer adds only per-file sequencing and Functions keys; no duplicate JSON parser |
| Function metadata/debug options | Reused Zod; one product metadata parser is consumed by both local and remote readers/URL policy. Worker PID and launch schemas remain product-specific |
| HTTP clients and paging | Reused shared REST factories, `assertRestSuccess`, client-provider registration, `toPages`, and `mapPages`; host/log clients are in azutils |
| Remote operations/navigation/settings | Reused `IResourceSelector`, `resourceContextValue`, `RevealResource`, generic deletion/browse/properties/refresh, `WebAppLifecycle`, settings adapter/document, and activity tracking |
| Streaming | Reused ACA's shared `BufferedPseudoterminal` and cancellable `delay`; query cursor/deduplication/discovery are Insights-specific, not a finite long-running operation |
| Creation | Reused shared azd hydration/selection/generation/environment/provision steps and existing runtime/version prompts; no hosting/auth/scale wizard duplication |
| Test fixtures | Reused mock VS Code/code context, real test action executor, Azure entity/client/tree factories, MockHttpClient, MockTerminal, process mocks, timers, async collections, and prompt drivers; product fixtures compose these |
| Menu compatibility tests | Searched manifest/menu predicate helpers: none exists. Shared `test/tree/treeMenuMatches.ts` compares independent manifest predicates against rendered nodes for both Functions trees; no new manifest inventory or DI-registration test |

### Provisioning and external facts

The Function App consumer built successfully and resolved
`br/public:avm/ptn/app/function-app:0.1.0`. The AVM repository paths inspected are
[`avm/ptn/app/function-app`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/ptn/app/function-app)
and [`avm/res/web/site`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/web/site).
The resource candidate is only a site; the required storage, plan, monitoring,
identity, and role topology requires the selected pattern.

The consumer maps environment name, region, runtime/version and service tag to
the pattern, fixes FC1, and uses the pattern's identity and scale defaults.
The compiled pinned module exposes memory and maximum-instance parameters;
the consumer does not add wizard prompts or top-level passthrough parameters.
Native Go is not in that pinned module's allowed runtime values, consistent
with [#366](https://github.com/microsoft/vscode-azure/issues/366).
This proves template compilation/module resolution, not Azure deployment.

External contracts were checked against linked sources rather than inferred
from current package names:

- The pinned [v5 run command](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Func/Commands/Start/StartCommand.cs)
  supplies `run`, `--port`, `--no-build`, `--no-azurite` (user-supplied only), and output modes.
  `>=5.0.0-preview.3` is the approved supported v5 floor, not a claim that every
  debugger capability first appeared in that release.
- The pinned [.NET output interceptor](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/DotNet/DotNetHostOutputInterceptor.cs)
  confirms worker-PID startup payloads and tooling-category messages.
- The pinned [Go project](https://github.com/Azure/azure-functions-core-tools/blob/f8f54ba328758b2165d835930e391af23e60f090/src/Workloads/Stacks/Go/GoFunctionsProject.cs)
  confirms native worker identity, Go 1.24 minimum, `bin/app[.exe]`, and
  `--no-build` behavior. Delve and Python API sources are linked beside their
  contracts in the [product doc](../../products/functions.md#f5-debugging).
- Both [function schema](https://json.schemastore.org/function.json) and
  [host schema](https://json.schemastore.org/host.json) URLs resolve to JSON.
- [Flex package deployments](https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan#deployment)
  and the source's
  [deployment editability check](https://github.com/microsoft/vscode-azurefunctions/blob/801689c66f96b31bc9d7c79ff6cc8d65e41b6965/src/tree/ResolvedFunctionAppResource.ts)
  support the read-only classification. VS Code's
  [debug command implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugCommands.ts)
  defines `debug.startFromConfig`.
- Host invocation/readiness/metadata, Azure Monitor requests/partial errors,
  disable flags, and local-settings contracts are linked in the slice mapping
  records and azutils client documentation. Service-side behavior remains
  subject to P6-02; source inspection is not a live-service test.

## Build gates

Run on 2026-10-28 against the source/tests committed with this report:

| Exact command | Result |
|---|---|
| `pnpm run lint` | Passed, exit 0, all three workspaces |
| `pnpm run build` | Passed, exit 0, all three workspaces |
| `pnpm run test` | Passed, exit 0: utils 678 passing/12 pending; azutils 477 passing; extension 1,530 passing/3 pending |
| `bicep build extensions\vscode-azure\resources\templates\functionApp\main.bicep --stdout` | Passed at the prior audit baseline, exit 0; pinned pattern resolved. Not repeated because the Bicep consumer/module inputs are unchanged |
| ID/partition/contribution checks | Passed at the prior audit baseline: complete unique catalog; exact Drop/Defer sets; command registrations, menu gates, NLS keys, schema associations, and icon path. Not repeated for the manual-testing fixes, which add two activation events and no commands, menus, or catalog entries |

Total automated tests: **2,685 passing, 15 pending**. Pending tests were not run.
No install was needed and no dependencies changed.
Raw build/test logs remain session artifacts, not repository files.

The [manual checklist](https://github.com/microsoft/vscode-azure/pull/367#issuecomment-6444069751)
is the existing live-verification surface and is maintained by the reviewer; no manual scenario
is marked complete by the automated gates.
