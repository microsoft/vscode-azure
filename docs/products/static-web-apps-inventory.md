# Azure Static Web Apps - Feature Inventory

Source: `microsoft/vscode-azurestaticwebapps` @ `84d7c8da77e431c3f1c115d88b851a3b3bbb4464`, v0.13.3, publisher `ms-azuretools`.
Target checked: `vscode-azure` branch `alex/swa` in this working tree.
Method: reconciled source `package.json` + `package.nls.json` + source code (`src/`) + source README + target monorepo implementation and package contributions. Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative manifest, **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: not collected for this artifact because the PR task explicitly said not to run telemetry queries. No raw telemetry results are included. Derived event names use the source convention `ms-azuretools.vscode-azurestaticwebapps/<callbackId>` lowercased. Roll-up query deeplink: [all SWA events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WST2vjMBDF7%2F4U05MscEKvS1EvJYXAZimb3V6WpUykSSvQn6AZ23HJhy%2B2SSill1yf3o83j6dAAnQUMKAiL%2FC9LSQ5B152bLOjWWFB8banHR4OrO6qQAK9Ty73YODHrburbGhZqNTKOaEws0ovHQrukKlWz9uH7Gh1FKWXv7FfdZSEL2J1gv6NCsGWSkflj49jZjzAPeBrrucsfXGtjkKJfU6%2FMBIYMza4PEpmKT691k8lH6iIJ%2F6nPKMV36H4nGjMVv813BhQUlpS1Qm4jRGLfydYpy7bycjG5jZJrZspsSQMf5kKGzfpfl%2FPBTZo33yitWtgzes0O8ez9hiYdANn7Tp6PE03sG2tJXLkzJn7tmEhbsNUyxhQF0jpBh7Rh%2BvwmRjZB0yWrqTPzMj%2FRJYtUTL7XCLKi0Mh8ZHqiMf6y9q6ATUMw7DYbBbOKQ27AaaPMs5cnSAXR2USP68Bjth%2BAITeVRrHAgAA).

## Migration disposition summary

Disposition counts in this inventory: **34 migrated**, **13 replaced-by-monorepo-equivalent**, **19 dropped**, **1 deferred**, **0 UNKNOWN**. A feature is counted once in the table below; target-only features are listed later under discrepancies, not counted as source features.

