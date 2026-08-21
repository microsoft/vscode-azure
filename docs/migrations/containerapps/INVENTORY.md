# Azure Container Apps — Feature Inventory

Source: `microsoft/vscode-azurecontainerapps` @ `main` (`f6c93dcd1a55b6aaf27ed4edca8f6a52b5348e16`, 2026-08-10), v0.11.2, publisher `ms-azuretools`, extension id `ms-azuretools.vscode-azurecontainerapps`.
Method: reconcile `package.json` + `package.nls.json` + code (`activate()` / `registerCommands.ts` / `src/**`) + published docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: collected from `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt` (window: 90d; collected 2026-08-21; 66 emitted event names). Per the repo's telemetry policy the **raw counts are not committed** — this file carries a qualitative band plus an advisory suggestion. The full-number working copy lives in the session artifacts dir (see [Section 9](#9-usage-summary-telemetry)). Roll-up deeplink: [all events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAACpWSQYvbMBCF7%2F4V05NsSEKvZXEvSwqBppSm7aWUMiu97AosKWjGTrzkxxfbsaFlLznqzbxv5qFpoISLUk0myJpf2wxNqZFNJzY5TIpNUdlHZD6dxDwUDZTOPrp0ppo%2BvHcPhW1aUeTSOKdoJq%2BpNo6Vn1hQmp%2BHx%2BSwvaipNt%2F4vO0QVRaxuNL5BRl0QO6Qv%2FsAUQ4n%2Bkj8nMppVrV0bS%2BKKD7FLxxAdT0kWIqaRLOPz%2BXXnE7I6iG%2FjBe26jtWnyKG2eZ3Re9qMppbmOJK0obA2b%2BiICLaxS7ZsVmIqCab2qhltRqLw%2FQcufkhyEI1ubHqj%2BUUZ8%2F2xUfs3Ip2sotT77DkkRvBjTHr9zKGdW%2BIQ2st4OCGx7yjP5Zv5s%2BQthlD1zWZxWpurE%2FsmxvoXtZknUGPHC0W1F2g2TqjPrPoAYgz6phyYP3jWKE%2BoAx8Kf87l2pFpu%2F7fr3fr50z1ch56mm8tuFWiiul7JBH8Z9vdBD7F5At0nwMAwAA)

Counts: **54 commands** (53 contributed `A+B`, 1 code-only `B`, 1 contributed-without-handler), **7 settings**, **22 node types** (+ 11 generic inline children, + 9 status/mode context-value variants), **34 `AzureWizard` flows** (+ ~15 non-wizard interactive flows), **1 walkthrough** (5 steps), **1 submenu**, **50 `view/item/context` entries**, **9 `commandPalette: never` hides**, **1 `jsonValidation`**, **1 file system provider**, **2 webviews**, **2 branch data providers**, **3 dead NLS keys**.
Explicitly zero: **0 views / viewsContainers** (the extension contributes no tree view of its own — it grafts onto the Azure Resources host tree), **0 debuggers**, **0 taskDefinitions**, **0 problemMatchers**, **0 keybindings**, **0 languages/grammars**, **0 `enablement` gates**, **0 `activationEvents`**, **0 `enabledApiProposals`**, **0 telemetry suppressions**, **0 build presets**, **0 framework detectors** (the build contract is always "there is a Dockerfile").

---

## 0. Extension-level shape

- **extensionDependencies (A):** `ms-azuretools.vscode-azureresourcegroups` (hard dependency — the extension has no view of its own and reaches the tree, portal, and reveal behavior through the host).
- **activationEvents (A):** `[]` (empty). Activation is driven entirely by `contributes.x-azResources.activation.onResolve` and by contributed command invocation.
- **engines.vscode:** `^1.104.0`. **preview:** `true`. **main:** `./main.js` (Node host only).
- **capabilities (A):** `virtualWorkspaces = { supported: 'limited', description: 'Some features are not supported in virtual workspaces.' }`. `untrustedWorkspaces` is not declared. No command-level `!isWeb` / `!virtualWorkspace` gates exist anywhere in the manifest.
- **x-azResources (A):**
  - `azure.branches`: `{ type: 'ContainerAppsEnvironment' }`, `{ type: 'ContainerApps' }`
  - `activation.onResolve`: `microsoft.app/managedenvironments`, `microsoft.app/containerapps`
  - `commands`: `containerApps.createManagedEnvironment` — title "Create Container Apps Environment...", `type: 'ContainerAppsEnvironment'`, detail "For managing serverless container apps."
  - No `workspace` contributions.
- **jsonValidation (A):** `*.containerapp-template.json` -> `https://json.schemastore.org/azure-containerapp-template.json`. Note this file-match is what makes the revision-draft virtual document (`...containerapp-template.json`) get schema validation/IntelliSense while editing.
- **Exported extension API (B)** — the return value of `activate()` is `createApiProvider([clientApi])` (an `AzureExtensionApiProvider`):
  - `apiVersion: '1.1.0'`
  - `deployImage(options: DeployImageToAcaOptionsContract): Promise<void>` — options: `image`, `registryName` (required); `username`, `secret` (optional).
  - `deployWorkspaceProject(options: DeployWorkspaceProjectOptionsContract): Promise<DeployWorkspaceProjectResults>` — options: `subscriptionId`, `resourceGroupId`, `location`, `rootPath`, `srcPath`, `dockerfilePath`, `suppressConfirmation`, `suppressContainerAppCreation`, `shouldSaveDeploySettings`. Results: `resourceGroupId`, `logAnalyticsWorkspaceId`, `managedEnvironmentId`, `containerAppId`, `registryId`, `registryLoginServer`, `registryUsername`, `registryPassword`, `imageName`.
  - API CHANGELOG (`src/commands/api/CHANGELOG.md`): `1.1.0` moved to the Azure Resources auth API v4; `1.0.0` added the `location` parameter.
  - **Known consumer:** the Containers/Docker extension ("Container Registries: Deploy Image to Azure Container Apps...") calls `deployImage`; this is an external contract the monorepo must keep or deliberately break.
  - **Test-only API (B):** when `process.env.VSCODE_RUNNING_TESTS` is set, `apiVersion` becomes `'99.0.0'` and the object also exposes `extensionVariables.getState/getOutputChannel/getRgApiV2/getBranchDataProvider`, plus `createContainerAppInternal`, `createManagedEnvironmentInternal`, `deployContainerAppInternal`, `deployWorkspaceProjectInternal`, `deployWorkspaceProjectApiInternal` (`src/testApi.ts`).
- **Activation wiring (B)** — `activate()`, in order:
  1. `ext.context`, `ext.ignoreBundle`.
  2. `createAzExtOutputChannel('Azure Container Apps', ext.prefix)` — output channel; `ext.prefix = 'containerApps'`.
  3. `registerUIExtensionVariables`, `registerAzureUtilsExtensionVariables`, `registerGitHubExtensionVariables`.
  4. Everything below runs inside `callWithTelemetryAndErrorHandling('containerApps.activate', ...)` with `errorHandling.rethrow = true`, `telemetry.properties.isActivationEvent = 'true'`, and a `mainFileLoad` measurement.
  5. `registerCommands()` — which also calls `registerErrorHandler(c => c.errorHandling.suppressReportIssue = true)` (globally suppresses the inline Report Issue button) and `registerReportIssueCommand('containerApps.reportIssue')`.
  6. `createExperimentationService(context)` -> `ext.experimentationService`.
  7. `new RevisionDraftFileSystem()` + `vscode.workspace.registerFileSystemProvider(RevisionDraftFileSystem.scheme, ...)` — scheme **`containerAppsRevisionDraft`**.
  8. `new TreeElementStateManager()` -> `ext.state`.
  9. `new ContainerAppsBranchDataProvider()` and `new ContainerAppsResourceBranchDataProvider()`.
  10. Auth-handshake bookkeeping: a UUID `authHandshakeId` + start timestamp recorded onto activation telemetry.
  11. `createContainerAppsApiProvider(registerBranchResources, coreExtensionApi)` — performs the Azure Resources host handshake (`prepareAzureResourcesApiRequest` + `requestResourcesApis`). On success (`hostApiRequestSucceeded`) it stores `ext.rgApiV2` and registers both branch data providers: `AzExtResourceType.ContainerAppsEnvironment` -> `ContainerAppsBranchDataProvider`, `AzExtResourceType.ContainerApps` -> `ContainerAppsResourceBranchDataProvider`. On failure it emits `hostApiRequestFailed` and logs to the output channel.
  - **Not present:** no `registerUriHandler`, no `registerWebviewViewProvider` (webviews are created on demand as panels), no language/folding providers, no `AzExtTreeFileSystem`, no task or debug provider registration, no `setupAzureLogger`.
- **Telemetry (B):** EventName convention `<extensionId>/<callbackId>` (lowercased). **No callback anywhere sets `suppressIfSuccessful` or `suppressAll`**, so every count below is an honest adoption signal. Non-command telemetry callback ids:

  | Callback id | Site | Purpose |
  |---|---|---|
  | `containerApps.activate` | `extension.ts` | activation (excluded from usage query via `isactivationevent`) |
  | `hostApiRequestSucceeded` | `extension.ts` | Azure Resources handshake success + auth handshake duration |
  | `hostApiRequestFailed` | `createContainerAppsApiProvider.ts` | handshake failure |
  | `containerApps.api.deployImage` | `deployImageApi.ts` | programmatic API entry point |
  | `containerApps.api.deployWorkspaceProject` | `deployWorkspaceProjectApi.ts` | programmatic API entry point |
  | `containerApps.showCaNotification` | `showContainerAppNotification.ts` | post-create notification |
  | `deployWorkspaceProject.displayNotification` | `deployWorkspaceProject.ts` | post-deploy notification |
  | `containerApps.streamingLogs` | `logStreamRequest.ts` | wraps a log-stream session lifetime |
  | `revisionDraftUpdateBaseStep.deploy` | `RevisionDraftUpdateBaseStep.ts` | revision-draft deploy step |
  | `getResourceItem` | `ContainerAppsBranchDataProvider.ts` | tree resolve |
  | `managedEnvironmentItem.getChildren` | `ManagedEnvironmentItem.ts` | tree expand |
  | `containerAppItem.getChildren` | `ContainerAppItem.ts` | tree expand |
  | `getChildren` | `ConfigurationItem.ts` **and** `RevisionsItem.ts` (same id, two sites — cannot be told apart in telemetry) | tree expand |
  | `getSourceControl` | `ActionsItem.ts` | GitHub source-control lookup |
  | `revisionDraftItem.hasUnsavedChanges.getRevisions` | `RevisionDraftItem.ts` | unsaved-changes badge |

  Framework/plumbing rows seen in results with no user feature: `call-tas-error`, `unhandlederror`, `getactionschildren` (from `vscode-azext-github`).

---

## 1. Commands (A + B)

53 contributed + 1 code-only. Every contributed command except `containerApps.deployWorkspaceProjectApi` has a handler in `src/commands/registerCommands.ts`. Unless noted, registration is `registerCommandWithTreeNodeUnwrapping` and the telemetry callback id equals the command id. No debounce args, no per-command `enablement`.

