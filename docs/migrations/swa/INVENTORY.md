# Azure Static Web Apps -- Feature Inventory

Source: `microsoft/vscode-azurestaticwebapps` at
`84d7c8da77e431c3f1c115d88b851a3b3bbb4464` (v0.13.3), publisher
`ms-azuretools`.

Method: reconciled the source extension's `package.json`, `package.nls.json`,
`src/`, README, and changelog. Source code is authoritative for behavior; the
published documentation is supplementary.

Source layer legend: **A** = declarative manifest, **B** = code behavior,
**C** = documented UX.

Telemetry was not collected for this inventory. No raw telemetry results are
committed.

## Summary

| Surface | Source facts |
|---|---|
| Commands | 27 contributed commands plus one code-only command |
| Menus | One Static Web Apps submenu in the Azure Workspace view title |
| Settings | 6 settings |
| Tree | Azure Resources branch resolver, 10 concrete node classes, shared settings nodes, and invalid placeholders |
| Local development | One debugger contribution, a shell task provider, task lifecycle coordination, and one problem matcher |
| Configuration | Two JSON schema registrations plus readers for SWA CLI, workflow, and Data API configuration |
| Creation | Basic and advanced ARM-based creation flows with GitHub repository and workflow integration |
| External integrations | Azure Resources, Azure Functions, GitHub authentication/Octokit, Git, Remote Repositories, and the SWA CLI |

## Feature checklist

Each row is one independently triageable source feature. Target outcomes are
recorded only in [TRIAGE.md](TRIAGE.md).

