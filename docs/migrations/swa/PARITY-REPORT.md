# Azure Static Web Apps -- Parity Report

Verification of the current branch against the signed retrospective
[TRIAGE.md](TRIAGE.md).

| | |
|---|---|
| **Source** | `microsoft/vscode-azurestaticwebapps` at `84d7c8da77e431c3f1c115d88b851a3b3bbb4464` (v0.13.3) |
| **Triage rows** | 68 |
| **Accounted for** | 68 (0 unaccounted for) |
| **Date** | 2026-09-01 |

Evidence paths are relative to `extensions/vscode-azure/src/` unless another
root is named.

## Summary

| Disposition | Rows | Current result |
|---|---:|---|
| Migrate | 8 | present |
| Adapt | 14 | present |
| Reuse | 9 | shared capabilities wired |
| Drop | 31 | confirmed absent from the SWA product surface |
| Defer | 6 | unchecked in [MIGRATION-PLAN.md](MIGRATION-PLAN.md) |
| **Total** | **68** | |

## Feature accounting

| ID | Feature | Disposition | Outcome | Evidence |
|---|---|---|---|---|
| SWA-001 | Action cancel | Drop | absent | No SWA Actions command in `products/registerStaticWebApps.ts` or the manifest. |
| SWA-002 | Action rerun | Drop | absent | No SWA Actions command in product registration or the manifest. |
| SWA-003 | Add setting | Reuse | wired | `settings/adapters/StaticWebAppSettingsAdapter.ts`; shared settings editor. |
| SWA-004 | Delete setting | Reuse | wired | Same shared settings document. |
| SWA-005 | Download settings | Drop | absent | No SWA settings import/export command. |
| SWA-006 | Edit setting | Reuse | wired | Same shared settings document. |
| SWA-007 | Rename setting | Reuse | wired | Same shared settings document. |
| SWA-008 | Upload settings | Drop | absent | No SWA settings import/export command. |
| SWA-009 | Browse | Reuse | wired | `tree/resources/staticWebApps/StaticWebAppDataProvider.ts` calls `setWebsiteUrl`; view provider adds `BrowseWebsite.ContextValue`. |
| SWA-010 | Clone repository | Drop | absent | No clone command; the extension never touches Git directly. |
| SWA-011 | Create HTTP Function | Drop | absent | No Functions-extension command invocation; documentation link only. |
| SWA-012 | Create Static Web App | Adapt | landed | `commands/staticWebApps/CreateStaticWebApp.ts` uses `Wizard`, Bicep, and azd. |
| SWA-013 | Advanced create command | Drop | absent | Only `vscode-azure/staticWebApps/createNew` is contributed. |
| SWA-014 | Create SWA config | Migrate | landed | `commands/staticWebApps/CreateSwaConfigFile.ts`. |
| SWA-015 | Delete environment | Migrate | landed | `commands/staticWebApps/DeleteStaticWebAppEnvironment.ts`. |
| SWA-016 | Delete site | Reuse | wired | `StaticWebAppViewProvider.ts` uses `resourceContextValue`. |
| SWA-017 | Install/update CLI | Reuse | wired | `commands/registerCommands.ts` registers `vscode-azure/installSwa`; `tools/SwaInstaller.ts`. |
| SWA-018 | Open Actions log | Drop | absent | No SWA log content provider or command. |
| SWA-019 | Open GitHub repository | Drop | absent | No SWA repository navigation command. |
| SWA-020 | Open in portal | Reuse | wired | `OpenInPortal.ContextValue`; `AzureNodeId.forRelatedResource` for Functions. |
| SWA-021 | Open workflow YAML | Drop | absent | No native SWA workflow parser/editor. |
| SWA-022 | Product report issue | Drop | absent | No product-specific report command. |
| SWA-023 | Show Actions | Drop | absent | No Actions tree or Actions-page command. |
| SWA-024 | Show documentation | Migrate | landed | `products/registerStaticWebApps.ts` registers the documentation URL. |
| SWA-025 | Toggle setting visibility | Drop | absent | Shared settings tree shows no individual values. |
| SWA-026 | Uninstall CLI | Drop | absent | Shared acquisition has install/update only. |
| SWA-027 | View properties | Adapt | landed | Shared `ViewProperties` command; `properties/adapters/StaticWebAppEnvironmentPropertiesAdapter.ts` supplies the environment payload. |
| SWA-028 | Functions documentation | Migrate | landed | `products/registerStaticWebApps.ts`; `commands/staticWebApps/ShowDocumentation.ts`. |
| SWA-029 | Output timestamps setting | Drop | absent | No corresponding target setting. |
| SWA-030 | App subpath setting | Drop | absent | No corresponding target setting; creation resolves locations from the SWA CLI or `swa-cli.config.json`. |
| SWA-031 | API subpath setting | Drop | absent | No corresponding target setting; creation resolves locations from the SWA CLI or `swa-cli.config.json`. |
| SWA-032 | Deprecated artifact subpath setting | Drop | absent | No corresponding target setting is contributed. |
| SWA-033 | Output subpath setting | Drop | absent | No corresponding target setting; creation resolves locations from the SWA CLI or `swa-cli.config.json`. |
| SWA-034 | CLI warning setting | Drop | absent | No target setting or activation warning. |
| SWA-035 | Azure Resources resolver | Adapt | landed | `products/registerStaticWebApps.ts` registers product data/view providers. |
| SWA-036 | Site root node | Adapt | landed | `tree/resources/staticWebApps/StaticWebAppViewProvider.ts`. |
| SWA-037 | Environment node | Adapt | landed | `StaticWebAppDataProvider.ts` models builds as virtual environments. |
| SWA-038 | Functions group | Adapt | landed | `StaticWebAppDataProvider.ts` probes and creates the group. |
| SWA-039 | Function leaf | Adapt | landed | `StaticWebAppDataProvider.ts` and `StaticWebAppViewProvider.ts`. |
| SWA-040 | No-functions placeholder | Adapt | landed | Help and empty variants in both providers. |
| SWA-041 | Application settings nodes | Reuse | wired | `StaticWebAppSettingsAdapter.ts`; `getSettingsNodes` under each environment. |
| SWA-042 | Actions group | Drop | absent | No SWA Actions virtual type/provider branch. |
| SWA-043 | Action run nodes | Drop | absent | No SWA Actions virtual type/provider branch. |
| SWA-044 | Action job nodes | Drop | absent | No SWA Actions virtual type/provider branch. |
| SWA-045 | Action step/log nodes | Drop | absent | No SWA Actions virtual type/provider branch. |
| SWA-046 | Workflow YAML nodes | Drop | absent | No SWA workflow virtual type/provider branch. |
| SWA-047 | Invalid environment | Migrate | landed | `createEnvironmentOrInvalid` emits `invalidStaticEnvironment`. |
| SWA-048 | Invalid function | Migrate | landed | `createFunctionOrInvalid` emits `invalidFunction`. |
| SWA-049 | Invalid Actions nodes | Drop | absent | Parent Actions surfaces are absent. |
| SWA-050 | Debug provider | Defer | not landed | Issue #339; unchecked plan task. |
| SWA-051 | Task provider | Defer | not landed | Issue #339; unchecked plan task. |
| SWA-052 | Debug/task termination lifecycle | Defer | not landed | Issue #339; unchecked plan task. |
| SWA-053 | SWA CLI config parser | Migrate | landed | `staticWebApps/SwaCliConfig.ts`; `DetectStaticWebAppConfigStep.ts` prefers a user-authored config over CLI detection. |
| SWA-054 | Data API config detector | Defer | not landed | Issue #339; unchecked plan task. |
| SWA-055 | JSON validation | Migrate | landed | Two SWA schema associations in `extensions/vscode-azure/package.json`. |
| SWA-056 | `$swa-watch` matcher | Defer | not landed | Issue #339; unchecked plan task. |
| SWA-057 | CLI lifecycle helpers | Adapt | landed | `tools/SwaInstaller.ts` plus shared `ToolService`; no uninstall. |
| SWA-058 | Activation outdated warning | Drop | absent | No SWA activation scan/version warning. |
| SWA-059 | GitHub auth/Octokit | Drop | absent | No product auth scopes or Octokit Actions client. |
| SWA-060 | Exported Remote Repositories/reveal API | Drop | absent | Product registration exports no compatibility API. |
| SWA-061 | Basic create flow | Adapt | landed | `CreateStaticWebApp.ts` uses the single Free-plan azd flow. |
| SWA-062 | Advanced create flow | Drop | absent | No advanced command, mode, or SKU prompt. |
| SWA-063 | Repository bootstrap during create | Defer | not landed | The create wizard does not mutate Git; a later `azd pipeline config` run can offer repository creation and push. |
| SWA-064 | ARM creation/native workflow | Adapt | landed | `extensions/vscode-azure/resources/templates/staticWebApp/main.bicep`; shared azd provision/deploy steps. |
| SWA-065 | Post-create Actions polling | Adapt | landed with changed UX | Shared endpoint display; `ConfigureCicd.ts` delegates CI/CD to `azd pipeline config`. |
| SWA-066 | Build presets | Adapt | delegated | The Static Web Apps CLI owns the framework table; `DetectStaticWebAppConfigStep.ts` consumes it instead of mirroring 13 presets. |
| SWA-067 | Framework/API detection | Adapt | delegated | `SwaCliService.detect()` runs `swa init --yes` against a scratch config path, leaving the project untouched. |
| SWA-068 | Azure Workspace title submenu | Drop | absent | No product-specific submenu is contributed to `view/title`; creation remains available from the Resources tree and command palette. |