All `view/item/context` `when` clauses share the prefix `view =~ /(azureResourceGroups|azureFocusView)/ &&` — abbreviated below as `view~ACA &&`.

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `containerApps.reportIssue` | Report Issue... | A+B | very low · lean Migrate (framework-provided) | Registered via `registerReportIssueCommand`. Palette only. Pairs with the global `suppressReportIssue` error handler. |
| `containerApps.createContainerApp` | Create Container App... | A+B | **high** · lean Migrate | `view~ACA && viewItem =~ /managedEnvironmentItem/i` @ `2@1`; also submenu `2_create@1`; icon `$(add)`. High cancel share (wizard exploration). |
| `containerApps.createManagedEnvironment` | Create Container Apps Environment... | A+B | **high** · **Migrate + fix** | `view~ACA && viewItem =~ /azureResourceTypeGroup/i && viewItem =~ /containerAppsEnvironment/i` @ `2@1`; also an `x-azResources` create command. **Failure share exceeds success share** — this is a fix signal, not a drop signal. |
| `containerApps.deleteManagedEnvironment` | Delete Container Apps Environment... | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /managedEnvironmentItem/i` @ `3@1`. |
| `containerApps.deployWorkspaceProject` | Deploy Project from Workspace... | A+B | **high** · lean Migrate | Submenu `1_deploy@1` (workspace view title). The flagship feature per the marketplace README. Cancel share ~40%. |
| `containerApps.deployWorkspaceProjectApi` | Deploy Project from Workspace (API)... | **A only** | **no event — and no handler** | ⚠️ **Broken/placeholder contribution.** Contributed in `package.json` and hidden from the palette (`when: never`), but **no `registerCommand` call exists**. Invoking it would fail. The real API path is the exported `deployWorkspaceProject` API method, instrumented as `containerApps.api.deployWorkspaceProject`. **Do not migrate the contribution**; migrate the API method. |
| `containerApps.deployImageApi` | Deploy Image to Container App (API)... | A+B | moderate · lean Migrate | Palette `when: never`. Handler `deployImageApiCompat` — a back-compat shim for callers that invoke the API as a command. Distinct from the `containerApps.api.deployImage` API callback, which is separately instrumented at a similar level. |
| `containerApps.deployContainerApp` | Deploy to Container App... | A+B | **high** · lean Migrate | `view~ACA && viewItem =~ /containerAppItem(.*)revisionMode:single/i` @ `2@1`. Roughly balanced success/failure/cancel — worth a reliability look. |
| `containerApps.deployContainerAppWithCopilot` | Deploy to Container App with Copilot... | A+B | low · **Migrate + fix** | `...containerAppItem(.*)revisionMode:single/i` @ `2@2`; palette `when: never`. ⚠️ **Every recorded invocation in the window failed (zero successes).** Treat as broken, not unwanted. |
| `containerApps.deployContainerAppInternal` | *(no title — not contributed)* | **B only** | no event of its own | Registered with plain `registerCommand`. Internal entry point used by `deployContainerApp`, which sets `context.callbackId = 'containerApps.deployContainerAppInternal'`. Not user-invocable. |
| `containerApps.deleteContainerApp` | Delete Container App... | A+B | low · lean Migrate | `view~ACA && viewItem =~ /containerAppItem/i` @ `6@1`. |
| `containerApps.editContainerApp` | Edit Container App (Advanced)... | A+B | moderate · lean Migrate | `...containerAppItem(.*)revisionMode:single/i` @ `4@2`. Opens the revision-draft virtual document. |
| `containerApps.browse` | Browse | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /containerAppItem/i` @ `1@1`. |
| `containerApps.revealInEnvironment` | Reveal in Container Apps Environments | A+B | very low · needs a human (**small N** — shipped in 0.11.1, 2026-05-28) | `view~ACA && viewItem =~ /containerAppResourceItem/i` @ `1_navigate@1`. Bridges the flat `ContainerApps` tree to the environment-rooted tree. |
| `containerApps.openConsoleInPortal` | Open Console in Portal | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /containerAppItem/i` @ `9@3`. |
| `containerApps.startStreamingLogs` | Start Streaming Logs... | A+B | **highest of all commands** · lean Migrate | `view~ACA && viewItem =~ /containerAppItem/i` @ `5@1`; also the click command of the `logStreamItem` tree node. Notable failure share -> reliability work. |
| `containerApps.stopStreamingLogs` | Stop Streaming Logs... | A+B | low · lean Migrate (pairs with start) | `view~ACA && viewItem =~ /containerAppItem/i` @ `5@2`. |
| `containerApps.editContainer` | Edit Container... | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /containerItem/i` @ `1@1`. |
| `containerApps.editContainerImage` | Edit Container Image... (short: Edit Image...) | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /imageItem/i` @ `1@1`. |
| `containerApps.addEnvironmentVariable` | Add Environment Variable... | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /environmentVariablesItem/i` @ `1@1`. |
| `containerApps.editEnvironmentVariables` | Edit Environment Variables (.env)... | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /environmentVariablesItem/i` @ `1@2`. Cancel-dominant (file picker). |
| `containerApps.editEnvironmentVariableName` | Edit Environment Variable Name... (short: Edit Name...) | A+B | low · needs a human | `view~ACA && viewItem =~ /environmentVariableItem/i` @ `1@1`. Cancel share is very high relative to successes. |
| `containerApps.editEnvironmentVariableValue` | Edit Environment Variable Value... (short: Edit Value...) | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /environmentVariableItem/i` @ `1@2`. |
| `containerApps.convertEnvironmentVariable` | Convert Environment Variable to Secret... (short: Convert to Secret...) | A+B | low · needs a human | `view~ACA && viewItem =~ /environmentVariableItem/i` @ `1@3`. Cancel-dominant. |
| `containerApps.deleteEnvironmentVariable` | Delete Environment Variable... (short: Delete...) | A+B | low · needs a human | `view~ACA && viewItem =~ /environmentVariableItem/i` @ `2@1`. |
| `containerApps.toggleEnvironmentVariableVisibility` | Toggle Environment Variable Visibility | A+B | **high** · lean Migrate | `view~ACA && viewItem =~ /environmentVariableItem/i` @ `inline`; palette `when: never`; icon `$(eye)`. Also the click command on `EnvironmentVariableItem`. Handler is an inline lambda calling `item.toggleValueVisibility(context)`. |
| `containerApps.enableIngress` | Enable Ingress for Container App... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /ingressDisabledItem/i` @ `1@1`. Cancel-dominant. |
| `containerApps.disableIngress` | Disable Ingress for Container App | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /ingressEnabledItem/i` @ `1@1`. Cancel-dominant (confirmation). |
| `containerApps.toggleVisibility` | Switch Ingress Visibility... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /ingressEnabledItem/i` @ `1@2`. |
| `containerApps.editTargetPort` | Edit Target Port... | A+B | low · needs a human | `view~ACA && (viewItem =~ /ingressEnabledItem/i \|\| viewItem =~ /targetPortItem/i)` @ `1@3` — the only `when` clause in the manifest that ORs two context values. |
| `containerApps.addSecret` | Add Secret... | A+B | low · needs a human | `view~ACA && viewItem =~ /secretsItem/i` @ `1@1`. |
| `containerApps.editSecretValue` | Edit Secret Value... | A+B | moderate · lean Migrate | `view~ACA && viewItem =~ /secretItem/i` @ `1@2`. |
| `containerApps.deleteSecret` | Delete Secret... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /secretItem/i` @ `2@1`. |
| `containerApps.createRevisionDraft` | Create Draft... | A+B | very low · needs a human (draft feature is entered more often via `editContainerApp`) | `view~ACA && viewItem =~ /revisionDraft:false(.*)revisionsItem/i` @ `inline@1` **and** `1@1`; icon `$(add)`. |
| `containerApps.editRevisionDraft` | Edit Draft (Advanced)... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /revisionDraftItem/i` @ `3@1`. |
| `containerApps.deployRevisionDraft` | Deploy Draft... | A+B | low · lean Migrate (core to the draft model) | Four entries: `...containerAppItem(.*)revisionMode:single(.*)unsavedChanges:true/i` @ `inline@1` + `3@1`; `...revisionDraftItem(.*)unsavedChanges:true/i` @ `inline@1` + `1@1`; icon `$(cloud-upload)`. |
| `containerApps.discardRevisionDraft` | Discard Draft | A+B | low · lean Migrate (pairs with deploy) | Four entries: `...containerAppItem(.*)revisionMode:single(.*)unsavedChanges:true/i` @ `inline@2` + `3@2`; `...revisionDraftItem/i` @ `inline@2` + `1@2`; icon `$(discard)`. Note the `revisionDraftItem` entries do **not** require `unsavedChanges:true`. |
| `containerApps.chooseRevisionMode` | Choose Revision Mode... | A+B | low · needs a human | Two entries: `view~ACA && viewItem =~ /containerAppItem/i` @ `6@2`; `view~ACA && viewItem =~ /revisionsItem/i` @ `2@1`. Cancel-dominant. |
| `containerApps.activateRevision` | Activate | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /revisionItem(.*)revisionState:inactive/i` @ `2@1`. Cancel-dominant (confirmation). |
| `containerApps.deactivateRevision` | Deactivate | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /revisionItem(.*)revisionState:active/i` @ `2@2`. |
| `containerApps.restartRevision` | Restart | A+B | moderate · lean Migrate | Two entries: `...containerAppItem(.*)revisionMode:single/i` @ `1@2`; `...revisionItem(.*)revisionState:active/i` @ `2@1`. |
| `containerApps.editScaleRange` | Edit Scaling Range... | A+B | low · needs a human | `view~ACA && viewItem =~ /scaleItem/i` @ `1@1`. |
| `containerApps.addScaleRule` | Add Scale Rule... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /scaleRuleGroupItem/i` @ `1@1`. |
| `containerApps.deleteScaleRule` | Delete Scale Rule... | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /scaleRuleItem/i` @ `1@1`. Zero successes in the window. |
| `containerApps.connectToGitHub` | Connect to GitHub Repository... | A+B | moderate · lean Migrate | **No menu entry.** Reached from the palette and from `ActionsItem.getConnectToGitHubCommand()` (args `[{ containerApp, subscription }]`). |
| `containerApps.disconnectRepo` | Disconnect from Repo | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /actionsConnected:true(.*)containerAppsActionsItem/i` @ `1@2`. Context value is owned by `vscode-azext-github`'s `ActionsItemBase`, prefixed with `ext.prefix`. |
| `containerApps.openGitHubRepo` | Open Repo in GitHub | A+B | very low · candidate Drop/Defer — flag for human | `view~ACA && viewItem =~ /actionsConnected:true(.*)containerAppsActionsItem/i` @ `1@1`. Zero successes in the window (all cancels). |
| `containerApps.createAcr` | Create Azure Container Registry... | A+B | low · needs a human | Palette-visible, no menu entry; registered with plain `registerCommand`. Also runs as a sub-wizard inside image-source flows. Zero successes standalone (cancel-dominant) — likely mostly reached as a sub-flow. |
| `containerApps.openAcrBuildLogs` | Open Azure Container Registry Build Logs | A+B | low · lean Migrate | Palette `when: never`; registered with plain `registerCommand`. Invoked from the "View Logs" button on an ACR build failure. |
| `containerApps.walkthrough.gettingStarted.internal` | Open Walkthrough | A+B | moderate · lean Migrate | Submenu `3_walkthrough@1`. Opens `workbench.action.openWalkthrough` with `ms-azuretools.vscode-azurecontainerapps#containerApps.walkthrough.gettingStarted`. 100% success. |
| `containerApps.walkthrough.addWorkspaceProject` | Add a workspace project | A+B | **high** · lean Migrate | Palette `when: never`; walkthrough step button. Clears workspace folders (modal warning) then runs `git.clone`. |
| `containerApps.walkthrough.azureSignIn` | Sign in to Azure | A+B | **high** · lean Migrate | Palette `when: never`. Runs `azureResourceGroups.logIn`. 100% success. |
| `containerApps.walkthrough.deployWorkspaceProject` | Create and deploy | A+B | moderate · needs a human (cancel-dominant) | Palette `when: never`. Delegates to `deployWorkspaceProject`. |
| `containerApps.walkthrough.cleanUpResources` | Clean up resources | A+B | low · lean Migrate | Palette `when: never`. Runs `azureResourceGroups.deleteResourceGroupV2`. 100% success. |