| # | Source feature | Kind | Layer | Source behavior / evidence |
|---|---|---|---|---|
| 1 | `staticWebApps.action.cancel` | command | A+B | Cancels an in-progress GitHub Actions run; `package.json`, `commands/github/actionCommands.ts`. |
| 2 | `staticWebApps.action.rerun` | command | A+B | Reruns a completed GitHub Actions run; `package.json`, `commands/github/actionCommands.ts`. |
| 3 | `staticWebApps.appSettings.add` | command | A+B | Adds one application setting beneath an environment. |
| 4 | `staticWebApps.appSettings.delete` | command | A+B | Deletes one application setting. |
| 5 | `staticWebApps.appSettings.download` | command | A+B | Downloads remote settings to a local file through the Azure Functions extension integration. |
| 6 | `staticWebApps.appSettings.edit` | command | A+B | Edits one application setting value. |
| 7 | `staticWebApps.appSettings.rename` | command | A+B | Renames one application setting. |
| 8 | `staticWebApps.appSettings.upload` | command | A+B | Uploads settings from a local file through the Azure Functions extension integration. |
| 9 | `staticWebApps.browse` | command | A+B | Opens a site's or environment's hostname. |
| 10 | `staticWebApps.cloneRepo` | command | A+B | Clones the repository associated with a site. |
| 11 | `staticWebApps.createHttpFunction` | command | A+B | Delegates HTTP Function creation to the Azure Functions extension. |
| 12 | `staticWebApps.createStaticWebApp` | command + wizard | A+B | Runs the basic create flow, defaulting to the Free SKU. |
| 13 | `staticWebApps.createStaticWebAppAdvanced` | command + wizard | A+B | Runs the create flow with additional resource-group and SKU choices. |
| 14 | `staticWebApps.createSwaConfigFile` | command | A+B | Creates and opens an example `staticwebapp.config.json`, with overwrite confirmation. |
| 15 | `staticWebApps.deleteEnvironment` | command | A+B | Deletes a non-production Static Web Apps build/environment. |
| 16 | `staticWebApps.deleteStaticWebApp` | command | A+B | Deletes the site and can optionally delete an empty resource group. |
| 17 | `staticWebApps.installOrUpdateStaticWebAppsCli` | command | A+B | Installs or updates `@azure/static-web-apps-cli`. |
| 18 | `staticWebApps.openGitHubLog` | command | A+B | Downloads, parses, and opens an Actions job/step log. |
| 19 | `staticWebApps.openGitHubRepo` | command | A+B | Opens the repository and environment branch in GitHub. |
| 20 | `staticWebApps.openInPortal` | command | A+B | Opens functions or application settings in the Azure portal. |
| 21 | `staticWebApps.openYAMLConfigFile` | command | A+B | Opens and selects Static Web Apps build settings in a native GitHub Actions workflow. |
| 22 | `staticWebApps.reportIssue` | command | A+B | Opens the product-specific issue reporting flow. |
| 23 | `staticWebApps.showActions` | command | A+B | Opens the GitHub Actions page for the associated repository. |
| 24 | `staticWebApps.showDocumentation` | command | A+B | Opens Static Web Apps documentation. |
| 25 | `staticWebApps.toggleAppSettingVisibility` | command | A+B | Toggles display of an individual setting value in the tree. |
| 26 | `staticWebApps.uninstallStaticWebAppsCli` | command | A+B | Uninstalls the globally installed SWA CLI npm package. |
| 27 | `staticWebApps.viewProperties` | command | A+B | Opens properties for environments, Actions runs, jobs, and steps. |
| 28 | `staticWebApps.showFunctionsDocumentation` | command | B | Code-only command that opens Azure Functions documentation. |
| 29 | `staticWebApps.enableOutputTimestamps` | setting | A | Global boolean, default `true`, controlling output timestamps. |
| 30 | `staticWebApps.appSubpath` | setting | A | Resource-scoped default application location. |
| 31 | `staticWebApps.apiSubpath` | setting | A | Resource-scoped default Functions API location. |
| 32 | `staticWebApps.appArtifactSubpath` | setting | A | Deprecated resource-scoped artifact location; superseded by `outputSubpath`. |
| 33 | `staticWebApps.outputSubpath` | setting | A | Resource-scoped default build output location. |
| 34 | `staticWebApps.showStaticWebAppsCliWarning` | setting | A | Global boolean, default `true`, controlling the outdated-CLI warning. |
| 35 | Azure Resources resolver for `microsoft.web/staticsites` | provider | A+B | Resolves Static Sites into the host Azure Resources tree through `StaticWebAppResolver`. |
| 36 | Static Web App root tree node | tree node | B | Shows site name, repository description, environments, browse, portal, and delete actions. |
| 37 | Environment tree node | tree node | B | Shows production/preview builds, branch and status, and environment-specific children/actions. |
| 38 | Functions group node | tree node | B | Lists managed Functions for the production site or preview build. |
| 39 | Function leaf node | tree node | B | Displays an individual managed Function. |
| 40 | No-functions placeholder | tree node | B | Shows help when no API exists and an empty-state row when an API has no functions. |
| 41 | Application settings tree nodes | tree nodes | B | Uses `@microsoft/vscode-azext-azureappsettings` beneath environments whose function-settings endpoint is available. |
| 42 | GitHub Actions group node | tree node | B | Lists workflow runs for the environment branch. |
| 43 | GitHub Action run nodes | tree nodes | B | Shows status, polls in-progress runs, and exposes rerun/cancel. |
| 44 | GitHub Action job nodes | tree nodes | B | Lists jobs and their steps and exposes job properties/logs. |
| 45 | GitHub Action step/log nodes | tree nodes | B | Shows steps and opens parsed log content. |
| 46 | Workflow YAML group/item nodes | tree nodes | B | Scans `.github/workflows`, parses native SWA workflow keys, and opens matching YAML. |
| 47 | `invalidStaticEnvironment` placeholder | tree node | B | Represents a malformed build/environment entry. |
| 48 | `invalidFunction` placeholder | tree node | B | Represents a malformed function entry. |
| 49 | Actions/job/step invalid placeholders | tree nodes | B | Represents malformed GitHub Actions entries. |
| 50 | SWA debug configuration provider | debugger | A+B | Generates browser configurations from detected projects and `swa-cli.config.json`, validates the CLI, and coordinates Functions debugging. |
| 51 | SWA task provider | task provider | B | Generates background `swa start` shell tasks for named CLI configurations and detected projects. |
| 52 | Stop SWA task on top-level debug termination | lifecycle | B | Stops the matching emulator task when the parent debug session ends. |
| 53 | `swa-cli.config.json` parsing | parser | B | Reads named CLI configurations and their app/API/output/data-API/start-command options. |
| 54 | Data API builder config detection | detector | B | Searches for `staticwebapp.database.config.json` and passes its folder to the CLI. |
| 55 | Static Web Apps JSON validation | manifest | A | Registers schemas for `staticwebapp.config.json` and `swa-cli.config.json`. |
| 56 | `$swa-watch` problem matcher | problem matcher | A | Marks a generated SWA shell task ready when the emulator-started line appears. |
| 57 | SWA CLI lifecycle helpers | integration | B | Locates the executable, checks versions, and installs, updates, or uninstalls the global npm package. |
| 58 | Activation-time outdated SWA CLI warning | activation | B | Detects relevant workspaces and warns when a newer CLI is available. |
| 59 | GitHub auth and Octokit Actions integration | integration | B | Requests GitHub scopes and lists, polls, reruns, cancels, and downloads workflow data. |
| 60 | Exported Remote Repositories/Git API and `api.revealTreeItem` | exported API | B | Exposes Git provider events/methods and an Azure extension API reveal operation from `activate()`. |
| 61 | Basic create wizard flow | wizard | B+C | Detects the project, uses Free SKU, gathers locations, and creates a site linked to a GitHub branch. |
| 62 | Advanced create wizard flow | wizard | B+C | Adds resource-group selection and Free/Standard SKU selection. |
| 63 | Create repository/add remote/push during create | wizard integration | B+C | Creates a GitHub repository when needed, adds a remote, pushes the branch, and then creates the site. |
| 64 | Direct ARM creation and native workflow generation | provisioning | B | Calls Static Sites ARM create with repository token/build properties so the service generates its native workflow. |
| 65 | Post-create Actions polling and notification | workflow | B+C | Pulls Git state, polls the generated Actions run, and offers browse/actions/workflow follow-ups. |
| 66 | Build preset table | wizard data | B | Defines 13 framework/static-site-generator presets with app, API, output, port, and start-command defaults. |
| 67 | Framework and API detection | detector | B | Detects Node frameworks and related project shapes, Functions API locations, and Git metadata. |
| 68 | Azure Workspace title submenu | menu | A | Contributes an Azure Static Web Apps submenu to the Azure Workspace view title with Create HTTP Function, basic create, and advanced create actions. |