| # | Source feature | Disposition | One-line rationale | Evidence |
|---|---|---|---|---|
| 1 | `staticWebApps.action.cancel` | dropped | GitHub Actions run tree was not migrated; no target command or Octokit cancel path exists. | Source: `package.json`, `src/commands/github/actionCommands.ts`; target search: `extensions/vscode-azure/src`. |
| 2 | `staticWebApps.action.rerun` | dropped | GitHub Actions run tree was not migrated; no target command or Octokit rerun path exists. | Source: `package.json`, `src/commands/github/actionCommands.ts`; target search: `extensions/vscode-azure/src`. |
| 3 | `staticWebApps.appSettings.add` | replaced-by-monorepo-equivalent | Replaced by shared settings document editing instead of per-setting tree commands. | Source: `src/commands/registerCommands.ts`; target: `src/commands/settings/EditSettings.ts`, `src/settings/adapters/StaticWebAppSettingsAdapter.ts`. |
| 4 | `staticWebApps.appSettings.delete` | replaced-by-monorepo-equivalent | Replaced by shared settings document editing. | Same as #3. |
| 5 | `staticWebApps.appSettings.download` | replaced-by-monorepo-equivalent | Import/export through Azure Functions extension was removed; settings now open as a resource-backed JSONC document. | Source: `src/commands/appSettings/downloadAppSettings.ts`; target: `EditSettings.ts`, `StaticWebAppSettingsAdapter.ts`. |
| 6 | `staticWebApps.appSettings.edit` | replaced-by-monorepo-equivalent | Replaced by shared settings document editing. | Same as #3. |
| 7 | `staticWebApps.appSettings.rename` | replaced-by-monorepo-equivalent | Replaced by shared settings document editing. | Same as #3. |
| 8 | `staticWebApps.appSettings.upload` | replaced-by-monorepo-equivalent | Import/export through Azure Functions extension was removed; settings now open as a resource-backed JSONC document. | Source: `src/commands/appSettings/uploadAppSettings.ts`; target: `EditSettings.ts`, `StaticWebAppSettingsAdapter.ts`. |
| 9 | `staticWebApps.browse` | replaced-by-monorepo-equivalent | Replaced by the shared `vscode-azure/resources/browseWebsite` command, which opens the website URL a data provider attached during enrichment; Static Web Apps contributes no browse command of its own. | Source: `src/commands/browse.ts`; target: `src/commands/tree/BrowseWebsite.ts`, `src/tree/resources/websiteUrl.ts`, `StaticWebAppDataProvider.ts`. |
| 10 | `staticWebApps.cloneRepo` | dropped | Target migration never clones or mutates Git state; Git is read-only for deployment routing. | Source: `src/commands/github/cloneRepo.ts`; target: `src/staticWebApps/GitRemoteService.ts`. |
| 11 | `staticWebApps.createHttpFunction` | dropped | No target command exists; only an Azure Functions documentation link remains. | Source: `src/commands/createHttpFunction.ts`; target: `registerStaticWebApps.ts`, `ShowDocumentation.ts`. |
| 12 | `staticWebApps.createStaticWebApp` | migrated | Reimplemented on monorepo `Wizard` + azd/Bicep creation patterns as `vscode-azure/staticWebApps/createNew`. | Source: `src/commands/createStaticWebApp/createStaticWebApp.ts`; target: `CreateStaticWebApp.ts`. |
| 13 | `staticWebApps.createStaticWebAppAdvanced` | migrated | Reimplemented on the same target command class in advanced mode as `vscode-azure/staticWebApps/createAdvanced`. | Source: `createStaticWebApp.ts`; target: `CreateStaticWebApp.ts`, `PickSkuStep.ts`. |
| 14 | `staticWebApps.createSwaConfigFile` | migrated | Reimplemented as `vscode-azure/staticWebApps/createSwaConfigFile` using VS Code workspace APIs. | Source: `src/commands/createSwaConfigFile.ts`; target: `CreateSwaConfigFile.ts`. |
| 15 | `staticWebApps.deleteEnvironment` | migrated | Reimplemented as a `ManagedCommand` using the Static Web Apps client and activity tree. | Source: `src/commands/deleteEnvironment.ts`; target: `DeleteStaticWebAppEnvironment.ts`. |
| 16 | `staticWebApps.deleteStaticWebApp` | replaced-by-monorepo-equivalent | Replaced by the generic resource delete command and resource context value. | Source: `src/commands/deleteStaticWebApp/*`; target: `src/commands/tree/DeleteAzureResource.ts`, `StaticWebAppViewProvider.ts`. |
| 17 | `staticWebApps.installOrUpdateStaticWebAppsCli` | migrated | Reimplemented through `SwaCliService.installOrUpdate()`. | Source: `src/commands/cli/installOrUpdateSwaCli.ts`; target: `InstallOrUpdateSwaCli.ts`, `SwaCliService.ts`. |
| 18 | `staticWebApps.openGitHubLog` | dropped | GitHub Actions job/step log viewer and custom content provider were not migrated. | Source: `src/commands/github/jobLogs/*`; target search: `extensions/vscode-azure/src`. |
| 19 | `staticWebApps.openGitHubRepo` | dropped | GitHub branch URL command was not migrated; target deploy routing only reads remotes. | Source: `src/commands/github/openGitHubRepo.ts`; target: `GitRemoteService.ts`. |
| 20 | `staticWebApps.openInPortal` | replaced-by-monorepo-equivalent | Replaced by generic `vscode-azure/resources/openInPortal`; settings open through the shared settings editor instead. | Source: `src/commands/openInPortal.ts`; target: `src/commands/tree/OpenInPortal.ts`, `StaticWebAppViewProvider.ts`. |
| 21 | `staticWebApps.openYAMLConfigFile` | dropped | Native SWA GitHub workflow parsing/editing was not migrated; target uses azd `azure.yaml` and CI/CD routing. | Source: `src/commands/openYAMLConfigFile.ts`, `src/tree/Workflow*`; target: `deploymentRouting.ts`, `DeployStaticWebApp.ts`. |
| 22 | `staticWebApps.reportIssue` | dropped | Product-specific report-issue command was not migrated. | Source: `registerCommands.ts`; target package has no SWA report issue command. |
| 23 | `staticWebApps.showActions` | dropped | GitHub Actions tree opening was not migrated. | Source: `src/commands/github/showActions.ts`; target search: `extensions/vscode-azure/src`. |
| 24 | `staticWebApps.showDocumentation` | migrated | Reimplemented as `vscode-azure/staticWebApps/showDocumentation`. | Source: `registerCommands.ts`; target: `ShowDocumentation.ts`, `registerStaticWebApps.ts`. |
| 25 | `staticWebApps.toggleAppSettingVisibility` | replaced-by-monorepo-equivalent | Per-setting value visibility is obsolete because target does not render individual setting values in the tree. | Source: `registerCommands.ts`; target: `SettingsViewProvider.ts`, `EditSettings.ts`. |
| 26 | `staticWebApps.uninstallStaticWebAppsCli` | migrated | Reimplemented through `SwaCliService.uninstall()`. | Source: `src/commands/cli/uninstallSwaCli.ts`; target: `UninstallSwaCli.ts`, `SwaCliService.ts`. |
| 27 | `staticWebApps.viewProperties` | migrated | Environment properties migrated; Action/Job/Step scopes were dropped with the GitHub Actions tree. | Source: `src/commands/viewProperties.ts`, menus; target: `ViewStaticWebAppProperties.ts`. |
| 28 | `staticWebApps.showFunctionsDocumentation` | migrated | Source code-only command is now contributed and registered as `vscode-azure/staticWebApps/showFunctionsDocumentation`. | Source: `registerCommands.ts`; target: `package.json`, `ShowDocumentation.ts`. |
| 29 | `staticWebApps.enableOutputTimestamps` setting | dropped | No target setting or usage found. | Source: `package.json`; target search: `extensions/vscode-azure`. |
| 30 | `staticWebApps.appSubpath` setting | migrated | Renamed under monorepo configuration root as `vscode-azure.staticWebApps.appSubpath`. | Source: `package.json`; target: `package.json`, `StaticWebAppSettings.ts`. |
| 31 | `staticWebApps.apiSubpath` setting | migrated | Renamed as `vscode-azure.staticWebApps.apiSubpath`. | Same as #30. |
| 32 | `staticWebApps.appArtifactSubpath` setting | dropped | Source already deprecated it in favor of `outputSubpath`; target keeps only `outputSubpath`. | Source: `package.json`; target package search. |
| 33 | `staticWebApps.outputSubpath` setting | migrated | Renamed as `vscode-azure.staticWebApps.outputSubpath`. | Source: `package.json`; target: `package.json`, `StaticWebAppSettings.ts`. |
| 34 | `staticWebApps.showStaticWebAppsCliWarning` setting | migrated | Renamed as `vscode-azure.staticWebApps.showStaticWebAppsCliWarning` and used by `SwaCliService`. | Source: `package.json`; target: `package.json`, `SwaCliService.ts`. |
| 35 | Azure Resources resolver for `microsoft.web/staticsites` | migrated | Reimplemented through monorepo resource data/view providers rather than the old Azure Resources host API resolver. | Source: `StaticWebAppResolver.ts`; target: `StaticWebAppDataProvider.ts`, `StaticWebAppViewProvider.ts`, `registerStaticWebApps.ts`. |
| 36 | Static Web App root tree node | migrated | Reimplemented as a `GenericResource` view item with `azureStaticWebApp` and shared context values. | Source: `StaticWebAppTreeItem.ts`; target: `StaticWebAppViewProvider.ts`. |
| 37 | Environment tree node | migrated | Reimplemented as virtual `staticWebApp.environment` node with `azureStaticEnvironment`. | Source: `EnvironmentTreeItem.ts`; target: `StaticWebApp.ts`, `StaticWebAppViewProvider.ts`. |
| 38 | Functions group node | migrated | Reimplemented as virtual `staticWebApp.functions` with `azureStaticFunctions` and generic portal context. | Source: `FunctionsTreeItem.ts`; target: `StaticWebAppDataProvider.ts`, `StaticWebAppViewProvider.ts`. |
| 39 | Function leaf node | migrated | Reimplemented as virtual `staticWebApp.function` with `azureStaticFunction`. | Source: `FunctionTreeItem.ts`; target: `StaticWebApp.ts`, `StaticWebAppViewProvider.ts`. |
| 40 | No-functions placeholder | migrated | Reimplemented as `staticWebApp.noFunctions` with help and empty variants. | Source: `EnvironmentTreeItem.ts`, `FunctionsTreeItem.ts`; target: `StaticWebAppDataProvider.ts`, `StaticWebAppViewProvider.ts`. |
| 41 | Application settings tree nodes | replaced-by-monorepo-equivalent | Replaced by shared `SettingsNode`/`EditSettings` document model. | Source: `EnvironmentTreeItem.ts`, `AppSettingsClient.ts`; target: `SettingsNode.ts`, `SettingsViewProvider.ts`, `StaticWebAppSettingsAdapter.ts`. |
| 42 | GitHub Actions group node | dropped | No target Actions node or Octokit workflow run listing. | Source: `ActionsTreeItem.ts`; target search. |
| 43 | GitHub Action run nodes | dropped | No target run status nodes or cancel/rerun commands. | Source: `ActionTreeItem.ts`, `actionCommands.ts`; target search. |
| 44 | GitHub Action job nodes | dropped | No target job nodes or job properties/logs. | Source: `JobTreeItem.ts`; target search. |
| 45 | GitHub Action step/log nodes | dropped | No target step nodes or job log content provider. | Source: `StepTreeItem.ts`, `jobLogs/*`; target search. |
| 46 | Workflow YAML group/item nodes | dropped | Native SWA workflow YAML parser/editor tree was not migrated. | Source: `WorkflowGroupTreeItem.ts`, `WorkflowTreeItem.ts`; target search. |
| 47 | `invalidStaticEnvironment` placeholder | migrated | Reimplemented as `InvalidStaticWebAppNode` with the same context value. | Source: `StaticWebAppTreeItem.ts`; target: `StaticWebAppDataProvider.ts`, `StaticWebApp.ts`. |
| 48 | `invalidFunction` placeholder | migrated | Reimplemented as `InvalidStaticWebAppNode` with the same context value. | Source: `FunctionsTreeItem.ts`; target: `StaticWebAppDataProvider.ts`, `StaticWebApp.ts`. |
| 49 | `invalidActionTreeItem` / `invalidJobTreeItem` / `invalidStepTreeItem` placeholders | dropped | Dropped with the GitHub Actions tree. | Source: `ActionsTreeItem.ts`, `ActionTreeItem.ts`, `JobTreeItem.ts`; target search. |
| 50 | SWA debug configuration provider | migrated | Reimplemented as `SwaDebugConfigurationProvider` with dynamic/initial `swa` and `pwa-chrome` resolution. | Source: `StaticWebAppDebugProvider.ts`; target: `debug/staticWebApps/SwaDebugConfigurationProvider.ts`. |
| 51 | SWA task provider | migrated | Reimplemented as `SwaTaskProvider`, still using shell tasks and `$swa-watch`. | Source: `cli/SwaCliTaskProvider.ts`; target: `tasks/staticWebApps/SwaTaskProvider.ts`. |
| 52 | Stop SWA task on top-level debug termination | migrated | Reimplemented as injectable `SwaTaskLifecycle`. | Source: `commands/cli/swaCliTask.ts`; target: `tasks/staticWebApps/SwaTaskLifecycle.ts`. |
| 53 | `swa-cli.config.json` parsing | migrated | Reimplemented with `vscode.workspace.fs` and the same option surface. | Source: `cli/tryGetStaticWebAppsCliConfig.ts`; target: `staticWebApps/SwaCliConfig.ts`. |
| 54 | Data API builder config detection | migrated | Reimplemented as bounded workspace walk for `staticwebapp.database.config.json`. | Source: `cli/dab.ts`; target: `staticWebApps/DatabaseConfigDetector.ts`. |
| 55 | JSON validation for `staticwebapp.config.json` and `swa-cli.config.json` | migrated | Same schema registrations exist in the target manifest. | Source and target `package.json`. |
| 56 | `$swa-watch` problem matcher | migrated | Same matcher name and background end pattern exist in target manifest, with owner normalized to `swa`. | Source and target `package.json`. |
| 57 | SWA CLI install/update/uninstall/version helpers | migrated | Reimplemented as injectable `SwaCliService`. | Source: `commands/cli/*`; target: `SwaCliService.ts`, CLI command classes. |
| 58 | Activation-time outdated SWA CLI warning | migrated | Reimplemented in `registerStaticWebApps()` and gated by workspace project detection plus the target warning setting. | Source: `validateSwaCliIsLatest.ts`, `extension.ts`; target: `registerStaticWebApps.ts`, `SwaCliService.ts`. |
| 59 | GitHub auth + Octokit Actions integration | dropped | No target Octokit usage; target deployment routing uses read-only Git metadata and azd. | Source: `extension.ts`, `createOctokitClient.ts`, `github/*`; target search and `GitRemoteService.ts`. |
| 60 | Exported Remote Repositories/Git API and `api.revealTreeItem` | dropped | Source `activate()` returned `RemoteRepoApi`; target product registration has no equivalent source-specific exported API. | Source: `RemoteRepoApi.ts`, `commands/api/revealTreeItem.ts`; target search. |
| 61 | Basic create wizard flow | migrated | Reimplemented on monorepo `Wizard` with shared azd steps; defaults Free SKU. | Source: `createStaticWebApp.ts`; target: `CreateStaticWebApp.ts`. |
| 62 | Advanced create wizard flow | migrated | Reimplemented on same wizard; advanced mode adds SKU prompt. | Source: `createStaticWebApp.ts`, `SkuListStep.ts`; target: `CreateStaticWebApp.ts`, `PickSkuStep.ts`. |
| 63 | Create GitHub repository/add remote/push branch during create | deferred | Target docs and code explicitly avoid Git mutation and defer repository bootstrap to a separate future flow. | Source: `createRepo/*`, `RepoCreateStep.ts`; target: `docs/products/static-web-apps.md`, `GitRemoteService.ts`. |
| 64 | Direct ARM StaticSite creation with repository token and native workflow generation | replaced-by-monorepo-equivalent | Replaced by azd-generated Bicep (`Microsoft.Web/staticSites@2023-12-01`) plus `azure.yaml` service configuration. | Source: `StaticWebAppCreateStep.ts`; target: `CreateStaticWebApp.ts`, `ConfigureStaticWebAppAzureYamlStep.ts`, docs. |
| 65 | Post-create GitHub Actions polling/toast | replaced-by-monorepo-equivalent | Replaced by azd endpoint display for direct deploy and separate CI/CD setup command when routed. | Source: `postCreateStaticWebApp.ts`, `showSwaCreated.ts`; target: `ShowEndpointUrlStep.ts`, `DeployStaticWebApp.ts`. |
| 66 | Build preset table | migrated | Same 13 preset ids and values retained, with Angular placeholder resolved before deploy. | Source: `buildPresets/buildPresets.ts`; target: `commands/staticWebApps/buildPresets.ts`, `OutputLocationStep.ts`. |
| 67 | Framework/API detection | migrated | Reimplemented through `detectStaticWebAppProject()` using workspace fs, package/dependency signals, Angular/Blazor/Hugo/HTML fallbacks, API host.json detection, and Git metadata. | Source: `NodeDetector.ts`, `detectorUtils.ts`, `tryGetApiLocations.ts`; target: `steps/frameworkDetection.ts`. |