## Artifact status

All four migration artifacts are included in this change. They were
reconstructed after feature implementation, so the historical "artifacts
before feature code" gate cannot be satisfied retrospectively. This is process
history rather than a functional parity gap.

## Tree and shared-abstraction checks

- The product data/view providers are registered through
  `registerStaticWebApps` before generic Azure product registration.
- Root and environment actions use shared browse, portal, delete, selection,
  activity, and settings abstractions.
- Related-resource portal URLs use `AzureNodeId.forRelatedResource`.
- Client list operations use shared `toPages`; provider consumption uses
  `collectPageItems`.
- Resource commands use the shared `IResourceSelector`.
- Workspace location steps use the shared wizard abstractions.
- The resource icon resolves through the logical-type convention.
- SWA debugger/task/lifecycle symbols and `$swa-watch` are absent.
- Data API location discovery is absent with the generated emulator tasks
  tracked by #339.

## Confirmed dropped groups

The current SWA source, product registration, manifest, and templates were
searched for the source-specific command IDs/types:

| Group | Representative patterns | Result |
|---|---|---|
| GitHub Actions | `action.cancel`, `action.rerun`, `ActionsTree`, `Octokit`, `openGitHubLog` | no SWA product surface |
| Native workflow parser | `openYAMLConfigFile`, `WorkflowGroupTreeItem` | absent |
| Standalone extension coupling | `azureFunctions.`, `vscode-azurestaticwebapps`, `RemoteRepoApi` | absent |
| Advanced creation | `createAdvanced`, `PickSkuStep` | absent |
| CLI uninstall/eager warning | `uninstallStaticWebAppsCli`, `warnIfOutdated`, warning setting | absent |
| Emulator/debug | `SwaTaskProvider`, `SwaTaskLifecycle`, `FunctionsEmulatorAddress`, `$swa-watch` | absent and deferred |

## Known gaps and uncertainties

1. **Debugging and generated tasks are not present.** Issue
   [#339](https://github.com/microsoft/vscode-azure/issues/339) tracks the five
   related deferred rows after native Functions debugging.
2. **Repository bootstrap does not run during creation.** The extension does not
   mutate Git; a later `azd pipeline config` run can offer to create and push a
   repository when the project has no remote.
3. **No live-Azure verification is claimed by this documentation audit.**