## Source extension shape

- The extension depended on `ms-azuretools.vscode-azureresourcegroups`; it
  contributed no standalone view.
- Activation events covered dynamic/initial debug configuration, Chrome debug
  resolution, and workspaces containing `staticwebapp.config.json` or
  `swa-cli.config.json`.
- The Azure Resources contribution registered the `StaticWebApps` branch and
  activated resolution for `microsoft.web/staticsites`.
- The Azure Workspace view title contained a product-specific Static Web Apps
  submenu for HTTP Function creation and both site-creation commands.
- Virtual workspaces were supported in limited mode. Individual commands also
  used `!isWeb` and `!virtualWorkspace` gates.
- Four orphan NLS keys were present: `staticWebApps.deleteConfirmation`,
  `staticWebApps.deleteConfirmation.ClickButton`,
  `staticWebApps.deleteConfirmation.EnterName`, and
  `staticWebApps.revealResource`.

## Source tree and service model

The root ARM resource was `Microsoft.Web/staticSites`. Its children were
returned by `listStaticSiteBuilds`: the build whose `buildId` is `default`
represented production, and other builds represented preview environments.
Those build records are not independent ARM resources.

Each environment could expose application settings, a managed Functions group,
GitHub Actions runs, and parsed native workflow configuration. Production used
site-level Functions endpoints; preview environments used build-level
endpoints.

## Source creation flow

Both create commands used an ARM-oriented `AzureWizard`. They detected the
workspace, collected resource group, name, SKU, region, build preset,
application/API/output locations, and GitHub branch information, then called
Static Sites create/update with a repository token and build properties.

When no GitHub remote existed, the flow could create a repository, add a
remote, and push the current branch. After creation it refreshed the tree,
pulled Git changes, polled GitHub Actions, and offered workflow-related
follow-ups.

## Source local-development flow

The debugger generated `pwa-chrome` configurations targeting the SWA emulator
and coordinated an Azure Functions API debug session. The task provider emitted
background `swa start` shell tasks from named `swa-cli.config.json`
configurations and detected projects. Generated tasks used `$swa-watch`.

The CLI integration managed the global `@azure/static-web-apps-cli` package.
The source minimum version was `0.8.0`.

## Source integrations

- Azure management used `@azure/arm-appservice` and
  `@azure/arm-resources`-based wrappers.
- GitHub authentication requested repository, workflow, email, and profile
  scopes for repository creation and Actions management.
- The Azure Functions extension supplied HTTP Function creation, settings
  import/export, and API debugging.
- The exported activation API proxied Remote Repositories/Git functionality
  and exposed `revealTreeItem`.

## Verification of this inventory

- 68 independently triageable rows are listed exactly once.
- All 28 source commands, 6 settings, tree/debug/task/configuration surfaces,
  menu contributions, creation flows, and external integrations are represented.
- Target-only features and migration outcomes are intentionally excluded.