> **Telemetry cell** = collected usage for EventName `ms-azuretools.vscode-azurecontainerapps/<commandId>` (lowercased) over a 90d window ending 2026-08-21, expressed as a qualitative band relative to *this extension's own* command distribution (raw counts redacted per repo policy; see the session working copy). Bands: **high** = top of the distribution; **moderate**; **low**; **very low** = bottom of the distribution. The suggestion is **advisory** — the Migrate/Drop call belongs to the human and to the migration skill's triage gate.

> **Code-only commands (B, not in the manifest):** `containerApps.deployContainerAppInternal` — registered with plain `registerCommand`, invoked programmatically by `deployContainerApp`.

> **Contributed without a handler (flag):** `containerApps.deployWorkspaceProjectApi`.

> **Orphan / dead NLS keys (DO NOT MIGRATE)** — present in `package.nls.json`, referenced by neither the manifest nor any `localize()` call:
> - `containerApps.viewProperties` ("View Properties")
> - `containerApps.revealResource` ("Reveal Resource")
> - `containerApps.openInPortal` ("Open in Portal")
>
> All three are leftovers from when the extension contributed these commands itself; the behavior now comes from the Azure Resources host (`azureResourceGroups.openInPortal`, `azureResourceGroups.revealResource`) and from the `viewProperties`/`portalUrl` properties on tree items.

---

## 2. Settings / Configuration (A)

Single configuration section titled "Azure Container Apps". No setting has a `deprecationMessage`. **None of these have a telemetry event** (settings are read, not invoked).

