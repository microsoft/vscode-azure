# Azure Static Web Apps -- Migration Plan

Dependency-ordered reconstruction of the plan represented by the implementation
on the current branch. Checked tasks describe code that is present; this
document does not claim that the plan was written before that code. Unchecked
tasks are still open.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurestaticwebapps` at `84d7c8da77e431c3f1c115d88b851a3b3bbb4464` (v0.13.3) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Triage** | [TRIAGE.md](TRIAGE.md), retrospectively signed off 2026-08-28 |
| **Target** | `extensions/vscode-azure` plus `packages/azutils` |
| **Precedents** | `functions`, `acr`, `deploy`, shared settings/tool/tree services |

## How to read this plan

- Slices are ordered by dependency: clients and models before providers,
  commands, creation, and integration.
- Every task cites the triage IDs it implements or records.
- Checked tasks mean the branch contains the described implementation, not that
  unresolved review concerns have been accepted.
- Deferred work remains unchecked. Dispositions can only change in
  [TRIAGE.md](TRIAGE.md).

## Slice 0 -- Models and client

Mapping: use the azutils REST-style client wrapper and shared Azure node model,
with SDK types re-exported from azutils.

- [x] Add the Static Web Apps resource/logical type and virtual resource model.
  <- SWA-035, SWA-036, SWA-037, SWA-038, SWA-039, SWA-040, SWA-047, SWA-048
- [x] Add the minimal `StaticWebAppClient` surface used by providers, settings,
  and environment deletion; convert list operations through shared `toPages`.
  <- SWA-015, SWA-035, SWA-038, SWA-039, SWA-041
- [x] Keep malformed environment/function records as explicit virtual nodes.
  <- SWA-047, SWA-048

## Slice 1 -- Resource tree

Mapping: `StaticWebAppDataProvider` owns service data and enrichment;
`StaticWebAppViewProvider` owns labels, icons, descriptions, and context values.
Both are registered through the product registrar before generic fallback
handling.

- [x] Resolve Static Sites through product data/view providers instead of the
  standalone Azure Resources resolver. <- SWA-035
- [x] Render the root ARM resource with shared browse, portal, and delete
  context values. <- SWA-009, SWA-016, SWA-020, SWA-036
- [x] List production and preview builds as virtual environment children,
  production first, with per-environment hostnames. <- SWA-037
- [x] Probe and list managed Functions through production/build-specific
  endpoints, including help/empty states. <- SWA-028, SWA-038, SWA-039, SWA-040
- [x] Attach environment settings through the shared settings node/editor and
  adapter. <- SWA-003, SWA-004, SWA-006, SWA-007, SWA-041

## Slice 2 -- Commands and manifest

Mapping: product commands are `ManagedCommand` classes; generic capabilities
are context values consumed by shared commands.

- [x] Add `CreateSwaConfigFile`, preserving overwrite confirmation and workspace
  file APIs. <- SWA-014
- [x] Add preview environment deletion through the product client and activity
  tree. <- SWA-015
- [x] Wire shared site deletion. <- SWA-016
- [x] Wire the independent shared SWA CLI install/update command.
  <- SWA-017
- [x] Wire shared browse and portal navigation, including related-resource
  portal URLs for Functions. <- SWA-009, SWA-020
- [x] Keep Static Web Apps and Functions documentation commands.
  <- SWA-024, SWA-028
- [x] Serve environment properties through the shared `ViewProperties` command
  with a product `PropertiesAdapter`. <- SWA-027
- [x] Retain both JSON schema associations. <- SWA-055

## Slice 3 -- Creation with azd and Bicep

Mapping: one `Wizard` uses shared folder/hydration/subscription/location/name,
confirmation, Bicep generation, azd environment, provision, deploy, and endpoint
steps. Product steps provide detection and Static Web Apps locations.

- [x] Replace ARM/repository-token creation with one azd+Bicep create command
  and a Free-plan Bicep default. <- SWA-012, SWA-061, SWA-064
- [x] Generate Static Web Apps infrastructure through the pinned
  `avm/res/web/static-site:0.9.5` module and shared Bicep generation step.
  <- SWA-064
- [x] Retain all 13 source build presets as prompt defaults. <- SWA-066
- [x] Rebuild framework, API, language, and Git metadata detection over shared
  workspace indexing. <- SWA-067
- [x] Read `swa-cli.config.json` for creation prompt defaults.
  <- SWA-053
- [x] Replace native workflow polling with endpoint display and a separate
  deployment route. <- SWA-065

### Provisioning decision

The topology is a single `Microsoft.Web/staticSites` resource, so a resource
module is appropriate. The generated consumer pins
[`avm/res/web/static-site:0.9.5`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/web/static-site)
rather than introducing a multi-resource local pattern module. The shared
generator supplies the resource group and azd environment/service tags. Inputs
map directly from wizard context to `appLocation`, `apiLocation`,
`outputLocation`, and `azdServiceName`; the deployment exposes the module's
Static Site output to the shared endpoint step. The `staticWebApp` azd service
entry records `project` and `dist` only when the selected artifact is
deployable.

The current implementation edits `azure.yaml` after the shared generation step.
That is an unresolved ownership concern on PR #237 rather than an accepted
exception to the migration skill's ownership rule.

## Slice 4 -- Deployment routing

Mapping: azd remains the deployment executor. Product code currently decides
between direct `azd deploy` and interactive `azd pipeline config`, based on
artifact shape and read-only Git remote metadata.

- [x] Route supported static artifacts through azd without invoking the SWA CLI
  directly. <- SWA-012, SWA-061, SWA-064, SWA-065
- [x] Keep Git inspection read-only and require a pushed branch before CI/CD
  setup. <- SWA-010
- [x] Avoid overwriting another provider's canonical pipeline file and let
  interactive `azd pipeline config` own generated CI/CD files. <- SWA-065
- [ ] Resolve the review ownership boundary for product parsing/editing of
  `azure.yaml`, build-preset scaffolding, and product deployment routing; either
  move the capabilities upstream/shared or record an explicit accepted
  boundary. <- SWA-012, SWA-053, SWA-061, SWA-064, SWA-065, SWA-066, SWA-067

## Slice 5 -- Shared tool acquisition

Mapping: `SwaInstaller` implements the shared `ToolInstaller` contract;
`AcquireTool` owns user-visible installation/update.

- [x] Register the SWA executable, npm/Homebrew install methods, version
  discovery, and independent `vscode-azure/installSwa` command.
  <- SWA-017, SWA-057

## Deferred -- tracked, not built

- [ ] Restore the SWA debug configuration provider after native Functions
  debugging is available. Tracked by
  [#339](https://github.com/microsoft/vscode-azure/issues/339).
  <- SWA-050
- [ ] Restore dynamically generated emulator tasks as part of the same debug
  workflow. Tracked by
  [#339](https://github.com/microsoft/vscode-azure/issues/339).
  <- SWA-051
- [ ] Restore parent-debug/task termination coordination. Tracked by
  [#339](https://github.com/microsoft/vscode-azure/issues/339).
  <- SWA-052
- [ ] Restore Data API location discovery for generated emulator tasks. Tracked
  by [#339](https://github.com/microsoft/vscode-azure/issues/339).
  <- SWA-054
- [ ] Restore `$swa-watch` only if generated emulator tasks require a problem
  matcher. Tracked by
  [#339](https://github.com/microsoft/vscode-azure/issues/339).
  <- SWA-056
- [ ] Decide whether repository bootstrap belongs in a separately confirmed
  flow, in azd, or outside this extension. No tracking issue is currently
  linked. <- SWA-063

## Dropped -- recorded for parity

- GitHub Actions commands and tree: SWA-001, SWA-002, SWA-018, SWA-023,
  SWA-042, SWA-043, SWA-044, SWA-045, SWA-049, SWA-059.
- Settings file import/export and value display: SWA-005, SWA-008, SWA-025.
- Source path-default settings: SWA-030, SWA-031, SWA-033.
- Git/repository commands and native workflow parser: SWA-010, SWA-019,
  SWA-021, SWA-046.
- Standalone-extension/API coupling: SWA-011, SWA-060.
- Product-specific issue reporting and obsolete configuration:
  SWA-022, SWA-029, SWA-032.
- Advanced creation variants: SWA-013, SWA-062.
- CLI uninstall and eager warning: SWA-026, SWA-034, SWA-058.

## Open follow-ups

- [ ] Resolve the four ownership-boundary review threads on PR #237 before
  declaring creation/deployment architecture final.
  <- SWA-012, SWA-061, SWA-064, SWA-065, SWA-066, SWA-067

## Drift record

This is a retrospective plan for a branch with a long implementation history;
its earlier rebase/merge history was not recorded as migration drift at the
time. The 2026-08-28 branch audit verified the current shared abstractions:
workspace location picking, resource selection, related-resource portal URLs,
paging, settings, and tool acquisition. No historical per-rebase claim is made.

Sweeps recorded from that audit onward:

| Merge | Swept result |
|---|---|
| `main` (after #338) | Adopted the newly shared primitives it brought in; no product copy remained. |
| #327, shared View Properties | Replaced the product properties command with `StaticWebAppEnvironmentPropertiesAdapter`. This branch is now based on `alexweininger-shared-view-properties`, so #327 merges first. |