## 0. Extension-level shape

- Source extension dependencies: `ms-azuretools.vscode-azureresourcegroups` (`package.json`). Target monorepo has no separate extension dependency for SWA; registration is internal in `extensions/vscode-azure/src/products/registerStaticWebApps.ts`.
- Source activation events (A): `onDebugDynamicConfigurations`, `onDebugInitialConfigurations`, `onDebugResolve:pwa-chrome`, `workspaceContains:**/staticwebapp.config.json`, `workspaceContains:**/swa-cli.config.json`. Target keeps the same activation events in `extensions/vscode-azure/package.json`.
- Source capabilities (A): virtual workspaces supported `limited`; command gates include `!isWeb` and `!virtualWorkspace`. Target keeps virtual workspaces `limited` and keeps gates on deploy/config/CLI commands where applicable.
- Source `x-azResources` (A): branch type `StaticWebApps`, create command `staticWebApps.createStaticWebApp`, activation on ARM type `microsoft.web/staticsites`. Target replaces this with monorepo product registration, `StaticWebAppDataProvider`, `StaticWebAppViewProvider`, and `StaticWebAppResourceType` in `packages/azutils/src/rest/clients/ResourceClient.ts`.
- Source exported API (B): `activate()` returned `RemoteRepoApi`, which implemented Remote Repositories/Git API methods/events plus Azure extension API `getApi()` exposing `revealTreeItem` v1.0.0. Target has no source-specific exported SWA API found.
- Source activation wiring (B): output channel, UI/azureutils globals, activation telemetry, optional GitHub auth session, GitHub log folding provider, debug providers, shell task provider, Azure Resources resolver, RemoteRepo API, task events, commands, experimentation service. Target wires DI bindings, commands, data/view providers, shell task provider, debug providers, task lifecycle, and CLI validation in `registerStaticWebApps.ts`.
- Telemetry (B): commands use their command ids; non-command callback ids include `staticWebApps.activate`, `resolveResource`, `staticWebApps.postCreateStaticWebApp`, `staticWebApps.showSwaCreated`, `staticWebApps.provideDebugConfigurations`, `staticWebApps.resolveDebugConfiguration`, `staticWebApps.provideTasks`, `staticWebApps.provideTasksForWorkspaceFolder`, `staticWebApps.validateStaticWebAppsCliIsLatest`, `staticWebApps.onDidTerminateDebugSession`, `staticWebApps.onDidStartTask`, and `api.revealTreeItem`. Target retains analogous callback ids for debug/tasks/CLI validation and adds target command ids.