| Setting id | Type | Scope | Default | Notes / code usage |
|---|---|---|---|---|
| `containerApps.deploymentConfigurations` | array of object | `machine-overridable` | *(none)* | The V2 deploy-workspace-project settings schema. Item properties: `label`, `type` (default `AcrDockerBuildRequest`), `dockerfilePath`, `srcPath`, `envPath`, `resourceGroup`, `containerApp`, `containerRegistry`. Written by `DeployWorkspaceProjectSaveSettingsStep`, read by `DeploymentConfigurationListStep`. Persisted to `.vscode/settings.json`. |
| `containerApps.deployWorkspaceProject.containerRegistryName` | string | `machine-overridable` | *(none)* | **V1 (legacy) schema.** Read by the V1->V2 converter (`convertV1ToV2SettingsSchema`). |
| `containerApps.deployWorkspaceProject.containerAppName` | string | `machine-overridable` | *(none)* | V1 (legacy) schema. |
| `containerApps.deployWorkspaceProject.containerAppResourceGroupName` | string | `machine-overridable` | *(none)* | V1 (legacy) schema. |
| `containerApps.enableOutputTimestamps` | boolean | window (default) | `true` | Prepends a timestamp to each output-channel line. Consumed by `createAzExtOutputChannel`. |
| `containerApps.deleteConfirmation` | string enum | window (default) | `EnterName` | Enum `EnterName` \| `ClickButton`. Despite the description saying "Container Apps environment", it gates the delete-confirmation style. Consumed by `DeleteEnvironmentConfirmationStep`. |
| `containerApps.showDraftCommandDeployPopup` | boolean | window (default) | `true` | Constant `showDraftCommandDeployPopupSetting = 'showDraftCommandDeployPopup'` in `constants.ts`; consumed by `RevisionDraftDeployPromptStep` (the "deploy your draft?" prompt, with a don't-ask-again path that writes the setting globally). |

`settingUtils.ts` provides the read/write helpers (`updateGlobalSetting`, `updateWorkspaceSetting`, `getGlobalSetting`, `getWorkspaceSetting`, `getSetting`, `getWorkspaceSettingFromAnyFolder`, `getDefaultRootWorkspaceSettingsPath`) — all prefixed with `containerApps` and multi-root aware (`getWorkspaceSettingFromAnyFolder` returns `undefined` when folders disagree).

---

## 3. Tree view (A branch + B behavior)

**The extension contributes no view of its own.** It registers two branch data providers into the Azure Resources host tree (`azureResourceGroups` / `azureFocusView` views):

| Provider | Resource type | Root item | Behavior |
|---|---|---|---|
| `ContainerAppsBranchDataProvider` | `AzExtResourceType.ContainerAppsEnvironment` (ARM `microsoft.app/managedenvironments`) | `ManagedEnvironmentItem` | Full hierarchy. `getResourceItem` -> `ManagedEnvironmentItem.Get(...)`; every item wrapped by `ext.state.wrapItemInStateHandling(item, () => this.refresh(item))`. |
| `ContainerAppsResourceBranchDataProvider` | `AzExtResourceType.ContainerApps` (ARM `microsoft.app/containerapps`) | `ContainerAppResourceItem` | Flat leaf list only (`getChildren` -> `[]`), used by the "group by resource type" view. Exists so an app can be found without knowing its environment; `containerApps.revealInEnvironment` jumps from here into the full tree. |

### Hierarchy with exact contextValues

Context values are composed with `createContextValue([...])`, which joins the values with `|`. Menu `when` clauses match substrings via regex, so ordering within the composed string does not matter except where a clause uses `(.*)` to require two tokens.

```
ManagedEnvironmentItem                     '<envName>|managedEnvironmentItem'
└── ContainerAppItem                       'containerAppItem|<appName>|revisionMode:single|multiple|unsavedChanges:true|false'
    │
    ├── [revisionMode:single] template children rendered directly:
    │   ├── ContainersItem                 'containersItem'   (or 'containerItem' when exactly 1 container)
    │   │   ├── [1 container] ImageItem + EnvironmentVariablesItem directly
    │   │   └── [N containers] ContainerItem ('containerItem') x N
    │   │       ├── ImageItem              'imageItem'
    │   │       │   ├── (generic)          'containerImageNameItem'
    │   │       │   └── (generic)          'containerImageRegistryItem'
    │   │       └── EnvironmentVariablesItem  'environmentVariablesItem'
    │   │           └── EnvironmentVariableItem x N   'environmentVariableItem'
    │   └── ScaleItem                      'scaleItem'
    │       ├── (generic)                  'minMaxReplicaItem'
    │       └── ScaleRuleGroupItem         'scaleRuleGroupItem'
    │           └── ScaleRuleItem x N      'scaleRuleItem'
    │
    ├── [revisionMode:multiple]
    │   └── RevisionsItem                  'revisionsItem|revisionDraft:true|false'
    │       ├── RevisionDraftItem          'revisionDraftItem|unsavedChanges:true|false'   (only when a draft exists)
    │       │   └── ContainersItem + ScaleItem   (draft template children)
    │       └── RevisionItem x N           'revisionItem|<revisionName>|revisionDraft:true|false|revisionState:active|inactive'
    │           └── ContainersItem + ScaleItem
    │
    ├── ConfigurationItem                  'configurationItem'
    │   ├── IngressEnabledItem             'ingressEnabledItem'      (when configuration.ingress is set)
    │   │   ├── (generic)                  'visibilityItem'
    │   │   └── (generic)                  'targetPortItem'
    │   ├── IngressDisabledItem            'ingressDisabledItem'     (otherwise; leaf)
    │   ├── SecretsItem                    'secretsItem'
    │   │   └── SecretItem x N             'secretItem'
    │   ├── ActionsItem                    (contextValue owned by ActionsItemBase in @microsoft/vscode-azext-github,
    │   │                                   prefixed with ext.prefix -> matches /containerAppsActionsItem/ and
    │   │                                   carries the /actionsConnected:true|false/ token)
    │   ├── DaprEnabledItem                'daprEnabledItem'         (when configuration.dapr.enabled)
    │   │   ├── (generic)                  'daprAppIdItem'
    │   │   ├── (generic)                  'daprAppPortItem'
    │   │   └── (generic)                  'daprAppProtocol'         <-- see bug note below
    │   └── (generic) daprDisabledItem     'daprDisabledItem'        (otherwise)
    └── LogsGroupItem                      'logsGroupItem'
        ├── (generic)                      'logStreamItem'   click -> containerApps.startStreamingLogs
        └── (generic)                      'logsItem'        click -> azureResourceGroups.openInPortal

ContainerAppResourceItem (flat tree)       'containerAppResourceItem|<resourceName>'   (leaf)
```

**Status / mode context-value tokens** (from `constants.ts` unless noted): `revisionMode:single`, `revisionMode:multiple`, `revisionDraft:true`, `revisionDraft:false`, `unsavedChanges:true`, `unsavedChanges:false`, `revisionState:active`, `revisionState:inactive` (module-private in `RevisionItem.ts`), plus `activity:info` and `noMatchingResources`.

**There are no `invalid*` / error context-value variants** — the extension does not use `createTreeItemsWithErrorHandling`. `ContainerAppItem.getChildren` instead *throws* when `provisioningState` is `Deleting` or `InProgress`.

### Per-node details

| Node | Label | Description | Icon | Collapsible | Click command | Children source |
|---|---|---|---|---|---|---|
| `ManagedEnvironmentItem` | env name | — | `resources/managed-environment.svg` | Collapsed | — | ARM `containerApps.listByResourceGroup` filtered to this environment |
| `ContainerAppItem` | app name | "Unsaved changes" (single-mode draft) else non-`Succeeded` `provisioningState` | `resources/azure-containerapps.svg` | Collapsed | — | single-mode: `containerAppsRevisions.getRevision(latest)` then template children; multi-mode: `RevisionsItem`. Plus `ConfigurationItem` + `LogsGroupItem`. |
| `ContainerAppResourceItem` | resource name | — | `resources/azure-containerapps.svg` | None | — | leaf (`[]`); id is `<armId>#flat` |
| `RevisionsItem` | "Revision Management" | — | `resources/revision-management.svg` | Collapsed | — | `containerAppsRevisions.listRevisions` (full drain via `listAllIterator`, reversed), draft prepended |
| `RevisionDraftItem` | "Draft" | `Based on "<rev>"` / `Based on "<rev>" (Latest)` | `resources/revision-draft.svg` | **Expanded** | — | draft template children |
| `RevisionItem` | "Latest" (single) / revision name (multi) | Inactive / Latest / Active | `ThemeIcon` varying by state: `circle-slash`+`testing.iconUnset`, `play-circle`+`testing.iconUnset`, `error`+`testing.iconFailed`, `pass`+`testing.iconPassed` | Collapsed | — | `[ContainersItem, ScaleItem]` |
| `ContainersItem` | "Container"/"Containers" (+`*` when draft dirty) | — | `resources/containers.svg` | Collapsed | — | in-memory template; **collapses to a single `containerItem` contextValue when there is exactly one container** |
| `ContainerItem` | container name (+`*`) | — | *(none)* | Collapsed | — | `[ImageItem, EnvironmentVariablesItem]` |
| `ImageItem` | "Image" (+`*`) | — | `ThemeIcon('window')` | Collapsed | — | name + registry generic children |
| `EnvironmentVariablesItem` | "Environment Variables" (+`*`) | — | `ThemeIcon('settings')` | Collapsed | — | one `EnvironmentVariableItem` per `container.env` |
| `EnvironmentVariableItem` | `<name>=Hidden value. Click to view.` or `<name>=<value\|secretRef>` | "Secret reference" when revealed and `secretRef` | `ThemeIcon('symbol-constant')` | leaf | **`containerApps.toggleEnvironmentVariableVisibility`** (args `[this, this.hideValue]`) | — |
| `ScaleItem` | "Scaling" (+`*`) | — | `resources/scaling.svg` | Collapsed | — | `minMaxReplicaItem` + `ScaleRuleGroupItem` |
| `ScaleRuleGroupItem` | "Scale Rules" (+`*`) | — | `ThemeIcon('symbol-constant')` | Collapsed | — | `ScaleRuleItem` per `scale.rules`, sorted by id |
| `ScaleRuleItem` | rule name (+`*`) | HTTP / Azure Queue / Custom / Unknown | `ThemeIcon('dash')` | leaf | — | — |
| `ConfigurationItem` | "Configurations" | — | `ThemeIcon('gear')` | Collapsed | — | ingress + secrets + actions + dapr |
| `IngressEnabledItem` | "Ingress" | — | `resources/virtual-network.svg` | Collapsed | — | `visibilityItem` (External/Internal) + `targetPortItem` |
| `IngressDisabledItem` | "Ingress" | "Disabled" | `ThemeIcon('debug-disconnect')` | leaf | — | — |
| `SecretsItem` | "Secrets" | — | `resources/secrets.svg` | Collapsed | — | `containerApp.configuration.secrets` (in-memory; values fetched separately via `getContainerEnvelopeWithSecrets` only when writing) |
| `SecretItem` | secret name | — | `ThemeIcon('key')` | leaf | — | — |
| `ActionsItem` | *(from `ActionsItemBase`)* | *(from base)* | *(from base)* | *(from base)* | — | `getSourceControl()` -> `containerAppsSourceControls.listByContainerApp`; supplies `getConnectToGitHubCommand()` |
| `DaprEnabledItem` | "Dapr" | "Enabled" | `resources/dapr-light.svg` / `dapr-dark.svg` | Collapsed | — | appId / appPort / appProtocol generic children |
| `LogsGroupItem` | "Logs" | — | `ThemeIcon('book')` | Collapsed | — | `logStreamItem` + `logsItem` |

> ⚠️ **Source bug to fix, not port** (`src/tree/configurations/DaprItem.ts`): the app-protocol child sets `description: daprAppProtocolItemContextValue` (so the tree literally displays the string "daprAppProtocolItem" as the description) and `contextValue: 'daprAppProtocol'` (the literal, not the `...Item` constant). The description and contextValue are effectively swapped. Nothing targets `daprAppProtocol` in a menu, so the only user-visible symptom is the junk description.

### Refresh / state

- No polling anywhere. Refresh is driven by explicit action.
- `ext.state.wrapItemInStateHandling` wraps every item (host spinner states); `showDeleting` used by `ContainerAppItem.delete()`; `showCreatingChild` used when creating a draft in multi-revision mode; `notifyChildrenChanged(managedEnvironmentId)` fired on draft write and on app delete.
- `EnvironmentVariableItem.toggleValueVisibility()` calls `ext.branchDataProvider.refresh(item)` to re-render.
- No pagination (`hasMoreChildren` / `loadMoreChildren`) anywhere — revision lists are fully drained with `uiUtils.listAllIterator`.

### Menus (A)

- **`view/title`** (1): submenu `containerApps.submenus.workspaceActions` when `view == azureWorkspace`, group `navigation@4`.
- **`submenus`** (1): `containerApps.submenus.workspaceActions`, label "Azure Container Apps", icon `resources/azure-containerapps.svg`; members: `deployWorkspaceProject` (`1_deploy@1`), `createContainerApp` (`2_create@1`), `walkthrough.gettingStarted.internal` (`3_walkthrough@1`).
- **`view/item/context`** (50 entries): all listed per-command in Section 1.
- **`commandPalette`** (9 `when: never` hides): `deployWorkspaceProjectApi`, `deployImageApi`, `deployContainerAppWithCopilot`, `openAcrBuildLogs`, `toggleEnvironmentVariableVisibility`, `walkthrough.addWorkspaceProject`, `walkthrough.azureSignIn`, `walkthrough.deployWorkspaceProject`, `walkthrough.cleanUpResources`.

### Pick steps (the command -> node contract, B)

Every command that can be invoked without a node re-derives one through `ContextValueQuickPickStep`s over `ext.rgApiV2.resources.azureResourceTreeDataProvider`:

| Helper | Filter (verbatim) | `skipIfOne` |
|---|---|---|
| `getPickEnvironmentSteps` | `QuickPickAzureSubscriptionStep`, `QuickPickGroupStep({ groupType: [AzExtResourceType.ContainerAppsEnvironment] })`, `/managedEnvironmentItem/` | false |
| `getPickContainerAppSteps` | env steps + `/containerAppItem/` (or `^<name>$`) | false |
| `getPickRevisionsStep` | `/revisionsItem/` | true |
| `getPickRevisionStep` | `/revisionItem/` | true |
| `getPickRevisionDraftStep` | `/revisionDraftItem/` | true |
| `getPickConfigurationsStep` | `/configurationItem/` | true |
| `getPickContainersStep` / `getPickContainerStep` | `/containersItem/` / `/containerItem/` | true |
| `getPickImageStep` | `/imageItem/` | true |
| `getPickEnvironmentVariablesStep` / `getPickEnvironmentVariableStep` | `/environmentVariablesItem/` / `/environmentVariableItem/` | true / false |
| `getPickSecretsStep` / `getPickSecretStep` | `/secretsItem/` / `/secretItem/` | true / false |
| `getPickScaleStep` | `/scaleItem/` | true |
| `getPickScaleRuleGroupStep` / `getPickScaleRuleStep` | **plain strings** `'scaleRuleGroupItem'` / `'scaleRuleItem'` (not RegExps — inconsistent with every other step) | true / false |

`ParentResourceItemPickSteps` transparently inserts the revisions/draft hop when the app is in multiple-revision mode, so container/scale/env-var commands work identically in both revision modes.

---

## 4. Debugging + tasks (A + B)

**None.** The extension contributes **0 debuggers**, **0 `taskDefinitions`**, **0 `problemMatchers`**, and registers no `DebugConfigurationProvider` or `TaskProvider`. There is no dev-server or emulator. This whole category is absent — nothing to migrate.

---

## 5. Wizards (B)

**34 `new AzureWizard(...)` sites** across 34 files (one per file), plus ~15 non-wizard interactive/direct flows. Every wizard is built from `@microsoft/vscode-azext-utils` `AzureWizardPromptStep` / `AzureWizardExecuteStep`; execute order is by ascending `priority`. Steps marked *draft* mutate the in-memory `RevisionDraftFileSystem` and **make no ARM call** until `deployRevisionDraft` runs.

### 5.1 Cross-cutting step conventions

- `getVerifyProvidersStep()` (priority 90) is prepended to every create/deploy flow and registers `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.ContainerRegistry`.
- `ResourceGroupCreateStep` / `ResourceGroupListStep` / `LocationListStep` / `VerifyProvidersStep` come from `@microsoft/vscode-azext-azureutils`. `LocationListStep.addStep()` injects the location prompt at the call site.
- `*StartingResourcesLogStep` subclasses of `StartingResourcesLogStep` are prompt steps that never prompt — they only write the "starting resources" block into the activity log / output channel.
- `RevisionDraftDeployPromptStep` is appended to **every** draft-mutating command (see 5.9).
- `OverwriteConfirmStepBase` / `ContainerAppOverwriteConfirmStep` warn when the target app uses features the extension cannot round-trip (telemetry `hasUnsupportedFeatures`).

### 5.2 `createManagedEnvironment` — `containerApps.createManagedEnvironment`

| Prompt steps (ordered) | Prompts | Default | Validation | `shouldPrompt` |
|---|---|---|---|---|
| `ManagedEnvironmentNameStep` | environment name | picked RG name | 4–20 chars, `^[a-z]([-a-z0-9]*[a-z0-9])?$`, async availability via `managedEnvironments.get` | `!managedEnvironment && !newManagedEnvironmentName` |
| `LocationListStep` (injected) | location | — | filtered to `Microsoft.App/managedEnvironments` + `Microsoft.OperationalInsights/workspaces` | `!location` |

| Execute steps | Priority | ARM call | `shouldExecute` |
|---|---|---|---|
| `getVerifyProvidersStep` | 90 | RP registration | always |
| `ResourceGroupCreateStep` | 100 | `resourceGroups.createOrUpdate` | `!resourceGroup` |
| `LogAnalyticsCreateStep` | 220 | `operationalInsights.workspaces.beginCreateOrUpdateAndWait` | `!logAnalyticsWorkspace` |
| `ManagedEnvironmentCreateStep` | 250 | `managedEnvironments.beginCreateOrUpdateAndWait` with `appLogsConfiguration.destination = 'log-analytics'` (shared keys pulled from the workspace) and `workloadProfiles: [{ name: 'Consumption', type: 'Consumption' }]` | `!managedEnvironment` |

**Provisioning topology:** `Microsoft.Resources/resourceGroups` -> `Microsoft.OperationalInsights/workspaces` -> `Microsoft.App/managedEnvironments` (primary). Subscription-scope deployment. **No tags applied.** Output: `context.managedEnvironment`. No basic/advanced split. Post-execution: `ext.branchDataProvider.refresh()`, activity-log tree item; **no** notification.

### 5.3 `createContainerApp` — `containerApps.createContainerApp`

Requires a `ManagedEnvironmentItem` (else `pickEnvironment`). Context is seeded with `imageSource = ImageSource.QuickstartImage`.

| Prompt steps | Prompts | Validation | `shouldPrompt` |
|---|---|---|---|
| `ContainerAppCreateStartingResourcesLogStep` | (log only) | — | always |
| `ContainerAppNameStep` | app name | 1–32 chars, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, async availability via `containerApps.get` | `!containerApp && !newContainerAppName` |
| `ImageSourceListStep` | Quickstart / Container Registry / Workspace project | — | `!imageSource` |
| *sub-wizards* | see 5.7 (registry) and 5.8 (remote ACR build) | | |

| Execute steps | Priority | Behavior | `shouldExecute` |
|---|---|---|---|
| `getVerifyProvidersStep` | 90 | RP registration | always |
| `QuickStartImageConfigureStep` | 610 | no ARM — sets `image = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'`, `enableIngress = true`, `targetPort = 80` | `!image && imageSource === QuickstartImage` |
| `ContainerAppCreateStep` | 620 | `containerApps.beginCreateOrUpdateAndWait` with `configuration.activeRevisionsMode = 'Single'`, ingress/secrets/registries, `template.containers[0]` | `!containerApp` |
| `ContainerAppStartVerificationStep` | 690 | see 5.11 (added by `ContainerAppCreateStep.addExecuteSteps()` unless Quickstart) | `!!containerApp` |

**Provisioning topology (Quickstart default):** only `Microsoft.App/containerApps`; the environment must already exist. Other image sources may additionally create `Microsoft.ContainerRegistry/registries` and a role assignment (5.7/5.8). **No tags applied.**

Post-execution: `showContainerAppNotification(createdApp)` — info message with a **Browse** button when ingress is enabled (-> `browseContainerApp`); inner telemetry callback `containerApps.showCaNotification` records `clicked: 'canceled' | 'browse'`.
Telemetry: `CreateContainerAppTelemetryProps = AzdTelemetryProps & ImageSourceTelemetryProps & IngressTelemetryProps`.

### 5.4 `deployWorkspaceProject` — `containerApps.deployWorkspaceProject`

The most complex flow: **three** chained `AzureWizard`s.

**Wizard 0 — V1->V2 settings migration** (`convertV1ToV2SettingsSchema`): `RootFolderStep` prompt + `ConvertSettingsStep` execute (priority **50**). Runs on every invocation; when V1 keys exist and no V2 array does, it maps the three V1 names into a V2 entry (`label: ''`, `type: 'AcrDockerBuildRequest'`, empty paths), writes the V2 array, clears the V1 keys, and logs "Detected deprecated deployment settings...".

**Wizard 1 — configuration selection** (`getWorkspaceDeploymentConfiguration`; a sibling `getTreeItemDeploymentConfiguration` handles the tree-node entry path):

| Step | Role | `shouldPrompt` |
|---|---|---|
| `RootFolderStep` | pick workspace root | `!rootFolder` |
| `DeploymentConfigurationListStep` | pick a saved V2 config or "create new" | `!deploymentConfigurationSettings` |
| `EnvUseRemoteConfigurationPromptStep` | when local `.env` differs from the deployed config, choose which wins | deep-equal comparison |
| `DockerfileValidateStep`, `SrcValidateStep`, `EnvValidateStep` (execute) | validate the saved relative paths still resolve | existing config picked |
| `ResourceGroupVerifyStep`, `ContainerAppVerifyStep`, `ContainerRegistryVerifyStep` (execute, all extend `AzureResourceVerifyStepBase`) | verify the saved Azure resources still exist | existing config picked |
| `DeploymentModeListStep` | **Basic** vs **Advanced** | `!deploymentConfigurationSettings && !deploymentMode` |

**Wizard 2 — deployment** (`deployWorkspaceProjectInternal`):

*Basic prompts (ordered):* `RootFolderStep` -> `SharedResourcesNameStep` (one name derives RG + managed environment + registry; default `sanitizeResourceName(rootFolder.name)`) -> `AppResourcesNameStep` (container app name; default `sanitizeResourceName(<Dockerfile parent dir>)`; skipped when `suppressContainerAppCreation`) -> `LocationListStep` -> `ImageSourceListStep` (pre-set `RemoteAcrBuild`) -> *remote-build sub-wizard (5.8)* -> `IngressPromptStep` (+ `IngressVisibilityStep`, `TargetPortInputStep`) -> `DeployWorkspaceProjectConfirmStep` (modal; skipped when `suppressConfirmation`) -> `StartingResourcesLogStep` -> `ShouldSaveDeploySettingsPromptStep` (modal Save / Don't save; skipped when nothing changed).

*Advanced prompts (ordered):* `RootFolderStep` -> `ManagedEnvironmentListStep` (ordered by `ManagedEnvironmentSortByLocalSettingsStrategy`; "create new" sub-wizard = `ManagedEnvironmentNameStep` + `ResourceGroupListStep` + `LocationListStep` + the Log Analytics/environment execute steps) -> `ResourceGroupListStep` -> `AcrListStep` (ordered by `AcrDefaultSortStrategy`; "create new" sub-wizard = `RegistryNameStep` + `SkuListStep` + `LocationListStep` + `RegistryCreateStep`) -> `ContainerAppListStep` (`updateIfExists = true`; "create new" sub-wizard = `ContainerAppNameStep` + `ResourceGroupListStep` + `LocationListStep` + `ContainerAppCreateStep`) -> then identical to Basic from `ImageSourceListStep` onward.

| Execute steps | Priority | Behavior | Notes |
|---|---|---|---|
| `getVerifyProvidersStep` | 90 | RP registration | |
| `ResourceGroupCreateStep` | 100 | create RG | Basic only |
| `LogAnalyticsCreateStep` | 220 | create workspace | Basic only |
| `ManagedEnvironmentCreateStep` | 250 | create environment | Basic only |
| `RegistryCreateStep` | 350 | `registries.beginCreateAndWait` | Basic only, **SKU hardcoded to `Basic`** |
| `ManagedEnvironmentIdentityEnableStep` | 450 | `managedEnvironments.beginUpdateAndWait` -> `identity.type = 'SystemAssigned'` | only when no `principalId` |
| `AcrEnableAdminUserStep` | 450 | `registries.beginUpdateAndWait` -> `adminUserEnabled = true` | Docker-login path only |
| `AcrPullEnableStep` | 460 | `roleAssignments.create` (AcrPull on the registry for the environment identity), pre-checked via `listForScope` | managed-identity path only |
| `DockerLoginRegistryCredentialsAddConfigurationStep` / `ManagedIdentityRegistryCredentialsAddConfigurationStep` | 470 | populate `context.newRegistryCredential` | mutually exclusive |
| `RegistryCredentialsAndSecretsConfigurationStep` | 480 | merge credential + secret into `registryCredentials` / `secrets` | |
| `TarFileStep` | 520 | temp `sourceArchive<rand>.tar.gz` path | |
| `UploadSourceCodeStep` | 530 | tar + blob upload (see Section 7) | |
| `RunStep` | 540 | `registries.beginScheduleRunAndWait` (`DockerBuildRequest`), 3 retries / 2 s min | |
| `BuildImageStep` | 550 | read `run.outputImages[0]` -> `context.image` | |
| `ContainerAppCreateStep` | 620 | create app | new app only |
| `ContainerAppUpdateStep` | 680 | update app (4 retries) | existing app only |
| `DeployWorkspaceProjectSaveSettingsStep` | 1480 | write V2 settings to `.vscode/settings.json`, `continueOnFail = true` | when `shouldSaveDeploySettings` |

**Full greenfield (Basic) provisioning topology** — subscription-scope, created in dependency order:

| # | ARM type | Created by | Depends on |
|---|---|---|---|
| 1 | `Microsoft.Resources/resourceGroups` | `ResourceGroupCreateStep` | subscription |
| 2 | `Microsoft.OperationalInsights/workspaces` | `LogAnalyticsCreateStep` | RG |
| 3 | `Microsoft.App/managedEnvironments` | `ManagedEnvironmentCreateStep` | RG + workspace (shared keys) |
| 4 | system-assigned identity (property on #3) | `ManagedEnvironmentIdentityEnableStep` | #3 |
| 5 | `Microsoft.ContainerRegistry/registries` (SKU `Basic`) | `RegistryCreateStep` | RG |
| 6 | `Microsoft.Authorization/roleAssignments` (AcrPull) | `AcrPullEnableStep` | #4 + #5 |
| 7 | `Microsoft.ContainerRegistry/registries/runs` | `RunStep` | #5 + uploaded source |
| 8 | `Microsoft.App/containerApps` (**primary**) | `ContainerAppCreateStep` | #3 + built image from #7 |

**No tags are applied to any resource.** Outputs consumed downstream: `context.managedEnvironment`, `context.registry`, `context.image`, `context.containerApp` — and, for the exported API, the whole `DeployWorkspaceProjectResults` shape including `registryUsername` / `registryPassword`.

**Basic vs Advanced delta:** Basic derives all names from one prompt and always creates missing resources with a hardcoded registry SKU; Advanced exposes a list-or-create step per resource, lets the user pick the registry SKU, and can target an existing container app (`ContainerAppListStep` in the prompt phase rather than `ContainerAppCreateStep` in the execute phase). `context.advancedCreate` records which.

Post-execution: info message "Finished deploying workspace project to container app ..." with **Browse** (when `targetPort` is set) and **View Output** buttons; `https://<fqdn>` appended to the output channel; `ext.branchDataProvider.refresh()`. The notification is its own telemetry callback `deployWorkspaceProject.displayNotification` recording `userAction: 'canceled' | 'browse' | 'viewOutput'`.

### 5.5 `deployImage` and `deployContainerApp`

| Flow | Command | Shape |
|---|---|---|
| `deployImage` | invoked from a `ContainerItem`; also reachable through the `containerApps.deployImageApi` compat shim and the exported `deployImage` API | `ContainerAppDeployStartingResourcesLogStep` -> `ImageSourceListStep` (+ sub-wizard) -> `ContainerAppOverwriteConfirmStep` (modal "the latest deployment ... will be overwritten" + unsupported-feature warning). Execute: verify providers (90) -> registry credential/build steps (450–550) -> `ContainerAppUpdateStep` (680) -> `ContainerAppStartVerificationStep` (690). Post: `showContainerAppNotification(app, isUpdate = true)`. |
| `deployContainerApp` | `containerApps.deployContainerApp` (+ code-only `containerApps.deployContainerAppInternal`) | Runs `ImageSourceListStep` **before** the wizard: choosing `RemoteAcrBuild` **re-routes the whole command to `deployWorkspaceProject`**; only the `ContainerRegistry` path continues. Then `ContainerAppDeployStartingResourcesLogStep` -> `ImageSourceListStep` -> `ContainerAppOverwriteConfirmStep` -> `OpenConfirmationViewStep` (webview summary; Copilot path only). Copilot path additionally prepends `ManagedEnvironmentListStep` + `ContainerAppListStep` to choose a target. Execute steps identical to `deployImage`. Telemetry: `AzdTelemetryProps & ImageSourceTelemetryProps & OverwriteConfirmTelemetryProps & ConfirmationViewTelemetryProps` + `revisionMode`. |

### 5.6 `createAcr` — `containerApps.createAcr`

Prompts: `RegistryNameStep` (5–50 alphanumeric, async `registries.checkNameAvailability`, suggested from the RG name) -> `SkuListStep` (Basic / Standard / Premium) -> `LocationListStep` (filtered to `Microsoft.ContainerRegistry/registries`).
Execute: `getVerifyProvidersStep` (90) -> `ResourceGroupCreateStep` (100, RG named after the registry) -> `RegistryCreateStep` (350, `registries.beginCreateAndWait`).
Topology: `Microsoft.Resources/resourceGroups` + `Microsoft.ContainerRegistry/registries` (primary). No tags. No notification; returns the `Registry`. Also runs as a sub-wizard from `AcrListStep`.

### 5.7 Image source — Container Registry sub-flow

Injected when `ImageSourceListStep` resolves to `ImageSource.ContainerRegistry`:

`ContainerRegistryListStep` (ACR / Docker Hub / Other) ->
- **ACR:** `AcrListStep` (`suppressCreatePick = true`) -> `AcrRepositoriesListStep` (`@azure/container-registry`, highlights the currently deployed repo) -> `AcrTagListStep` (manifest tags sorted by `lastUpdatedOn`, rendered as relative time via dayjs)
- **Docker Hub:** `DockerHubNamespaceInputStep` (4–30 alphanumeric) -> `DockerHubContainerRepositoryListStep` -> `DockerHubContainerTagListStep` (both paginated with a "load more" pick over the Docker Hub v2 `next` cursor)
- **Other:** `RegistryImageInputStep` (free-text `image:tag`)

-> `RegistryCredentialsAddConfigurationListStep` (only when `requiresRegistryConfiguration`) -> 5.10 -> `ContainerRegistryImageConfigureStep` (`configureBeforePrompt`; assembles the image string, and injects `IngressPromptStep` when the repository changed) -> `EnvFileListStep`.

### 5.8 Image source — Remote ACR build sub-flow (`RemoteAcrBuild`)

Prompts: `AcrListStep` (create-new sub-wizard: `RegistryNameStep` + `SkuListStep` + `LocationListStep` + `RegistryCreateStep`) -> `RegistryCredentialsAddConfigurationListStep` -> `RootFolderStep` (auto-selects when only one folder) -> `DockerfileItemStep` (glob `**/Dockerfile*`, auto-selects when only one) -> `SourcePathStep` (build context; auto-set when the Dockerfile is at the root) -> `ImageNameStep` (default `<containerAppName>:<YYYY-MM-DD_HHMMSS>`) -> `OSPickStep` (Linux / Windows; pre-set to Linux inside `deployWorkspaceProject`) -> `EnvFileListStep`.
Execute: credential steps (450–480) -> `TarFileStep` (520) -> `UploadSourceCodeStep` (530) -> `RunStep` (540) -> `BuildImageStep` (550). Mechanics and the `--platform` Dockerfile rewrite are in Section 7.

### 5.9 Draft-mutating edit flows

All of these write only to `RevisionDraftFileSystem` and end with `RevisionDraftDeployPromptStep`.

| Command | Prompt steps | Execute steps |
|---|---|---|
| `containerApps.editContainer` | `ContainerEditStartingResourcesLogStep`, `ImageSourceListStep` (full sub-tree), `RevisionDraftDeployPromptStep` | `RegistryAndSecretsUpdateStep` (580 — the one exception: pushes changed secrets/credentials to ARM immediately via `updateContainerApp`), `ContainerEditDraftStep` (590, sets name/image/env on the draft) |
| `containerApps.editContainerImage` | as above, image only | `ContainerImageEditDraftStep` |
| `containerApps.addEnvironmentVariable` | `EnvironmentVariableNameStep` (unique within container) -> `EnvironmentVariableTypeListStep` -> either `EnvironmentVariableManualInputStep` or `SecretListStep` (`suppressCreatePick`) -> deploy prompt | `EnvironmentVariableAddDraftStep` |
| `containerApps.editEnvironmentVariables` | `EnvFileListStep` (`suppressSkipPick = true`) -> deploy prompt | `EnvironmentVariablesEditDraftStep` |
| `containerApps.editEnvironmentVariableName` / `...Value` | single input box -> deploy prompt | `EnvironmentVariableEditDraftStep` |
| `containerApps.convertEnvironmentVariable` | converts a plain value to a secret reference (or back) -> deploy prompt | `EnvironmentVariableAddDraftStep` path via `EnvironmentVariableConvertContext` |
| `containerApps.deleteEnvironmentVariable` | `DeleteConfirmationStep` -> deploy prompt | `EnvironmentVariableDeleteDraftStep` |
| `containerApps.editScaleRange` | `ScaleRangePromptStep` (`{min}-{max}`, 0–1000, pre-filled from current) -> deploy prompt | `ScaleRangeUpdateStep` |
| `containerApps.addScaleRule` | `ScaleRuleNameStep` (`^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, unique) -> `ScaleRuleTypeListStep` -> HTTP: `HttpConcurrentRequestsStep`; Queue: `QueueNameStep`, `QueueLengthStep`, `SecretListStep`, `QueueAuthTriggerStep` -> deploy prompt | `AddScaleRuleStep` |
| `containerApps.deleteScaleRule` | `DeleteConfirmationStep` -> deploy prompt | `DeleteScaleRuleStep` |

**`RevisionDraftDeployPromptStep`** reads `containerApps.showDraftCommandDeployPopup`; offers Yes / No / "No, don't ask again" (the last writes `false` to the **global** setting via `updateGlobalSetting`); `configureBeforePrompt` short-circuits to `shouldDeployRevisionDraft = false` when the setting is already off; `shouldPrompt` is `shouldDeployRevisionDraft === undefined`.

### 5.10 Registry credential sub-flows

| Path | Steps |
|---|---|
| **Docker login** (`RegistryCredentialType.DockerLogin`) | prompt `AcrEnableAdminUserConfirmStep` (only when `registryDomain === acrDomain` and admin user is off) -> execute `AcrEnableAdminUserStep` (450) -> `DockerLoginRegistryCredentialsAddConfigurationStep` (470; for ACR calls `listCredentialsFromAcr` for username/password, otherwise uses `context.username`/`context.secret`) -> `RegistryCredentialsAndSecretsConfigurationStep` (480) |
| **Managed identity** (`RegistryCredentialType.SystemAssigned`) | execute only: `ManagedEnvironmentIdentityEnableStep` (450) -> `AcrPullEnableStep` (460) -> `ManagedIdentityRegistryCredentialsAddConfigurationStep` (470; sets `{ identity: 'system-environment', server: <loginServer>, username: '', passwordSecretRef: '' }`) -> `RegistryCredentialsAndSecretsConfigurationStep` (480) |

### 5.11 Non-draft ARM-writing flows

| Command | Prompt | Execute (priority) |
|---|---|---|
| `containerApps.enableIngress` | `IngressPromptStep` -> `IngressVisibilityStep` (external/internal) -> `TargetPortInputStep` | `EnableIngressStep` (750) -> `updateContainerApp` with `configuration.ingress` |
| `containerApps.disableIngress` | — | `DisableIngressStep` (750) -> `ingress: null` |
| `containerApps.editTargetPort` | `TargetPortInputStep` (1–65535) | `TargetPortUpdateStep` |
| `containerApps.toggleVisibility` | modal warning | `ToggleIngressVisibilityStep` (750) -> flips `ingress.external` |
| `containerApps.addSecret` | `SecretNameStep` (unique) -> `SecretValueStep` (masked) | `SecretCreateStep` (820) -> `getContainerEnvelopeWithSecrets` + append + `updateContainerApp` |
| `containerApps.editSecretValue` | `SecretValueStep` | `SecretValueUpdateStep` |
| `containerApps.deleteSecret` | `SecretDeleteConfirmStep` (modal) | `SecretDeleteStep` (200) |
| `containerApps.chooseRevisionMode` | `ChooseRevisionModeStep` -> `ChooseRevisionModeConfirmStep` (warns that an existing draft will be discarded) | `ChangeRevisionModeStep` (200) -> `activeRevisionsMode`; then discards the draft |
| `containerApps.deployRevisionDraft` | `DeployRevisionDraftConfirmStep` (modal + unsupported-feature warning) | `DeployRevisionDraftStep` (1450) -> `getContainerEnvelopeWithSecrets` + draft `template` + `updateContainerApp`, then re-fetches to learn the new revision name and discards the draft. Telemetry callback `revisionDraftUpdateBaseStep.deploy` with `commandUpdatesCount`, `directUpdatesCount`, `revisionMode`. |
| `containerApps.deleteManagedEnvironment` | `DeleteEnvironmentConfirmationStep` — modal button **or** type-the-name input, per the `containerApps.deleteConfirmation` setting | `DeleteAllContainerAppsStep` (100, deletes every app in the environment) -> `DeleteManagedEnvironmentStep` (110; treats HTTP 204 as success) |
| `containerApps.disconnectRepo` | `DisconnectRepositoryConfirmStep` (modal, shows the parsed repo name) | `GitHubRepositoryDisconnectStep` (300) |
| `containerApps.deleteContainerApp` | delete-confirmation via the shared framework step | `ContainerAppItem.delete()` -> `containerApps.beginDeleteAndWait` (the wizard lives in `ContainerAppItem.ts`, not under `commands/`) |
| `containerApps.startStreamingLogs` / `stopStreamingLogs` | `RevisionListStep` -> `ReplicaListStep` -> `ContainerListStep` / `StreamListStep` | no execute steps — the stream itself is opened after the wizard (see Section 7) |

**Shared execute steps:**
- `ContainerAppUpdateStep` (680) — `getContainerEnvelopeWithSecrets`, merge ingress + secrets + registries + `template.containers`, then `updateContainerApp` -> `containerApps.beginCreateOrUpdateAndWait`. 4 retries at 2 s minimum, retrying **only** on "authentication required" when using docker-login credentials. Adds `ContainerAppStartVerificationStep`.
- `ContainerAppStartVerificationStep` (690) — phase 1 polls `listRevisions` up to 15 s until the new revision (matching `latestRevisionName` + `image`) appears; phase 2 polls `getRevision` up to 120 s until `runningState` leaves `Processing`/`Activating`/`Provisioning`/`Deprovisioning`. If the result is neither `running` nor `scaledToZero`, it queries the Log Analytics workspace table `ContainerAppConsoleLogs_CL` for the last 5 minutes via `logsQueryClient.queryWorkspace` and attaches the output to `context.activityAttributes.logs` **so Copilot can explain the failure**. Telemetry: `revisionStatus`, `addedContainerAppStartLogs`, `getLogsQueryError`, `targetCloud`.

### 5.12 Non-wizard interactive flows (~15)

`activateRevision`, `deactivateRevision`, `restartRevision` (direct `containerAppsRevisions.activateRevision` / `deactivateRevision` / `restartRevision` via `changeRevisionActiveState`); `createRevisionDraft`, `editRevisionDraft`, `discardRevisionDraft` (direct file-system operations); `editContainerApp` (opens the draft document); `connectToGitHub` (portal deep link); `browse`, `openConsoleInPortal`, `revealInEnvironment`, `openGitHubRepo`, `openAcrBuildLogs`, `toggleEnvironmentVariableVisibility`; the five walkthrough commands; `reportIssue`.

### 5.13 Detection logic (no framework/build presets)

The extension has **no framework detectors and no build-preset table** (unlike the Static Web Apps extension) — the build contract is always "there is a Dockerfile". Detection is limited to:

| Helper | Inspects | Produces |
|---|---|---|
| `tryGetDockerfileExposePorts` | the selected Dockerfile | scans `EXPOSE` lines (case-insensitive); single ports via `` /(?<=\s)\d{2,5}(?!(\-)|(\/udp))\b/g ``, ranges via `/\d{2,5}\-\d{2,5}/g`; returns `PortRange[]` or `undefined` |
| `getDefaultPort` | detected ranges + the currently deployed port | keeps the current port when it falls inside a detected range; else the first detected range start; else the current port; else **`80`**. Sets telemetry `suggestedTargetPort`. |
| `IngressPromptStep.configureBeforePrompt` | the above | when ports are found and `!alwaysPromptIngress`: sets `enableIngress = true`, `enableExternal = <current> ?? true`, `targetPort = getDefaultPort()` and **skips the prompt entirely**; when none are found: sets both to `false` and also skips |
| `EnvFileListStep` | `*.{env,env.*}` across the workspace | `SetEnvironmentVariableOption` = `NoDotEnv` \| `SkipForNow` \| `ProvideFile` (parsed with `dotenv.parse`) \| `UseExisting`. Telemetry `setEnvironmentVariableOption`, `environmentVariableFileCount`. |
| `DockerfileItemStep` | `dockerfileGlobPattern` (case-insensitive `Dockerfile`, `*.Dockerfile`, `Dockerfile.*`) | the Dockerfile to build; auto-selects when only one |
| `isAzdExtensionInstalled` / `azure.yaml` | workspace + installed extensions | telemetry only (`isAzdExtensionInstalled`, `isAzdWorkspaceProject`, `dockerfileCount`) |

### 5.14 Wizard telemetry interfaces (`src/telemetry/**`)

`AzdTelemetryProps`, `ImageSourceTelemetryProps` (`imageSource`, `registryDomain`, `registryName`, `hasRegistrySecrets`, `acrCount`, `sameRgAcrCount`, `newRegistryCredentialType`), `BuildImageInAzureTelemetryProps` (`imageBaseOs`, `outputImagesCount`, `sourceDepth`, `buildCustomDockerfile`, `hasWorkspaceProjectOpen`), `WorkspaceFileTelemetryProps` (`setEnvironmentVariableOption`, `environmentVariableFileCount`), `IngressTelemetryProps` (`dockerfileExposePortRangeCount`, `enableIngress`, `enableExternal`, `suggestedTargetPort`, `targetPort`), `OverwriteConfirmTelemetryProps` (`hasUnsupportedFeatures`), `ContainerTelemetryProps` (`containersIdx`, `basedOnLatestRevision`), `ContainerAppStartVerificationTelemetryProps`, `ConfirmationViewTelemetryProps`, `deployWorkspaceProjectTelemetryProps` (`revisionMode`, `existingResourceGroup`/`Environment`/`Registry`/`ContainerApp`/`Location`, `hasNewSettings`, `shouldSaveDeploySettings`, `recommendedEnvCount`, `usedRecommendedEnv`, `choseExistingWorkspaceConfiguration`, `deploymentMode`, `useRemoteEnvConfiguration`), `commandTelemetryProps`, `SetTelemetryProps`.

---

## 6. Config-file features (A + B)

| Feature | Layer | Details |
|---|---|---|
| `jsonValidation` | A | `*.containerapp-template.json` -> `https://json.schemastore.org/azure-containerapp-template.json`. Gives schema IntelliSense inside the revision-draft virtual document. |
| Revision draft virtual file system | B | `RevisionDraftFileSystem` implements `vscode.FileSystemProvider` under scheme **`containerAppsRevisionDraft`**. URI shape: `containerAppsRevisionDraft:/<shortSubId>.../resourceGroups/<rg>/containerApps/<app>.containerapp-template.json`. In-memory `Map` store keyed by URI path — **one draft per container app**. Each `RevisionDraftFile` holds `contents` (serialized ARM `Template`), `containerApp`, `baseRevisionName`, `commandUpdatesCount`, `directUpdatesCount` (the last two feed telemetry about command-driven vs hand-edited drafts). `readDirectory`/`createDirectory`/`rename` throw. `onDidChangeFile` is debounced 5 ms (`fireSoon`). On create/write it fires `azureResourceGroups.revealResource` for the parent environment and `ext.state.notifyChildrenChanged`. Discard deletes the entry and force-closes matching editor tabs. |
| Workspace deploy settings | B | `.vscode/settings.json` in the workspace folder; V2 key `containerApps.deploymentConfigurations` (array), V1 keys `containerApps.deployWorkspaceProject.*` (see Section 2). V1->V2 migration via `convertV1ToV2SettingsSchema` / `ConvertSettingsStep`. Helpers split across `dwpSettingUtilsV1.ts` / `dwpSettingUtilsV2.ts`. |
| `.env` files | B | `EnvFileListStep` discovers `*.{env,env.*}` (`envFileGlobPattern`) and `dotenv` parses them into container env vars; `EnvValidateStep` / `EnvUseRemoteConfigurationPromptStep` decide between the local file and the remote app's existing configuration. |
| Dockerfiles | B | Discovered via `dockerfileGlobPattern` (case-insensitive `Dockerfile`, `*.Dockerfile`, `Dockerfile.*`). `tryGetDockerfileExposePorts` parses `EXPOSE` directives to default the ingress target port. |
| `azure.yaml` | B | Detected only to set the `isAzdWorkspaceProject` telemetry property (with `isAzdExtensionInstalled` for `ms-azuretools.azure-dev`). **No functional azd integration** — no `azd` CLI is ever invoked. |

---

## 7. External integrations (B)

| Integration | Details |
|---|---|
| **Log streaming** | HTTP chunked streaming, **not** WebSocket. `containerApps.getAuthToken(rg, app)` (ARM) yields a short-lived data-plane token; `createGenericClient` with `redirectOptions.allowCrossOriginRedirects = true` (required since `@azure/core-rest-pipeline` >= 1.23) GETs the per-container `logStreamEndpoint` (`*.azurecontainerapps.io`) with `streamResponseStatusCodes: {200}`; the Node readable stream is piped into an `OutputChannel` named `"<replica> (<container>)"`. Active streams tracked in a module-level `Map` keyed by `containerId + logStreamEndpoint`, each with an `AbortController`. Selection wizard: `RevisionListStep` (auto-skips in single-revision mode or when there is 1 revision) -> `ReplicaListStep` (errors when 0 replicas) -> `ContainerListStep`; stop flow uses `StreamListStep` with a "stop all" option. Instrumented as `containerApps.streamingLogs`. |
| **GitHub** | Auth via `getGitHubAccessToken()` from `@microsoft/vscode-azext-github`: VS Code auth provider `'github'`, scopes `['repo', 'workflow', 'user:email', 'read:user']`. **No Octokit.** `connectToGitHub` cannot complete in-extension (needs service principals + federated credentials) so it deep-links to the portal at `<appId>/deployment`. `disconnectRepo` calls ARM `containerAppsSourceControls.beginDeleteAndWait(rg, app, 'current', ...)` passing the GitHub token in the custom header **`x-ms-github-auxiliary`** (the source-control name is always the literal `'current'`). `openGitHubRepo` opens `<repoUrl>/tree/<branch>`. Actions tree node comes from `ActionsItemBase`. |
| **Azure SDK clients** (`utils/azureClients.ts`) | `@azure/arm-appcontainers` (`ContainerAppsAPIClient`), `@azure/arm-containerregistry`, `@azure/container-registry` (`ContainerRegistryClient`, audience `AzureResourceManagerPublicCloud`, endpoint `https://<loginServer>`), `@azure/arm-operationalinsights`, `@azure/arm-authorization` (swaps to the `-profile-2020-09-01-hybrid` package for custom clouds), `@azure/monitor-query` `LogsQueryClient` (credential scope `https://api.loganalytics.io/.default`), `@azure/arm-resources`, `@azure/storage-blob`. Most are lazily `import()`ed for activation performance. |
| **Resource provider registration** | `getVerifyProvidersStep()` registers `Microsoft.App`, `Microsoft.OperationalInsights`, `Microsoft.ContainerRegistry` before provisioning. |
| **Docker Hub** | Unauthenticated Docker Hub v2 REST via `sendRequestWithTimeout` (5 s): `https://hub.docker.com/v2/repositories/{namespace}` and `.../{namespace}/{name}/tags`, cursor-paginated via the response `next` link. Public namespaces only. |
| **ACR remote build** | `registries.getBuildSourceUploadUrl` -> pre-signed blob `uploadUrl`; workspace tarred (excluding `.git`, `.gitignore`, `.bzr`, `.hg`, `.svn`) to `os.tmpdir()/sourceArchive<rand>.tar.gz` and uploaded with `BlockBlobClient.uploadFile`; `registries.beginScheduleRunAndWait` with a `DockerBuildRequest` (`isPushEnabled: true`, `platform.os` from the OS pick); polled via `runs.get` every 5 s while `Started`/`Queued`/`Running`; on failure `runs.getLogSasUrl` downloads the log and surfaces a "View Logs" button -> `openAcrBuildLogs` opens it as read-only content. **`--platform=` is stripped from `FROM` lines** before upload (ACR does not support it — Azure/acr#697), by writing a patched Dockerfile into a temp UUID dir and `tar.r`-appending it over the original. |
| **Webviews** | Two React (Fluent UI v9) panels, created on demand — `confirmationView` (panel type `react-webview-confirmationView`) and `loadingView` (`react-webview-loadingView`), both `ViewColumn.Active`, registered in a static `WebviewRegistry` map and bundled separately (`esbuild.views.mjs` -> `dist/views.js` / `dist/views.css`). CSP with a per-load nonce. Messages webview->extension: `cancel`, `confirm` (carries `itemsToClear` for wizard back-navigation), `copilot` (opens `workbench.action.chat.open` in agent mode with a generated explain-this-field prompt). Extension->webview: `addProgressItem`. Driven by `OpenLoadingViewStep` / `OpenConfirmationViewStep`, which translate the result into `GoBackError(itemsToClear)` / `UserCancelledError`. Post-confirm satisfaction survey links to `https://aka.ms/AAx0tw1`. `SharedViewState` is a mutable module-level singleton (`itemsToClear`, `cancelled`, `copilotClicked`, `editingPicks`, `currentPanel`, `loadingViewController`). A generic `Channel`/`Transport` RPC layer exists in `src/webviews/Channel/**` but is **not wired up** (placeholder for a future tRPC migration). |
| **Copilot** | `deployWithCopilot` swaps `context.ui` for `CopilotUserInput` from `@microsoft/vscode-azext-utils/copilot`, calls `markAsCopilotUserInput`, then runs the ordinary `deployContainerApp`. No direct `vscode.chat` usage in this repo. `@github/copilot-sdk` is a dependency. |
| **Host extension dependencies** | Commands executed against `ms-azuretools.vscode-azureresourcegroups`: `azureResourceGroups.openInPortal`, `azureResourceGroups.revealResource`, `azureResourceGroups.focus`, `azureResourceGroups.logIn`, `azureResourceGroups.deleteResourceGroupV2`. Plus the API `ext.rgApiV2.resources.revealAzureResource` / `registerAzureResourceBranchDataProvider` / `azureResourceTreeDataProvider`. Also executes the built-in `git.clone` and `workbench.action.openWalkthrough`. |
| **Portal URLs** | `createPortalUrl` builds `<environment.portalUrl>[?<queryPrefix>]#@<tenantId>/resource<id>` — sovereign-cloud aware. |
| **Proposed APIs** | `vscode.proposed.authenticationChallenges.d.ts` and `vscode.proposed.authLearnMore.d.ts` are vendored, but `enabledApiProposals` is **not** declared and no code path consumes them. Forward-compat scaffolding only — do not migrate. |
| **Web/browser target** | `src/browser/fs-extra.ts` is an empty stub next to the real `src/node/fs-extra.ts`, but there is **no `browser` field** in `package.json` and no browser bundle. The extension is Node-host only despite `virtualWorkspaces: limited`. |

---

## 8. Docs layer (C) — supplementary only

Consulted:
- `https://code.visualstudio.com/docs/azure/containerapps` — **404. There is no VS Code docs page for this extension.**
- `https://code.visualstudio.com/docs/azure/deployment` — generic Azure deployment hub; does not mention Container Apps specifically.
- Marketplace page / repo `README.md` (the same content) — the only real user-facing documentation.
- Repo `CHANGELOG.md` — used for feature intent and dating.
- In-product walkthrough markdown under `resources/walkthrough/*.md`.

Doc-derived intent (unverified against code where noted):
- The README frames **`Deploy Project from Workspace...` as the headline entry point**: it analyses the project directory, auto-detects Dockerfiles, generates all required Azure resources, supports monorepos, and saves settings for fast re-deploy. This matches the code.
- The README states draft support is **limited to**: "Scaling commands, Update Container Image..., Edit Container App (Advanced)". The code's draft coverage is broader (containers, env vars, scale range, scale rules, image) — **the docs are stale here; trust the code.**
- The README documents the `*` suffix + "Unsaved changes" tag and the inline cloud icon for deploying a draft — matches `RevisionDraftDescendantBase` and the `inline@1` menu entries.
- Sample projects live at `https://aka.ms/ContainerAppsSamples`.
- Nothing in the docs describes the context-menu commands, the settings, the exported API, or the tree hierarchy. Docs removed **no** feature found in code/manifest.

---

## 9. Usage Summary (telemetry)

- Cluster / window / collected-on: `ddtelvscode`.`VSCodeExt`.`RawEventsVSCodeExt` · **90d** · **2026-08-21**. Query returned **66 distinct EventNames**.
- **Raw counts are deliberately not committed** (repo policy). The full ranked table with `ExternalUsers` / `Succeeded` / `Failed` / `Canceled` / `LastSeen` per event lives only in the session artifacts dir as `aca-telemetry-90d.csv` alongside `USAGE-working.md`.
- Reconciliation result: **every contributed command except `containerApps.deployWorkspaceProjectApi` produced a telemetry row.** That one absence is explained — it has no handler at all (Section 1), so it is genuinely un-invocable rather than merely unused.
- **No callback in the extension sets `suppressIfSuccessful` or `suppressAll`**, so no count is artificially deflated; low counts are real adoption signals.
- Internal (`IsInternal == true`) users are **zero for every event** — no dev/test-only surfaces to strip.
- Framework / plumbing rows with no user feature: `call-tas-error`, `unhandlederror`, `getresourceitem`, `getchildren`, `managedenvironmentitem.getchildren`, `containerappitem.getchildren`, `getactionschildren`, `getsourcecontrol`, `revisiondraftitem.hasunsavedchanges.getrevisions`. The tree-expansion events dominate volume and confirm the tree itself is the most-exercised surface by a wide margin.
- Cross-checks worth carrying into triage:
  - `containerApps.deployContainerAppWithCopilot` — **100% failure rate** in the window. Migrate + fix, or deliberately re-scope; do not read its low count as disinterest.
  - `containerApps.createManagedEnvironment` — failures outnumber successes. Reliability work, not a drop.
  - `containerApps.startStreamingLogs` / `stopStreamingLogs` — meaningful failure share on top of the highest command usage in the extension.
  - Many single-purpose edit commands (`enableIngress`, `disableIngress`, `toggleVisibility`, `activateRevision`, `deactivateRevision`, `deleteScaleRule`, `openGitHubRepo`, `createAcr`) are **cancel-dominant with near-zero successes**. That is a "users open it and back out" signal, distinct from failure — a UX question for the human, and a good argument for folding several of them into a single edit surface in the monorepo.
  - `containerApps.revealInEnvironment` — bottom of the distribution, but shipped only in 0.11.1 (2026-05-28); **small-N / short-exposure guardrail applies**, do not drop on the count alone.

Re-run the roll-up with the deeplink at the top of this file. Per-feature drill-down (edit the `feature` line):

```kusto
let ext = 'ms-azuretools.vscode-azurecontainerapps';
let feature = 'containerapps.deployworkspaceproject';  // <-- any callbackId
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

[Open the per-feature drill-down in ADX](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAACpWRvY7bMBCEez%2FFdpQA%2FqQNHKU5OICKBEGcXBOkWJNjmzmKFLgryz7cwweyLBspryK4s%2FPNchmghLNSRaaRBb92GZpSkOVJbHIYKzZFZR%2BRuW3FrGcBSnuwdhmD8T956dCGdOlTfpGWLdqc%2FsKqWROtVvRpsSB75HgAaSKOF7Icwo7tS%2B2u2N5Hl3qq6OMHt57Z0IkiF8Y5RRhHMuXSsfKOBYV53j4lh81ZTbn8wf3mhKhyL87eqD8ig7bIJ%2BSfvoEoNy19Jj6kYswq712bsyKKT%2FEbN6CqGhbzEAf0JIhmy1rgrHMyKzOftjGwpGsazv4VMyKiOp6SZfUpChFVZFMXtSjnV3EIzJHDL0EWqshdVb8vxhd8ZXv0EbWbUy11HHuH%2BD0HwY2x7awFHNxwmQL8vtAkmn08FN9zapHVQ36bDOmCmj%2FlQDF3q7mxvrAPN9B7WaN1Aj1xtLij3gWarKa8knaXx7c8Iw%2FH7I1SdsiT9tigg9h%2FIywnq9ECAAA%3D)

---

## Migration-relevant cross-cutting notes

- **Host-API dependence is total.** The extension has no view of its own; it is two branch data providers plus commands gated on the host's `viewItem` context values. In the monorepo this becomes `DataProvider` / `ViewProvider` registrations in `registerTrees.ts` and `ManagedCommand`s with static `ContextValue` properties. The 50 hand-written `when` regexes collapse into the monorepo's `viewItem =~ /\bcontextValue\b/i` convention — note the source regexes use bare substrings with no `\b`, so `containerItem` currently also matches `containersItem`; the `(.*)` two-token clauses (`containerAppItem(.*)revisionMode:single`) are the pattern the monorepo would express as multiple context values on one node.
- **Shared-lib coupling to strip:** `@microsoft/vscode-azext-utils` (`AzureWizard`, `IActionContext`, `createContextValue`, `registerCommandWithTreeNodeUnwrapping`, `TreeElementStateManager`, `CopilotUserInput`), `@microsoft/vscode-azext-azureutils` (`createAzureClient`, `createGenericClient`, `VerifyProvidersStep`, `uiUtils.listAllIterator`), `@microsoft/vscode-azext-github` (`ActionsItemBase`, `getGitHubAccessToken`), `@microsoft/vscode-azureresources-api`. Each has a monorepo counterpart (`azutils` clients, DI, `ActionExecutor`, wizard framework) — the ACA-specific ARM calls in `utils/azureClients.ts` need wrapper functions in `packages/azutils/src/rest/clients/` with the `@azure/arm-appcontainers` types re-exported.
- **Icons:** `resources/*.svg` are hand-referenced via `treeUtils.getIconPath(name)`. The monorepo resolves resource icons by convention from `<logicalType>.toLowerCase() + '.svg'` — `Microsoft.App/managedEnvironments` and `Microsoft.App/containerApps` will need `logicalType()` branches and matching filenames, and the non-resource icons (containers, scaling, secrets, dapr light/dark, revision-management, revision-draft, virtual-network) need a home outside that convention.
- **The revision-draft model is the most distinctive and highest-risk piece.** It is a virtual `FileSystemProvider` + an in-memory diff against ARM templates + `*`-suffixed labels + `unsavedChanges:*` context values + a deploy/discard pair, and it threads through nearly every edit command (each edit command has a `...DraftStep` variant). It has no analogue in the monorepo today. Its own usage is low but it is load-bearing for `editContainerApp` (moderate usage) — treat it as one indivisible feature decision, not per-command.
- **Two-tier deploy story to rationalize:** `deployWorkspaceProject` (build from source via ACR, creates the whole resource topology, saves settings) vs `deployContainerApp` (deploy an existing image). Both are heavily used; the monorepo's azd+Bicep creation path should be mapped against `deployWorkspaceProject`'s provisioning topology in Section 5.
- **Webviews are a genuinely new capability** for the monorepo (React + Fluent UI, separate esbuild bundle, CSP, panel RPC). They currently back only the deploy-confirmation summary and a loading view. Decide explicitly whether to carry them or fall back to quick-pick confirmation.
- **Deliberate non-migrations:** the 3 dead NLS keys, the `deployWorkspaceProjectApi` contribution (keep the API method, drop the command), the unused `vscode.proposed.*` d.ts files, the empty `src/browser/fs-extra.ts` stub, and the unwired `src/webviews/Channel/**` RPC layer.
- **Bugs to fix rather than port:** the `DaprItem` description/contextValue swap (Section 3), and the two distinct `getChildren` telemetry callbacks sharing one id (`ConfigurationItem` and `RevisionsItem`), which makes those two tree paths indistinguishable in telemetry.
