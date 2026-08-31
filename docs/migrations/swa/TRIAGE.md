# Azure Static Web Apps -- Retrospective Migration Triage (SIGNED)

Signed-off decision record for the Static Web Apps migration already
implemented on the current branch. This reconstructs the stable feature
decisions from the source inventory and the branch's approved outcomes; it does
not claim that this document preceded implementation. The dispositions are
read-only unless this file is edited and reconfirmed with the reviewer.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurestaticwebapps` at `84d7c8da77e431c3f1c115d88b851a3b3bbb4464` (v0.13.3) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Target** | `extensions/vscode-azure` plus `packages/azutils` |
| **Precedents** | `functions` (azd creation), `acr` (resource providers and virtual children), `deploy` (azd services), shared settings and tool services |
| **Rows** | 67 |
| **Signed off by** | Brandon Waterloo (@bwateratmsft) |
| **Date** | 2026-08-28 |

## Dispositions

| Disposition | Count | Meaning in this record |
|---|---:|---|
| Migrate | 9 | Preserve the source capability using monorepo patterns |
| Adapt | 13 | Preserve the user goal with intentionally different behavior or UX |
| Reuse | 9 | Satisfy the feature by wiring an existing shared capability |
| Drop | 30 | Do not carry the source capability forward |
| Defer | 6 | Retain the goal for later tracked work |
| **Total** | **67** | |

The old hybrid inventory vocabulary is not mapped mechanically. In particular,
file-based settings import/export, value visibility, and source path-default
settings are absent rather than equivalent to target behavior; advanced
creation and CLI uninstall/warnings are also absent. Conversely, the shared
install/update command is a Reuse outcome, while ARM creation and post-create
behavior are Adapt outcomes.

## Decision table

| ID | Inventory feature | Disposition | Rationale |
|---|---|---|---|
| SWA-001 | `staticWebApps.action.cancel` | **Drop** | GitHub Actions management is outside the target product scope. |
| SWA-002 | `staticWebApps.action.rerun` | **Drop** | GitHub Actions management is outside the target product scope. |
| SWA-003 | `staticWebApps.appSettings.add` | **Reuse** | The shared settings JSONC document provides addition without per-setting tree commands. |
| SWA-004 | `staticWebApps.appSettings.delete` | **Reuse** | The shared settings JSONC document provides deletion. |
| SWA-005 | `staticWebApps.appSettings.download` | **Drop** | File import/export through the standalone Functions extension is not retained. |
| SWA-006 | `staticWebApps.appSettings.edit` | **Reuse** | The shared settings JSONC document provides editing. |
| SWA-007 | `staticWebApps.appSettings.rename` | **Reuse** | Renaming is expressed as a JSONC key edit. |
| SWA-008 | `staticWebApps.appSettings.upload` | **Drop** | File import/export through the standalone Functions extension is not retained. |
| SWA-009 | `staticWebApps.browse` | **Reuse** | Shared `BrowseWebsite` opens hostnames attached by enrichment. |
| SWA-010 | `staticWebApps.cloneRepo` | **Drop** | The target does not mutate Git state. |
| SWA-011 | `staticWebApps.createHttpFunction` | **Drop** | No dependency or command call into the standalone Functions extension is allowed. |
| SWA-012 | `staticWebApps.createStaticWebApp` | **Adapt** | Creation is one azd+Bicep flow rather than an ARM/repository-token wizard. |
| SWA-013 | `staticWebApps.createStaticWebAppAdvanced` | **Drop** | The target has one create command; SKU changes are made in generated Bicep. |
| SWA-014 | `staticWebApps.createSwaConfigFile` | **Migrate** | The example config creation flow remains a managed command. |
| SWA-015 | `staticWebApps.deleteEnvironment` | **Migrate** | Preview-environment deletion remains a product command. |
| SWA-016 | `staticWebApps.deleteStaticWebApp` | **Reuse** | Shared `DeleteAzureResource` handles the root ARM resource. |
| SWA-017 | `staticWebApps.installOrUpdateStaticWebAppsCli` | **Reuse** | Shared `AcquireTool` exposes the independent `vscode-azure/installSwa` command. |
| SWA-018 | `staticWebApps.openGitHubLog` | **Drop** | The Actions tree and log provider are not retained. |
| SWA-019 | `staticWebApps.openGitHubRepo` | **Drop** | Repository navigation is not part of the target tree. |
| SWA-020 | `staticWebApps.openInPortal` | **Reuse** | Shared `OpenInPortal` handles ARM and related-resource URLs. |
| SWA-021 | `staticWebApps.openYAMLConfigFile` | **Drop** | Native SWA workflow parsing/editing is not retained. |
| SWA-022 | `staticWebApps.reportIssue` | **Drop** | No product-specific report-issue command is needed. |
| SWA-023 | `staticWebApps.showActions` | **Drop** | The Actions tree and repository workflow commands are not retained. |
| SWA-024 | `staticWebApps.showDocumentation` | **Migrate** | The documentation command remains. |
| SWA-025 | `staticWebApps.toggleAppSettingVisibility` | **Drop** | The target tree never displays setting values. |
| SWA-026 | `staticWebApps.uninstallStaticWebAppsCli` | **Drop** | The shared tool service installs or updates tools but does not uninstall them. |
| SWA-027 | `staticWebApps.viewProperties` | **Adapt** | The environment scope remains; Actions/job/step scopes disappear with those trees. |
| SWA-028 | `staticWebApps.showFunctionsDocumentation` | **Migrate** | The Functions help command remains and is now declaratively contributed. |
| SWA-029 | `staticWebApps.enableOutputTimestamps` | **Drop** | Product-specific output formatting is not retained. |
| SWA-030 | `staticWebApps.appSubpath` | **Drop** | Creation derives defaults from detection, presets, and SWA CLI configuration instead of extension settings. |
| SWA-031 | `staticWebApps.apiSubpath` | **Drop** | Creation derives defaults from detection, presets, and SWA CLI configuration instead of extension settings. |
| SWA-032 | `staticWebApps.appArtifactSubpath` | **Drop** | The source already deprecated it in favor of `outputSubpath`. |
| SWA-033 | `staticWebApps.outputSubpath` | **Drop** | Creation derives defaults from detection, presets, and SWA CLI configuration instead of extension settings. |
| SWA-034 | `staticWebApps.showStaticWebAppsCliWarning` | **Drop** | The target performs no eager outdated-CLI warning. |
| SWA-035 | Azure Resources resolver | **Adapt** | Product data/view providers replace the host-extension resolver. |
| SWA-036 | Static Web App root tree node | **Adapt** | It is a generic ARM resource enriched with product children and shared actions. |
| SWA-037 | Environment tree node | **Adapt** | Builds become virtual resources with stable `AzureNodeId` paths. |
| SWA-038 | Functions group node | **Adapt** | A data provider lists functions beneath the virtual environment. |
| SWA-039 | Function leaf node | **Adapt** | Functions are virtual data/view-provider children. |
| SWA-040 | No-functions placeholder | **Adapt** | Help and empty variants remain in the provider model. |
| SWA-041 | Application settings tree nodes | **Reuse** | Shared settings nodes/editors are wired to an environment-specific adapter. |
| SWA-042 | GitHub Actions group node | **Drop** | GitHub Actions management is not retained. |
| SWA-043 | GitHub Action run nodes | **Drop** | GitHub Actions management is not retained. |
| SWA-044 | GitHub Action job nodes | **Drop** | GitHub Actions management is not retained. |
| SWA-045 | GitHub Action step/log nodes | **Drop** | GitHub Actions management is not retained. |
| SWA-046 | Workflow YAML group/item nodes | **Drop** | Native workflow parsing/editing is not retained. |
| SWA-047 | `invalidStaticEnvironment` placeholder | **Migrate** | Malformed service entries remain visible rather than disappearing. |
| SWA-048 | `invalidFunction` placeholder | **Migrate** | Malformed function entries remain visible rather than disappearing. |
| SWA-049 | Actions/job/step invalid placeholders | **Drop** | Their parent surfaces are dropped. |
| SWA-050 | SWA debug configuration provider | **Defer** | Restore after native Functions debugging; tracked by [#339](https://github.com/microsoft/vscode-azure/issues/339). |
| SWA-051 | SWA task provider | **Defer** | Restore with the coordinated debug workflow; tracked by [#339](https://github.com/microsoft/vscode-azure/issues/339). |
| SWA-052 | Stop SWA task on debug termination | **Defer** | Restore with debug/task lifecycle coordination; tracked by [#339](https://github.com/microsoft/vscode-azure/issues/339). |
| SWA-053 | `swa-cli.config.json` parsing | **Migrate** | Creation prompt defaults still consume the CLI configuration. |
| SWA-054 | Data API builder config detection | **Defer** | Restore Data API location discovery with generated emulator tasks; tracked by [#339](https://github.com/microsoft/vscode-azure/issues/339). |
| SWA-055 | Static Web Apps JSON validation | **Migrate** | Both source schema associations remain useful independently of debugging. |
| SWA-056 | `$swa-watch` problem matcher | **Defer** | Restore only with generated emulator tasks; tracked by [#339](https://github.com/microsoft/vscode-azure/issues/339). |
| SWA-057 | SWA CLI lifecycle helpers | **Adapt** | `SwaInstaller` plus the shared tool service own discovery, versioning, install, and update; uninstall is separately dropped. |
| SWA-058 | Activation-time outdated CLI warning | **Drop** | Tool checks happen only when a user invokes acquisition; no product activation work is added. |
| SWA-059 | GitHub auth and Octokit Actions integration | **Drop** | azd and read-only Git metadata replace product-owned GitHub credentials/Actions APIs. |
| SWA-060 | Exported Remote Repositories/Git API and reveal API | **Drop** | No source-extension compatibility API is retained. |
| SWA-061 | Basic create wizard flow | **Adapt** | One azd wizard provisions and, when supported, deploys a Free-plan site. |
| SWA-062 | Advanced create wizard flow | **Drop** | The separate advanced mode is not retained. |
| SWA-063 | Create repository/add remote/push during create | **Defer** | Repository bootstrap requires a separate ownership and consent decision; no tracking issue is currently linked. |
| SWA-064 | Direct ARM creation and native workflow generation | **Adapt** | Generated Bicep provisions the resource and azd owns provisioning/deployment. |
| SWA-065 | Post-create Actions polling and notification | **Adapt** | Endpoint display and a separate deployment-routing command replace native Actions polling. |
| SWA-066 | Build preset table | **Migrate** | The 13 source presets supply creation defaults. |
| SWA-067 | Framework and API detection | **Adapt** | Detection is rebuilt over workspace indexing and feeds azd/Bicep prompt defaults. |

## Cross-cutting directives

1. Creation and deployment use azd+Bicep. No repository token is passed to ARM.
2. The tree uses data and view providers. Shared browse, portal, delete, paging,
   selection, settings, and tool services are reused.
3. The extension does not inspect or modify Git state. Repository creation,
   remotes, and pushes are `azd pipeline config`'s to offer.
4. No target feature invokes or depends on the standalone Static Web Apps or
   Azure Functions extensions.
5. Debugging, generated emulator tasks, Data API location discovery, lifecycle
   coordination, and `$swa-watch` remain one deferred unit under #339.

## Open ownership decisions

The implementation contains review threads that remain unresolved on PR #237:
editing/parsing `azure.yaml` and product-owned build preset/scaffolding
behavior. These concerns do not change the dispositions above, but they prevent
the corresponding Adapt/Migrate rows from being described as final architecture
without qualification. They are carried into the plan and parity report as known
gaps.