## 1. Commands (A + B)

| Source command id | Title | Layer | Target / disposition | Telemetry | Notes / enablement / when |
|---|---|---|---|---|---|
| `staticWebApps.action.cancel` | Cancel Action... | A+B | dropped | `ms-azuretools.vscode-azurestaticwebapps/staticwebapps.action.cancel` | Source menu: `viewItem == azureStaticActionInProgress`; no target command. |
| `staticWebApps.action.rerun` | Rerun Action... | A+B | dropped | `.../staticwebapps.action.rerun` | Source menu: `viewItem == azureStaticActionCompleted`; no target command. |
| `staticWebApps.appSettings.add` | Add New Setting... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.add` | Source menu targets `applicationSettings.*staticWebApps`; target uses shared settings node. |
| `staticWebApps.appSettings.delete` | Delete Setting... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.delete` | Source menu targets `applicationSettingItem.*staticWebApps`. |
| `staticWebApps.appSettings.download` | Download Remote Settings... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.download` | Source enablement `!isWeb`; target removed file import/export. |
| `staticWebApps.appSettings.edit` | Edit Setting... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.edit` | Source per-setting edit replaced by document edit. |
| `staticWebApps.appSettings.rename` | Rename Setting... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.rename` | Source per-setting rename replaced by document edit. |
| `staticWebApps.appSettings.upload` | Upload Local Settings... | A+B | replaced by `vscode-azure/settings/edit` | `.../staticwebapps.appsettings.upload` | Source enablement `!isWeb`; target removed file import/export. |
| `staticWebApps.browse` | Browse Site | A+B | `vscode-azure/resources/browseWebsite` - replaced | `.../staticwebapps.browse` | Target menu: `viewItem =~ /\bbrowseWebsite\b/i`, stamped on both the site and environment nodes. |
| `staticWebApps.cloneRepo` | Clone Repo... | A+B | dropped | `.../staticwebapps.clonerepo` | Source enablement `!isWeb`; target does not clone. |
| `staticWebApps.createHttpFunction` | Create HTTP Function... | A+B | dropped | `.../staticwebapps.createhttpfunction` | Source enablement `!virtualWorkspace`; target has docs-only function help. |
| `staticWebApps.createStaticWebApp` | Create Static Web App... | A+B | `vscode-azure/staticWebApps/createNew` - migrated | `.../staticwebapps.createstaticwebapp` | Target uses basic azd wizard, Free SKU default. |
| `staticWebApps.createStaticWebAppAdvanced` | Create Static Web App... (Advanced) | A+B | `vscode-azure/staticWebApps/createAdvanced` - migrated | `.../staticwebapps.createstaticwebappadvanced` | Target advanced mode adds SKU prompt. |
| `staticWebApps.createSwaConfigFile` | Create Configuration File | A+B | `vscode-azure/staticWebApps/createSwaConfigFile` - migrated | `.../staticwebapps.createswaconfigfile` | Source and target enablement `!isWeb`. |
| `staticWebApps.deleteEnvironment` | Delete Environment... | A+B | `vscode-azure/staticWebApps/deleteEnvironment` - migrated | `.../staticwebapps.deleteenvironment` | Target command palette hidden by `when: false`. |
| `staticWebApps.deleteStaticWebApp` | Delete... | A+B | generic `vscode-azure/resources/delete` - replaced | `.../staticwebapps.deletestaticwebapp` | Target uses shared `deleteResource` context; source also optionally deleted an empty resource group. |
| `staticWebApps.installOrUpdateStaticWebAppsCli` | Install or Update Azure Static Web Apps CLI | A+B | `vscode-azure/staticWebApps/installOrUpdateCli` - migrated | `.../staticwebapps.installorupdatestaticwebappscli` | Target enablement `!virtualWorkspace`. |
| `staticWebApps.openGitHubLog` | Open GitHub Action Log | A+B | dropped | `.../staticwebapps.opengithublog` | Source targeted `azureStatic(Job|Step$)`. |
| `staticWebApps.openGitHubRepo` | Open Repo in GitHub | A+B | dropped | `.../staticwebapps.opengithubrepo` | Source targeted `azureStaticEnvironment`. |
| `staticWebApps.openInPortal` | Open in Portal | A+B | generic `vscode-azure/resources/openInPortal` - replaced | `.../staticwebapps.openinportal` | Target generic command palette hidden; settings use editor instead. |
| `staticWebApps.openYAMLConfigFile` | Edit Workflow... | A+B | dropped | `.../staticwebapps.openyamlconfigfile` | Source targeted SWA/environment/workflow nodes; target has no native workflow parser. |
| `staticWebApps.reportIssue` | Report Issue... | A+B | dropped | `.../staticwebapps.reportissue` | Source registered product-specific issue command; target has none. |
| `staticWebApps.showActions` | Open in GitHub | A+B | dropped | `.../staticwebapps.showactions` | Source targeted `azureStaticActions`. |
| `staticWebApps.showDocumentation` | Documentation | A+B | `vscode-azure/staticWebApps/showDocumentation` - migrated | `.../staticwebapps.showdocumentation` | Target command retained. |
| `staticWebApps.toggleAppSettingVisibility` | Toggle App Setting Visibility. | A+B | replaced by settings editor model | `.../staticwebapps.toggleappsettingvisibility` | Source inline command on setting item; target tree shows no values. |
| `staticWebApps.uninstallStaticWebAppsCli` | Uninstall Azure Static Web Apps CLI | A+B | `vscode-azure/staticWebApps/uninstallCli` - migrated | `.../staticwebapps.uninstallstaticwebappscli` | Target enablement `!virtualWorkspace`. |
| `staticWebApps.viewProperties` | View Properties | A+B | `vscode-azure/staticWebApps/viewProperties` - migrated for environments | `.../staticwebapps.viewproperties` | Source also targeted Action/Job/Step; those scopes dropped. |
| `staticWebApps.showFunctionsDocumentation` | Azure Functions Documentation | B in source, A+B in target | `vscode-azure/staticWebApps/showFunctionsDocumentation` - migrated | `.../staticwebapps.showfunctionsdocumentation` | Source code-only command; target contributes it and hides from palette. |

Code-only source commands (B, not in source manifest): `staticWebApps.showFunctionsDocumentation` only.
Manifest-without-handler source commands: none.
Source orphan/dead NLS keys (confirmed no manifest reference and no source code reference): `staticWebApps.deleteConfirmation`, `staticWebApps.deleteConfirmation.ClickButton`, `staticWebApps.deleteConfirmation.EnterName`, `staticWebApps.revealResource`.

## 2. Settings / Configuration (A)

| Source setting id | Type | Scope | Default | Target / disposition | Notes |
|---|---|---|---|---|---|
| `staticWebApps.enableOutputTimestamps` | boolean | global | `true` | dropped | No target setting or use found. |
| `staticWebApps.appSubpath` | string | resource | none | `vscode-azure.staticWebApps.appSubpath` - migrated | Read by target `getStaticWebAppPathSetting(..., 'appLocation')`. |
| `staticWebApps.apiSubpath` | string | resource | none | `vscode-azure.staticWebApps.apiSubpath` - migrated | Read by target API location step. |
| `staticWebApps.appArtifactSubpath` | string | resource | none | dropped | Source deprecation says use `staticWebApps.outputSubpath`; target keeps only output setting. |
| `staticWebApps.outputSubpath` | string | resource | none | `vscode-azure.staticWebApps.outputSubpath` - migrated | Read by target output location step. |
| `staticWebApps.showStaticWebAppsCliWarning` | boolean | global | `true` | `vscode-azure.staticWebApps.showStaticWebAppsCliWarning` - migrated | Read by target `SwaCliService.warnIfOutdated()`. |

## 3. Tree view (A branch + B behavior)

Source registered under Azure Resources branch `StaticWebApps` and resolved ARM `microsoft.web/staticsites` via `StaticWebAppResolver`. Target uses monorepo resource providers registered in `registerStaticWebApps.ts`.

Source hierarchy and exact context values:

```text
azureStaticWebApp
  azureStaticEnvironment
    azureStaticActions
      azureStaticActionCompleted | azureStaticActionInProgress
        azureStaticJob
          azureStaticStep (click: staticWebApps.openGitHubLog)
    applicationSettings...staticWebApps
      applicationSettingItem...staticWebApps
    azureStaticFunctions
      azureStaticFunction
      noFunctions
    azureStaticWorkflowGroup
      azureStaticWorkflow (click: staticWebApps.openYAMLConfigFile)
      parseYamlErrorTreeItem (click: staticWebApps.openYAMLConfigFile)
  invalidStaticEnvironment
  invalidFunction
  invalidActionTreeItem
  invalidJobTreeItem
  invalidStepTreeItem
```

Target hierarchy and exact context values:

```text
azureStaticWebApp + browseStaticWebApp + openInPortal + deleteResource
  azureStaticEnvironment + browseStaticWebApp + deleteStaticWebAppEnvironment + viewStaticWebAppProperties
    editSettings (shared Application Settings document)
    azureStaticFunctions + openInPortal
      azureStaticFunction
      noFunctions + showStaticWebAppFunctionsDocumentation
    noFunctions + showStaticWebAppFunctionsDocumentation
  invalidStaticEnvironment
  invalidFunction
```

Per-node notes:

| Source node | Source behavior | Target / disposition |
|---|---|---|
| `StaticWebAppTreeItem` / `azureStaticWebApp` | Label name, description `owner/repo`, icon `azure-staticwebapps`, children are environments from `listStaticSiteBuilds`, delete wizard on root, browse default hostname. | Migrated as `StaticWebAppViewProvider` root with resource icon, browse, generic portal/delete context. Repo description is not retained. |
| `EnvironmentTreeItem` / `azureStaticEnvironment` | Production first, branch/status description, icon `Azure-Static-Apps-Environment`, children actions/settings/functions/workflow groups, deletes non-production builds. | Migrated as virtual environment with branch/status description and delete/browse/view-properties context. Actions and workflow children removed. |
| `ActionsTreeItem` / `azureStaticActions` | Lists GitHub workflow runs for environment branch using Octokit. | Dropped. |
| `ActionTreeItem` / `azureStaticActionCompleted` or `azureStaticActionInProgress` | Status-specific context for rerun/cancel, lists jobs, refreshes run status, polls. | Dropped. |
| `JobTreeItem` / `azureStaticJob` | Lists steps, downloads raw job log, view properties. | Dropped. |
| `StepTreeItem` / `azureStaticStep` | Opens parsed GitHub log on click. | Dropped. |
| `FunctionsTreeItem` / `azureStaticFunctions` | Lists production/build functions through Static Web Apps API. | Migrated as virtual functions group; portal context retained. |
| `FunctionTreeItem` / `azureStaticFunction` | Leaf function name and Functions icon. | Migrated. |
| `noFunctions` | Source had help item under environments without API and empty item under functions with no functions. | Migrated as help/empty `staticWebApp.noFunctions` variants. |
| App settings nodes | Source used `@microsoft/vscode-azext-azureappsettings` tree nodes under environments only when Function app settings endpoint existed. | Replaced by shared settings document under every environment using app settings endpoints. |
| `WorkflowGroupTreeItem` / `azureStaticWorkflowGroup` | Scans local `.github/workflows/*.yml`, parses SWA build config keys, shows parse errors. | Dropped. |
| `WorkflowTreeItem` / `azureStaticWorkflow` | Shows individual build config key/value and opens YAML selection. | Dropped. |
| `invalidStaticEnvironment` | Placeholder for malformed build entries. | Migrated. |
| `invalidFunction` | Placeholder for malformed function entries. | Migrated. |
| `invalidActionTreeItem`, `invalidJobTreeItem`, `invalidStepTreeItem` | Error placeholders for GitHub Actions children. | Dropped with Actions tree. |

Source menus (A), copied verbatim from source manifest:

| Menu | Command/submenu | When | Group | Target disposition |
|---|---|---|---|---|
| `staticWebApps.submenus.workspaceActions` | `staticWebApps.createHttpFunction` |  | `1_project@1` | dropped |
| `staticWebApps.submenus.workspaceActions` | `staticWebApps.createStaticWebApp` |  | `2_create@1` | migrated as `vscode-azure/staticWebApps/createNew` |
| `staticWebApps.submenus.workspaceActions` | `staticWebApps.createStaticWebAppAdvanced` |  | `2_create@2` | migrated as `vscode-azure/staticWebApps/createAdvanced` |
| `view/title` | `staticWebApps.submenus.workspaceActions` | `view == azureWorkspace` | `navigation@3` | migrated as `view == vscode-azure/workspace` |
| `view/item/context` | `staticWebApps.createStaticWebApp` | `view == azureResourceGroups && viewItem =~ /StaticWebApps/i && viewItem =~ /azureResourceTypeGroup/i` | `1@1` | migrated with bounded regex |
| `view/item/context` | `staticWebApps.createStaticWebAppAdvanced` | same as above | `1@2` | migrated with bounded regex |
| `view/item/context` | `staticWebApps.browse` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(WebApp|Environment)/` | `1@1` | migrated |
| `view/item/context` | `staticWebApps.openGitHubRepo` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem == azureStaticEnvironment` | `1@2` | dropped |
| `view/item/context` | `staticWebApps.showActions` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem == azureStaticActions` | `1@1` | dropped |
| `view/item/context` | `staticWebApps.cloneRepo` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStaticWebApp/` | `1@2` | dropped |
| `view/item/context` | `staticWebApps.openYAMLConfigFile` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(WebApp|Environment)/` | `3@1` | dropped |
| `view/item/context` | `staticWebApps.deleteStaticWebApp` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStaticWebApp/` | `3@2` | replaced by generic delete |
| `view/item/context` | `staticWebApps.deleteEnvironment` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem == azureStaticEnvironment` | `3@2` | migrated |
| `view/item/context` | `staticWebApps.openGitHubLog` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(Job|Step$)/` | `1@1` | dropped |
| `view/item/context` | `staticWebApps.viewProperties` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(Environment|Action[^s]|Job|Step$)/` | `9@1` | migrated for environment only |
| `view/item/context` | `staticWebApps.openInPortal` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(Functions)|applicationSettings.*staticWebApps/` | `9@2` | replaced by generic portal/settings editor |
| `view/item/context` | `azureResourceGroups.refresh` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /azureStatic(Environment|Functions|Actions?|Job|Step|WorkflowGroup|LocalProject)|applicationSettings.*staticWebApps/` | `9@3` | replaced by generic refresh behavior |
| `view/item/context` | `staticWebApps.appSettings.add` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /applicationSettings.*staticWebApps/` | `1@1` | replaced by settings editor |
| `view/item/context` | `staticWebApps.appSettings.download` | same settings group regex | `1@2` | replaced by settings editor |
| `view/item/context` | `staticWebApps.appSettings.upload` | same settings group regex | `1@3` | replaced by settings editor |
| `view/item/context` | `staticWebApps.appSettings.edit` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem =~ /applicationSettingItem.*staticWebApps/` | `1@1` | replaced by settings editor |
| `view/item/context` | `staticWebApps.appSettings.rename` | same setting item regex | `1@2` | replaced by settings editor |
| `view/item/context` | `staticWebApps.appSettings.delete` | same setting item regex | `1@3` | replaced by settings editor |
| `view/item/context` | `staticWebApps.toggleAppSettingVisibility` | same setting item regex | `inline` | replaced by settings editor |
| `view/item/context` | `staticWebApps.action.rerun` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem == azureStaticActionCompleted` | `1@1` | dropped |
| `view/item/context` | `staticWebApps.action.cancel` | `view =~ /(azureResourceGroups|azureFocusView)/ && viewItem == azureStaticActionInProgress` | `1@2` | dropped |
| `commandPalette` | `staticWebApps.openInPortal` | `never` |  | replaced by generic hidden command |
| `commandPalette` | `staticWebApps.toggleAppSettingVisibility` | `never` |  | dropped/replaced |
| `commandPalette` | `staticWebApps.viewProperties` | `never` |  | target also hidden with `when: false` |

Target SWA-specific menus:

| Menu | Command/submenu | When | Group |
|---|---|---|---|
| `vscode-azure/staticWebApps/workspaceActions` | `vscode-azure/staticWebApps/createSwaConfigFile` |  | `1_project@1` |
| `vscode-azure/staticWebApps/workspaceActions` | `vscode-azure/staticWebApps/createNew` |  | `2_create@1` |
| `vscode-azure/staticWebApps/workspaceActions` | `vscode-azure/staticWebApps/createAdvanced` |  | `2_create@2` |
| `view/title` | submenu `vscode-azure/staticWebApps/workspaceActions` | `view == vscode-azure/workspace` | `navigation@3` |
| `view/item/context` | `vscode-azure/staticWebApps/createNew` | `view == vscode-azure/resources && viewItem =~ /\bStaticWebApps\b/i && viewItem =~ /\bazureResourceTypeGroup\b/i` | `1@1` |
| `view/item/context` | `vscode-azure/staticWebApps/createAdvanced` | same as above | `1@2` |
| `view/item/context` | `vscode-azure/resources/browseWebsite` | `view == vscode-azure/resources && viewItem =~ /\bbrowseWebsite\b/i` | (shared) |
| `view/item/context` | `vscode-azure/staticWebApps/deleteEnvironment` | `view == vscode-azure/resources && viewItem =~ /\b(?:deleteStaticWebAppEnvironment|azureStaticEnvironment)\b/i` | `3@2` |
| `view/item/context` | `vscode-azure/staticWebApps/viewProperties` | `view == vscode-azure/resources && viewItem =~ /\b(?:viewStaticWebAppProperties|azureStaticEnvironment)\b/i` | `9@1` |

Submenus: source `staticWebApps.submenus.workspaceActions` migrated to target `vscode-azure/staticWebApps/workspaceActions`.

## 4. Debugging + tasks (A + B)

- Debuggers (A): source contributed debugger `{ type: 'swa', label: 'Azure Static Web Apps' }`; target contributes the same type/label via package NLS.
- Debug provider behavior (B): source `StaticWebAppDebugProvider` generated `pwa-chrome` configs from `swa-cli.config.json` and detected app folders, used `SWA: Run <name>`, `url: http://localhost:4280`, `preLaunchTask: swa: start <name>`, `timeout: 30000`, validated `swa` CLI, optionally fixed config `apiLocation` to `http://localhost:7071`, and started Azure Functions attach debugging. Target `SwaDebugConfigurationProvider` migrates this behavior, deduplicates configs, uses `SwaCliService.validateInstalled()`, and optionally calls `azureFunctions.initProjectForVSCode` only when registered.
- Task providers (B): source registered a `shell` task provider and generated background `swa` tasks from named `swa-cli.config.json` configurations plus detected projects; target `SwaTaskProvider` does the same, deduplicating by label.
- Source generated task command shape: `swa start [context] --app-location <path> --api-location http://localhost:7071 --run <command> --data-api-location <folder> --devserver-timeout=90000`, env `BROWSER=none`, problem matcher `$swa-watch`. Target preserves this command shape.
- Problem matcher (A): source `swa-watch`, owner `Azure Static Web Apps`, source `swa`, background `activeOnStart: true`, `beginsPattern: '.'`, `endsPattern: 'Azure Static Web Apps emulator started'`. Target preserves name/source/background pattern; owner is `swa`.
- No source or target `taskDefinitions` contribution exists; both use the built-in `shell` task type.

## 5. Wizards (B)

### Create Static Web App - source flow

Source `createStaticWebApp()` prompt sequence:

1. Subscription picker via Azure Resources tree if no subscription node.
2. Workspace verification and detection: `NodeDetector`, subfolder detection, Functions API location detection, Git remote/branch context.
3. Basic mode: preselect Free SKU and enqueue `ResourceGroupCreateStep`; advanced mode: `ResourceGroupListStep`.
4. `StaticWebAppNameStep`: name input, 1-40 chars, alphanumeric or `-`, availability check in advanced mode, masks name.
5. `SkuListStep`: Free or Standard (skipped by prefilled basic context).
6. If no GitHub remote: `GitHubOrgListStep`, `RepoNameStep`, `RepoPrivacyStep`, `RemoteShortnameStep`, then `RepoCreateStep` creates GitHub repo, adds remote, pushes current branch, and resolves branch data.
7. `LocationListStep`: Central US, East US 2, East Asia, West Europe, West US 2.
8. `BuildPresetListStep`: grouped framework/SSG/custom preset quick pick.
9. `AppLocationStep`: defaults from setting or preset or `/`, YAML validation.
10. `ApiLocationStep`: detected API prompt or default from setting/preset/`api`; basic mode auto-fills when no detected API.
11. `OutputLocationStep`: default from setting, deprecated `appArtifactSubpath`, preset, or `build`; rejects unresolved Angular placeholder.

Source execute sequence: optional `RepoCreateStep` (priority 90), `ResourceGroupCreateStep`, `VerifyProvidersStep(['Microsoft.Web'])`, `StaticWebAppCreateStep` (priority 250). The ARM create call used `staticSites.beginCreateOrUpdateStaticSiteAndWait()` with `repositoryUrl`, `branch`, `repositoryToken`, build properties (`appLocation`, `apiLocation`, `appArtifactLocation`), SKU, and location. Post-create refreshed the Azure tree, ran `gitPull`, resolved the resource, polled GitHub Actions, and offered Browse/Open Actions/View/Edit Workflow.

### Create Static Web App - target flow

Target `CreateStaticWebApp` prompt sequence:

1. `SelectIacFolderStep`.
2. `HydrateAzdInfoStep`.
3. `HydratableChooseSubscriptionStep`.
4. `HydratableChooseLocationStep` constrained to Central US, East Asia, East US 2, West Europe, West US 2.
5. `ProjectNameStep`.
6. Advanced only: `PickSkuStep`; basic sets `staticWebAppSkuName: 'Free'`.
7. `PickBuildPresetStep`.
8. `AppLocationStep`.
9. `ApiLocationStep`.
10. `OutputLocationStep`.
11. `ConfirmProvisionStep`.
12. `DetermineStaticWebAppDeploymentRouteStep`.

Target execute sequence: `GenerateBicepStep('staticWebApp.bicep')`, `GenerateAzureYamlStep`, `ConfigureStaticWebAppAzureYamlStep`, `CreateAzdEnvStep`, `AzdProvisionStep`, `AzdDeployStep`, `ShowEndpointUrlStep`.

Target provisioning record: primary ARM resource `Microsoft.Web/staticSites@2023-12-01`, deployment through azd-generated Bicep, Azure YAML service `host: staticwebapp`, `project`, `dist`, optional `language`; tags include azd environment/service tags per docs. The target creates IaC/project metadata first, then provisions and optionally deploys with azd. It does not create GitHub repos, add remotes, push branches, write GitHub tokens, or generate the native `Azure/static-web-apps-deploy` workflow.

### Build presets

All source preset ids are migrated with the same display names, locations, ports, groups, and start commands, except target resolves the Angular `dist/<project-name>` placeholder before writing Bicep/YAML.

| Preset id | Display | App | API | Output | Port | Start command | Group |
|---|---|---|---|---|---|---|---|
| `angular` | Angular | `/` | `api` | `dist/<project-name>` | 4200 |  | framework |
| `react` | React | `/` | `api` | `build` | 3000 | `npm start` | framework |
| `svelte` | Svelte | `/` | `api` | `public` | 5000 |  | framework |
| `vuejs` | Vue.js | `/` | `api` | `dist` | 8080 | `npm run serve` | framework |
| `blazor` | Blazor | `Client` | `Api` | `wwwroot` | 5000 |  | framework |
| `nextjs` | Next.js (SSR) | `/` |  |  | 3000 |  | framework |
| `nextjs-export` | Next.js (static export) | `/` |  | `out` | 3000 |  | framework |
| `nuxt3` | Nuxt 3 | `/` | `.output/server` | `.output/public` | 3000 |  | framework |
| `svelte-kit` | SvelteKit | `/` | `build/server` | `build/static` | 3000 |  | framework |
| `html` | HTML | `/` |  | `/` | 3000 |  | framework |
| `gatsby` | Gatsby | `/` | `api` | `public` | 8000 |  | ssg |
| `hugo` | Hugo | `/` | `api` | `public` | 1313 |  | ssg |
| `vuepress` | VuePress | `/` | `api` | `.vuepress/dist` | 8080 |  | ssg |

Framework detection source facts: source `NodeDetector` detected Node projects from package/lock/common Node files and dependency names, plus Flutter, Lerna/Lage/Yarn details; task/debug app detection inspected subfolders and used build preset display names. Target `detectStaticWebAppProject()` maps package dependencies/config files to the retained preset ids, detects Angular project names, Blazor `.csproj`, Hugo config, HTML index fallback, Functions `host.json` locations, language (`dotnet`/`js`/`ts`), and Git metadata.

## 6. Config-file features (A + B)

| Feature | Source | Target / disposition |
|---|---|---|
| JSON schema for `staticwebapp.config.json` | Manifest `jsonValidation` -> `https://json.schemastore.org/staticwebapp.config.json` | Migrated unchanged. |
| JSON schema for `swa-cli.config.json` | Manifest `jsonValidation` -> Azure/static-web-apps-cli schema URL | Migrated unchanged. |
| Create `staticwebapp.config.json` example | `createSwaConfigFile.ts`, overwrite prompt, writes routes/navigationFallback example and opens file | Migrated in `CreateSwaConfigFile.ts`. |
| Parse `swa-cli.config.json` | `tryGetStaticWebAppsCliConfig.ts`, throws parse error with file name | Migrated in `SwaCliConfig.ts`. |
| Parse native SWA GitHub workflow YAML | `WorkflowGroupTreeItem.ts`, `openYAMLConfigFile.ts` | Dropped. Target docs call out this known gap for azd-generated workflows. |
| Data API builder config detection | `cli/dab.ts` searches one level for `staticwebapp.database.config.json` | Migrated and improved via `DatabaseConfigDetector.ts` bounded directory walk. |

## 7. External integrations (B)

| Integration | Source behavior | Target / disposition |
|---|---|---|
| Azure SDK management clients | Source used `@azure/arm-appservice` and `@azure/arm-resources` wrappers for Static Sites and resource groups. | Migrated through azutils client providers and `StaticWebAppClient`. |
| GitHub auth | Source requested VS Code GitHub auth scopes `repo`, `workflow`, `user:email`, `read:user` on activation. | Dropped. Target does not require GitHub auth for SWA; CI/CD uses azd. |
| Octokit GitHub Actions | Source listed workflow runs/jobs, reran/canceled runs, downloaded logs, and opened repo/branch URLs. | Dropped. |
| Git mutation | Source created GitHub repos, added remotes, pushed branches, cloned repos, and pulled after create. | Deferred/dropped. Target `GitRemoteService` is read-only and never mutates Git state. |
| Remote Repositories API | Source exported `RemoteRepoApi` and proxied Git provider events. | Dropped; no target equivalent found. |
| Azure Functions extension API | Source required Functions extension for create HTTP function, app settings import/export, and API debugging. | Mostly dropped/reduced: create function and settings import/export removed; debug attach uses Functions command only if registered. |
| SWA CLI lifecycle | Source installed/uninstalled `@azure/static-web-apps-cli`, validated min version `0.8.0`, warned on outdated version. | Migrated in `SwaCliService`. |
| azd | Not present in source. | Target replacement for provisioning, deployment, endpoint display, and CI/CD setup. |

## 8. Docs layer (C) - supplementary only

Docs consulted:

- Source README: `/Users/alex/dev/core/vscode-azurestaticwebapps/README.md`.
- Source changelog: `/Users/alex/dev/core/vscode-azurestaticwebapps/CHANGELOG.md`.
- Target docs: `docs/products/static-web-apps.md`.

README confirms user-facing source workflows for create, GitHub Actions update/preview environments, app settings, debug, and create HTTP Function. Target docs confirm the monorepo create flow, azd/Bicep, settings model, CI/CD routing, explicit no-repo-bootstrap behavior, deployment limitations, and workflow parser known gap. Docs were not used to remove any code/manifest feature.

## 9. Usage Summary (telemetry) - no raw numbers committed

- Telemetry was intentionally not queried for this artifact. The task explicitly prohibited running telemetry queries.
- The committed inventory includes no raw telemetry counts, user/machine counts, result-state tables, last-seen rows, CSV, or JSON.
- To collect data later, use the roll-up deeplink at the top of this file or the equivalent KQL below:

```kusto
let ext = 'ms-azuretools.vscode-azurestaticwebapps';
let window = 90d;
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(window)
| where ExtensionName == ext
| where tostring(Properties['isactivationevent']) != 'true'
| summarize
    Invocations = count(),
    ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
    InternalUsers = dcountif(VSCodeMachineId, IsInternal == true),
    Succeeded = countif(tostring(Properties['result']) == 'Succeeded'),
    Failed = countif(tostring(Properties['result']) == 'Failed'),
    Canceled = countif(tostring(Properties['result']) == 'Canceled'),
    LastSeen = format_datetime(max(ServerTimestamp), 'yyyy-MM-dd')
    by EventName
| order by ExternalUsers desc
```

Non-instrumented surfaces: settings, menus/submenus, JSON validation, problem matcher, and orphan strings have no direct telemetry event. Source callbacks with suppression included debug resolve activation pass and task lifecycle events; interpret telemetry for those cautiously if collected later.

## Migration-relevant cross-cutting notes

- Migration is a reimplementation, not a code port. Target patterns used: DI product registration, `ManagedCommand`, monorepo `Wizard` steps, azd+Bicep resource creation, `DataItemTree`/`ViewItemTree` resource providers, shared settings editor, generic open-in-portal/delete commands, and azutils client providers.
- Highest-value discrepancies:
  - Source GitHub Actions management (Actions tree, rerun/cancel, log viewer, open workflow/repo) is absent in target.
  - Source create HTTP Function command is absent in target; only Functions documentation remains.
  - Source per-setting tree commands and upload/download flows are replaced by the monorepo settings document model.
  - Source GitHub repo creation/add-remote/push and clone flows are absent/deferred; target is deliberately read-only with respect to Git mutation.
  - Source exported Remote Repositories/Git API and `api.revealTreeItem` are absent in target.
  - Target adds `vscode-azure/staticWebApps/deploy`, a standalone azd deployment/CI-CD routing command with no source counterpart.
  - Target broadens deployment routing beyond source native GitHub Actions by supporting azd direct deploy and `azd pipeline config` for GitHub Actions or Azure Pipelines, with limitations documented.
- UNKNOWN needing human decision: none found. All source features either have a verified target counterpart, verified monorepo replacement, or verified absence in target source.

## Verification checklist results

- Commands: 28 source registered commands total (27 contributed A+B + 1 code-only B + 0 manifest-without-handler), all listed.
- Settings: 6 source settings listed.
- Menus: 29 source menu entries and 1 source submenu listed with exact `when` clauses; target SWA menu entries listed.
- Tree nodes: 10 concrete source classes plus generic placeholders and 5 invalid/error variants reconciled; target node contexts listed.
- Wizards/flows: 2 source AzureWizard create flows plus delete/environment/config/function interactive flows reconciled; 2 target create modes plus standalone deploy noted.
- Debuggers/tasks: 1 debugger contribution, 1 shell task provider, 0 taskDefinitions, 1 problem matcher.
- JSON validation: 2 entries listed.
- Orphan NLS keys: 4 listed and marked dead.
- Telemetry: query not run by task instruction; no raw telemetry committed.
