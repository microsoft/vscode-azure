# Azure Container Apps -- Migration Triage (SIGNED)

Signed-off decision record for migrating the Azure Container Apps extension into this monorepo.
This artifact is **read-only** for Phases 3-6 of the migration: dispositions are never changed in flight,
only by editing this file and re-confirming with the reviewer.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurecontainerapps` @ `f6c93dcd1a55b6aaf27ed4edca8f6a52b5348e16` (v0.11.2) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Target** | `extensions/vscode-azure` (+ `packages/azutils`) |
| **Monorepo phase** | Phase 0/1 (internal/beta) -- parity gaps acceptable, non-core features may Defer |
| **Precedents** | `acr` (resource tree + virtual child categories), `functions` (azd create wizard, AVM pattern module), `deploy` (azd job wiring) |
| **Rows** | 140 |
| **Signed off by** | Brandon Waterloo (@bwateratmsft) |
| **Date** | 2026-09-11 |

## Granularity rule

One row per: contributed command; setting; distinct tree `contextValue`; wizard flow that can be independently
kept or dropped; distinct integration surface (client, provider, parser, exported API); dead/orphan key.
A command's handler, telemetry and menu entry are **one** row. Commands are never collapsed together.

## Dispositions

| Disposition | Count | Meaning |
|---|---|---|
| Migrate | 7 | Rebuild with the same UX, using monorepo patterns |
| Adapt | 18 | Rebuild with **changed** behaviour/UX (azd+Bicep, provider registries, tree flattening) |
| Reuse | 11 | Already provided by a shared monorepo package/command; wire it up |
| Defer | 16 | Keep, but a later phase -- the blocker is named in the rationale |
| Drop | 88 | Do not migrate |
| **Total** | **140** | |

## How decisions were reached

Recommendations were produced from the inventory and reviewed by a human in a spreadsheet, where a blank
decision meant agreement with the recommendation. Of the 140 rows: 107 were accepted as recommended, 9 were
overridden in the sheet, and 24 were decided in review conversation (the eight flagged judgment calls
and their consequences). Reviewer rationale is quoted **verbatim** where given.

Creation scope is quickstart-only, matching the source extension's create command. Project deployment
builds and pushes through azd. Deploying a prebuilt image to an existing app is a separate deferred
scenario (ACA-096, ACA-098, ACA-113), approved by Brandon Waterloo on 2026-09-11 and tracked in
[#347](https://github.com/microsoft/vscode-azure/issues/347). Image selection supplies an azd image-backed
service; registry access remains an explicit infrastructure prerequisite.

Telemetry from `cluster('ddtelvscode')` (90-day window, collected 2026-08-21) informed the command rows and is
cited **qualitatively only** -- raw counts are deliberately not committed. Re-run the roll-up here:
[all events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAACpWSQYvbMBCF7%2F4V05NsSEKvZXEvSwqBppSm7aWUMiu97AosKWjGTrzkxxfbsaFlLznqzbxv5qFpoISLUk0myJpf2wxNqZFNJzY5TIpNUdlHZD6dxDwUDZTOPrp0ppo%2BvHcPhW1aUeTSOKdoJq%2BpNo6Vn1hQmp%2BHx%2BSwvaipNt%2F4vO0QVRaxuNL5BRl0QO6Qv%2FsAUQ4n%2Bkj8nMppVrV0bS%2BKKD7FLxxAdT0kWIqaRLOPz%2BXXnE7I6iG%2FjBe26jtWnyKG2eZ3Re9qMppbmOJK0obA2b%2BiICLaxS7ZsVmIqCab2qhltRqLw%2FQcufkhyEI1ubHqj%2BUUZ8%2F2xUfs3Ip2sotT77DkkRvBjTHr9zKGdW%2BIQ2st4OCGx7yjP5Zv5s%2BQthlD1zWZxWpurE%2FsmxvoXtZknUGPHC0W1F2g2TqjPrPoAYgz6phyYP3jWKE%2BoAx8Kf87l2pFpu%2F7fr3fr50z1ch56mm8tuFWiiul7JBH8Z9vdBD7F5At0nwMAwAA).

## The eight judgment calls

| # | Call | Rows | Decision |
|---|---|---|---|
| 1 | Revision drafts | 9 | **Drop** -- although the concept is not unique to this extension, Bicep/IaC replaces its client-side staging model |
| 2 | Env vars + secrets | 14 | **Drop** -- env vars move to Bicep; secrets avoided entirely via managed identity + Key Vault references |
| 3 | Ingress + scaling | 15 | **Drop** -- expressed in Bicep |
| 4 | Remote ACR build | 4 | **Drop** -- rely entirely on azd (`docker.remoteBuild: true`) |
| 5 | GitHub connect/disconnect | 3 | **Drop** -- `azd pipeline config` owns CI/CD |
| 6 | Webviews | 2 | **Drop** |
| 7 | Copilot deploy | 2 | **Drop** |
| 8 | `deployImage` exported API | 2 | **Defer** -- live cross-extension contract |

## Tree shape directives (Phase 3)

Cross-cutting guidance agreed during review. These do not change *what* is built, only *where it surfaces*,
and they apply to every kept row in the Tree nodes section.

**1. Prefer a command over a leaf node.** A leaf whose only purpose is to be clicked is a command wearing a
node costume. Rebuild it as a `ManagedCommand` on the nearest real resource node (the container app, or a
container), contributed to **both** surfaces:

- `view/item/context` for the right-click menu, and
- the same command again with `"group": "inline"` so it appears as a hover button on the row.

Precedent already in the monorepo: `vscode-azure/settings/edit` is contributed with `"group": "inline@1"`.
Commands acting on a node need a static `ContextValue` and a `\b`-anchored regex `when` clause.

**2. Prefer `description` / `tooltip` over child rows.** A child node that only displays a value should be
folded into its parent's `description` (short, inline) or `tooltip` (long, markdown). `AcrViewProvider`
already does both. This removes a level of expansion for information the user can read at a glance.

**3. Collapse single-child grouping nodes.** A grouping node that almost always holds exactly one child adds
a click without adding information. The `Containers` group is dropped outright (ACA-068): containers hang
directly off the container app node whether there is one or many.

**4. Model properties as properties, not as parent nodes.** A container is not "an instance of an image" --
the image is one of the container's properties, so it renders in the container node's `description` /
`tooltip` rather than as a node above or below it. The image *artifact* (its repositories and tags) is owned
by the registry it lives in, so browsing it belongs to the ACR / Docker Hub products, not to the container
app tree.

**5. Do not nest one first-class Azure resource under another.** A container app is a real ARM resource, so
it belongs where every other resource lives -- directly in its resource group / resource-type group -- not
underneath its managed environment. Nesting fights the generic resource providers: the source had to build a
hierarchy provider to nest apps, a second provider to surface them flat, an id suffix to stop one resource
matching two nodes, and a reveal command to bridge the two views. Flattening deletes all four. The
environment stays a first-class resource in its own right, and the app-to-environment relationship is
expressed as a *command* (ACA-014) rather than as containment.

**6. Keep the data/view split.** Flattening is a *view* concern. Node removal happens in the `ViewProvider`
(what renders) -- the `DataProvider` still returns the underlying resources. Do not push display strings into
the data layer to make flattening easier.

### ARM model facts behind the flattening

Verified against the Container Apps REST API and ARM template reference during review. These are the
evidence base for directive 5; a future reader should not have to re-derive them.

| Question | Answer |
|---|---|
| Is a container app an ARM child of its environment? | **No.** Both are top-level resources under `Microsoft.App`. The app's id contains no trace of the environment; Bicep sets `environmentId`, never `parent:`. Nesting was pure client-side invention. |
| Deleting an environment -- cascade? | **No, blocked.** The API is documented as "Delete a Managed Environment if it does not have any container apps." Apps are never auto-deleted and never orphaned. |
| Can the environment id be derived from the app id? | **No.** GET the app and read `properties.environmentId` (`managedEnvironmentId` is the deprecated alias). |
| Environment -> apps listing? | **No such endpoint.** `managedEnvironments/{name}/containerApps` does not exist; it requires a list plus a client-side filter on `environmentId`. |
| App and environment in different resource groups? | **Yes** -- the reference is a full ARM id. Not explicitly documented as a tested configuration. |
| Different subscriptions? | **No** (strong inference: no examples, shared-VNet model, no linked-subscription support; no explicit prohibition found). |
| Different regions? | **No** -- they share a VNet, so the app runs on the environment's regional infrastructure. |
| True ARM children of an environment | `certificates`, `managedCertificates`, `daprComponents`, `storages` -- their ids *do* contain the environment name. `Microsoft.App/jobs` are siblings, like apps. |

### Resulting shape

```
Resource group (or resource-type group)
├── Container Apps Environment        first-class resource
└── Container App                     first-class resource
    │                                 [inline: browse, stream logs]
    └── Container xN                  description: <registry>/<image>:<tag>
```

The source nests five levels deep before showing a container
(`Environment > App > Containers > Container > Image`); this shows one. Everything that used to hang off the
app -- Configurations, Scaling, Logs, Revision Management -- is either expressed in Bicep, surfaced as a
command, or deferred.

Rows carrying these directives: ACA-013, ACA-014, ACA-016, ACA-017, ACA-041, ACA-062, ACA-063, ACA-064,
ACA-068, ACA-069, ACA-070, ACA-083, ACA-084, ACA-085, ACA-093, ACA-094.

## Commands (54)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-001 | `reportIssue` | cmd | A+B | **Drop** | VS Code's built-in issue reporter covers it; no per-product equivalent here | yes |
| ACA-002 | `createContainerApp` | cmd+wizard | A+B | **Adapt** | Deploy -> azd+Bicep AzdJob('createNew'); not 1:1 | yes |
| ACA-003 | `createManagedEnvironment` | cmd+wizard | A+B | **Adapt** | Environment becomes supporting infra in the Bicep topology; may lose its standalone command. Failures exceed successes today | yes |
| ACA-004 | `deleteManagedEnvironment` | cmd | A+B | **Reuse** | Generic `DeleteAzureResource`. Note ARM **blocks** deleting an environment that still contains container apps ("Delete a Managed Environment if it does not have any container apps"), so the generic delete will fail there rather than cascading -- the source's delete-all-apps-first step was required, not defensive. Accepted as a known limitation rather than rebuilding a cascade. Reviewer (verbatim): "For the delete, I'm not worried at the moment--it's a bearable limitation for users who aren't using AZD, and for those who are, `azd down` is the answer." | yes |
| ACA-005 | `deployWorkspaceProject` | cmd+wizard | A+B | **Adapt** | Flagship. -> azd deploy job + GenerateBicepStep / AzdProvisionStep / AzdDeployStep; not 1:1 | yes |
| ACA-006 | `deployWorkspaceProjectApi` | cmd | A | **Drop** | Contributed with no handler -- broken today (inventory-flagged) | yes |
| ACA-007 | `deployImageApi (compat shim)` | cmd | A+B | **Defer** | Tied to the exported API consumed by the Containers extension (ACA-127) **Blocked by:** Blocked on ACA-127 -- the shim only exists to serve the exported API. | yes |
| ACA-008 | `deployContainerApp` | cmd+wizard | A+B | **Adapt** | Source-project deployment uses the azd deploy job; the existing-image branch is deferred with ACA-096 / ACA-098 in [#347](https://github.com/microsoft/vscode-azure/issues/347). | yes |
| ACA-009 | `deployContainerAppWithCopilot` | cmd | A+B | **Drop** | 100% failure rate in-window; needs the monorepo's Copilot story Reviewer (verbatim): "Too much overlap with existing CoR work" | yes |
| ACA-010 | `deployContainerAppInternal` | cmd | B | **Drop** | Internal plumbing; ManagedCommand + IResourceSelector replace it | yes |
| ACA-011 | `deleteContainerApp` | cmd | A+B | **Reuse** | Generic DeleteAzureResource | yes |
| ACA-012 | `editContainerApp (Advanced)` | cmd | A+B | **Drop** | Prompt budget bans "Advanced" variants; also depends on revision drafts (ACA-034) | yes |
| ACA-013 | `browse` | cmd | A+B | **Reuse** | Generic BrowseWebsite. Surface on the container app node in both the context menu and the `inline` group. | yes |
| ACA-014 | `revealInEnvironment` | cmd | A+B | **Adapt** | Reinstated. With container apps flattened out to first-class resources (ACA-063), this is the navigation *from* an app *to* its hosting environment. Implementation: `await whenEnriched(app)` to get `environmentId`, derive the environment's `AzureNodeId`, then reveal it. Use `environmentId` -- **not** `managedEnvironmentId`, which the SDK marks `Deprecated` and which the source uses in ~40 places. Two Phase 3 notes: `AzureNodeId`'s constructor is private (only `parse()` is public), so deriving a sibling node id needs either a public factory or `azr://` string substitution plus `parse()`; and `TreeView.reveal` takes a single element, so this is a one-target jump. | yes |
| ACA-015 | `openConsoleInPortal` | cmd | A+B | **Reuse** | Generic OpenInPortal with a URL suffix | yes |
| ACA-016 | `startStreamingLogs` | cmd | A+B | **Migrate** | Highest-usage command. Needs new data-plane transport (ACA-118). Surface on the container app node in both the context menu and the `inline` group -- it absorbs the `logStreamItem` leaf (ACA-093), so no Logs group node is needed. See [Tree shape directives](#tree-shape-directives-phase-3). | yes |
| ACA-017 | `stopStreamingLogs` | cmd | A+B | **Migrate** | Pairs with ACA-016; same context-menu + `inline` treatment, gated on an active stream. | yes |
| ACA-018 | `editContainer` | cmd+wizard | A+B | **Drop** | Container configuration belongs in Bicep; project deployment uses the azd deploy job (ACA-008). | yes |
| ACA-019 | `editContainerImage` | cmd+wizard | A+B | **Drop** | No revision-draft image-editing command. Project images use the azd deploy job (ACA-008); prebuilt-image deployment is deferred separately in ACA-096 / ACA-098. | yes |
| ACA-020 | `addEnvironmentVariable` | cmd | A+B | **Drop** | Settings framework: one document, no per-setting commands Reviewer (verbatim): "For env, agreed, Bicep is easy here. We already have a need and an issue to steer users from editing settings directly toward doing it in the Bicep, so nothing to add there." | yes |
| ACA-021 | `editEnvironmentVariables (.env)` | cmd | A+B | **Drop** | Same; bulk.env edit is the document itself | yes |
| ACA-022 | `editEnvironmentVariableName` | cmd | A+B | **Drop** | Same | yes |
| ACA-023 | `editEnvironmentVariableValue` | cmd | A+B | **Drop** | Same | yes |
| ACA-024 | `convertEnvironmentVariable (->secret)` | cmd | A+B | **Drop** | Same; ACA-specific semantics lost -- judgment call | yes |
| ACA-025 | `deleteEnvironmentVariable` | cmd | A+B | **Drop** | Same | yes |
| ACA-026 | `toggleEnvironmentVariableVisibility` | cmd | A+B | **Drop** | Framework shows no values in the tree, so nothing to toggle | yes |
| ACA-027 | `enableIngress` | cmd+wizard | A+B | **Drop** | Ingress belongs in Bicep/IaC -- judgment call, group Reviewer (verbatim): "Drop in favor of Bicep editing" | yes |
| ACA-028 | `disableIngress` | cmd+wizard | A+B | **Drop** | Same group | yes |
| ACA-029 | `toggleVisibility` | cmd+wizard | A+B | **Drop** | Same group | yes |
| ACA-030 | `editTargetPort` | cmd+wizard | A+B | **Drop** | Same group | yes |
| ACA-031 | `addSecret` | cmd+wizard | A+B | **Drop** | JC2. Registry auth uses managed identity (`RegistryCredentials.identity`) and application secrets become Key Vault references (`Secret.keyVaultUrl` + `Secret.identity`), so no secret value ever enters Bicep, ARM or the extension. No settings adapter needed. Reviewer (verbatim): "For secrets, what I'm really wondering is, if we can avoid them altogether. For example, in our Functions template, we use a managed identity, assigned to the app itself, and granted access to storage, app insights, etc. etc. Not a single secret anywhere." | yes |
| ACA-032 | `editSecretValue` | cmd+wizard | A+B | **Drop** | No per-setting commands | yes |
| ACA-033 | `deleteSecret` | cmd+wizard | A+B | **Drop** | No per-setting commands | yes |
| ACA-034 | `createRevisionDraft` | cmd | A+B | **Drop** | JC1. Although revision drafts are not unique to this extension, this implementation is a client-side staging buffer over the ARM `template` property rather than a distinct ARM resource; deploying one is an ordinary container app update. Bicep + re-provision provides the same batching, with a real diff and git as the discard mechanism. Reviewer (verbatim): "I agree, drop revision drafts. Bicep / IaC is the way." | yes |
| ACA-035 | `editRevisionDraft` | cmd | A+B | **Drop** | JC1 revision drafts -> Bicep/IaC. | yes |
| ACA-036 | `deployRevisionDraft` | cmd+wizard | A+B | **Drop** | JC1 revision drafts -> Bicep/IaC. | yes |
| ACA-037 | `discardRevisionDraft` | cmd | A+B | **Drop** | JC1 revision drafts -> Bicep/IaC. | yes |
| ACA-038 | `chooseRevisionMode` | cmd+wizard | A+B | **Drop** | `activeRevisionsMode` is a Bicep template property, so revision mode is configuration and belongs in IaC alongside ingress and scaling. | yes |
| ACA-039 | `activateRevision` | cmd | A+B | **Defer** | Same group; zero successes in-window **Blocked by:** Revision management beyond restart; revisit post-MVP if users ask. | yes |
| ACA-040 | `deactivateRevision` | cmd | A+B | **Defer** | Same group **Blocked by:** Revision management beyond restart; revisit post-MVP if users ask. | yes |
| ACA-041 | `restartRevision` | cmd | A+B | **Migrate** | Moderate real usage; simple ARM op, maps cleanly. Surface on the container app node in both the context menu and the `inline` group. | yes |
| ACA-042 | `editScaleRange` | cmd+wizard | A+B | **Drop** | Scaling belongs in Bicep -- judgment call, group | yes |
| ACA-043 | `addScaleRule` | cmd+wizard | A+B | **Drop** | Same group | yes |
| ACA-044 | `deleteScaleRule` | cmd+wizard | A+B | **Drop** | Same group | yes |
| ACA-045 | `connectToGitHub` | cmd | A+B | **Drop** | JC5. `azd pipeline config` owns CI/CD bootstrap and is OIDC-first. The ACA sourcecontrols contract requires an Entra service principal plus client secret, which contradicts the managed-identity direction -- and creating one needs Microsoft Graph scopes VS Code does not have, which is why the command is only a portal redirect today. Reviewer (verbatim): "Agree, drop all three. Love AZD here." | yes |
| ACA-046 | `disconnectRepo` | cmd+wizard | A+B | **Drop** | JC5. Only meaningful for connections we no longer create; the portal can disconnect. | yes |
| ACA-047 | `openGitHubRepo` | cmd | A+B | **Drop** | Zero successes; trivial URL open | yes |
| ACA-048 | `createAcr` | cmd+wizard | A+B | **Reuse** | ACR product + AcrClient already exist; azd/Bicep creates registries | yes |
| ACA-049 | `openAcrBuildLogs` | cmd | A+B | **Drop** | JC4. azd streams the ACR build log itself during remote build. Reverses an earlier Migrate override once the azd research landed. | yes |
| ACA-050 | `walkthrough.gettingStarted.internal` | cmd | A+B | **Drop** | Onboarding after core features land Reviewer (verbatim): "No need for walkthrough anymore" | yes |
| ACA-051 | `walkthrough.addWorkspaceProject` | cmd | A+B | **Drop** | Same Reviewer (verbatim): "No need for walkthrough anymore" | yes |
| ACA-052 | `walkthrough.azureSignIn` | cmd | A+B | **Drop** | Wraps SignIn, which exists; defer with the walkthrough Reviewer (verbatim): "No need for walkthrough anymore" | yes |
| ACA-053 | `walkthrough.deployWorkspaceProject` | cmd | A+B | **Drop** | Same Reviewer (verbatim): "No need for walkthrough anymore" | yes |
| ACA-054 | `walkthrough.cleanUpResources` | cmd | A+B | **Drop** | Same Reviewer (verbatim): "No need for walkthrough anymore" | yes |

## Settings (7)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-055 | `containerApps.deploymentConfigurations` | setting | A | **Drop** | Project/deployment config belongs in azure.yaml, not VS Code settings | n/a -- no telemetry event |
| ACA-056 | `deployWorkspaceProject.containerRegistryName` | setting | A | **Drop** | V1 legacy; same ownership boundary | n/a -- no telemetry event |
| ACA-057 | `deployWorkspaceProject.containerAppName` | setting | A | **Drop** | V1 legacy | n/a -- no telemetry event |
| ACA-058 | `deployWorkspaceProject.containerAppResourceGroupName` | setting | A | **Drop** | V1 legacy | n/a -- no telemetry event |
| ACA-059 | `containerApps.enableOutputTimestamps` | setting | A | **Drop** | Monorepo logging conventions own output formatting | n/a -- no telemetry event |
| ACA-060 | `containerApps.deleteConfirmation` | setting | A | **Reuse** | Generic delete command owns confirmation UX | n/a -- no telemetry event |
| ACA-061 | `containerApps.showDraftCommandDeployPopup` | setting | A | **Drop** | JC1. Setting exists only to suppress the draft deploy prompt. | n/a -- no telemetry event |

## Tree nodes (33)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-062 | `managedEnvironmentItem` | node | B | **Adapt** | First-class resource node on `microsoft.app/managedenvironments`, but **no longer the parent of container apps** -- apps are flattened out (ACA-063). Renders as a leaf. Note that leaf status is a *scope* choice, not a structural one: environments do have true ARM child resources whose ids contain the environment name (`certificates`, `managedCertificates`, `daprComponents`, `storages`). None are in scope, but a future reader should not conclude environments cannot have children. | n/a -- no telemetry event |
| ACA-063 | `containerAppItem` | node | B | **Adapt** | First-class resource node on `microsoft.app/containerapps`, rooted directly in the resource group / resource-type group rather than nested under an environment. Status tokens become command `ContextValue`s. See [Tree shape directives](#tree-shape-directives-phase-3). | n/a -- no telemetry event |
| ACA-064 | `containerAppResourceItem (flat)` | node | B | **Drop** | The *concept* -- container apps as a flat, first-class list -- becomes the primary model (ACA-063), but this class does not migrate: it existed only to stop the host's secondary resource-type group rendering an unhandled stub, and the monorepo's resource providers render every type correctly. Drops the `#flat` id-disambiguation hack with it, since an app now appears exactly once. | n/a -- no telemetry event |
| ACA-065 | `revisionsItem` | node | B | **Defer** | Revision-management group **Blocked by:** Needed only if revision management (ACA-039/040) is built. | n/a -- no telemetry event |
| ACA-066 | `revisionDraftItem` | node | B | **Drop** | JC1 revision drafts -> Bicep/IaC. | n/a -- no telemetry event |
| ACA-067 | `revisionItem` | node | B | **Defer** | Revision-management group **Blocked by:** Needed only if revision management (ACA-039/040) is built. | n/a -- no telemetry event |
| ACA-068 | `containersItem` | node | B | **Drop** | No grouping node. Containers hang directly off the container app node, single or multiple -- the group adds a click without adding information, and in the single-container case the source already made it masquerade as the container itself. | n/a -- no telemetry event |
| ACA-069 | `containerItem` | node | B | **Adapt** | Becomes the direct child of the container app node and carries the image as its own `description` / `tooltip`. The container is the thing; the image is one of its properties, not its parent. | n/a -- no telemetry event |
| ACA-070 | `imageItem` | node | B | **Drop** | Not a node. The image is a property of the container (ACA-069), not a level above it -- a container is not "an instance of an image". Browsing images themselves (repositories, tags) belongs to the registry products (ACR / Docker Hub), not the container app tree. | n/a -- no telemetry event |
| ACA-071 | `environmentVariablesItem` | node | B | **Drop** | Replaced by the shared settings node | n/a -- no telemetry event |
| ACA-072 | `environmentVariableItem` | node | B | **Drop** | Framework shows no values in the tree | n/a -- no telemetry event |
| ACA-073 | `scaleItem` | node | B | **Drop** | Scaling moves to IaC | n/a -- no telemetry event |
| ACA-074 | `scaleRuleGroupItem` | node | B | **Drop** | Same | n/a -- no telemetry event |
| ACA-075 | `scaleRuleItem` | node | B | **Drop** | Same | n/a -- no telemetry event |
| ACA-076 | `configurationItem` | node | B | **Drop** | Replaced by the settings virtual node | n/a -- no telemetry event |
| ACA-077 | `ingressEnabledItem` | node | B | **Drop** | Ingress moves to IaC | n/a -- no telemetry event |
| ACA-078 | `ingressDisabledItem` | node | B | **Drop** | Same | n/a -- no telemetry event |
| ACA-079 | `secretsItem` | node | B | **Drop** | JC2. With secrets expressed as Key Vault references in Bicep, the tree node has nothing to add; secret names are read from the template. | n/a -- no telemetry event |
| ACA-080 | `secretItem` | node | B | **Drop** | No values in the tree | n/a -- no telemetry event |
| ACA-081 | `containerAppsActionsItem (GitHub)` | node | B | **Drop** | JC5. Nothing to display without the connect flow. | n/a -- no telemetry event |
| ACA-082 | `daprEnabledItem` | node | B | **Defer** | Dapr config surface; low value pre-GA **Blocked by:** Dapr surface; out of scope pre-GA. | n/a -- no telemetry event |
| ACA-083 | `logsGroupItem` | node | B | **Adapt** | The Logs group node disappears; its two leaves become commands on the container app node (ACA-016 stream, ACA-094 open-in-portal), each in the context menu and the `inline` group. Capability preserved, surface changed. | n/a -- no telemetry event |
| ACA-084 | `containerImageNameItem` | node | B | **Drop** | Not a node. The image name is part of the container node's `description` / `tooltip` (ACA-069). | n/a -- no telemetry event |
| ACA-085 | `containerImageRegistryItem` | node | B | **Drop** | Not a node. The registry is part of the container node's `tooltip` (ACA-069); registry browsing belongs to the ACR product. | n/a -- no telemetry event |
| ACA-086 | `minMaxReplicaItem` | node | B | **Drop** | Scaling group | n/a -- no telemetry event |
| ACA-087 | `visibilityItem` | node | B | **Drop** | Ingress group | n/a -- no telemetry event |
| ACA-088 | `targetPortItem` | node | B | **Drop** | Ingress group | n/a -- no telemetry event |
| ACA-089 | `daprDisabledItem` | node | B | **Defer** | Dapr group **Blocked by:** Dapr surface; out of scope pre-GA. | n/a -- no telemetry event |
| ACA-090 | `daprAppIdItem` | node | B | **Defer** | Dapr group **Blocked by:** Dapr surface; out of scope pre-GA. | n/a -- no telemetry event |
| ACA-091 | `daprAppPortItem` | node | B | **Defer** | Dapr group **Blocked by:** Dapr surface; out of scope pre-GA. | n/a -- no telemetry event |
| ACA-092 | `daprAppProtocol` | node | B | **Defer** | Dapr group; fix the description/contextValue swap if kept **Blocked by:** Dapr surface; out of scope pre-GA. Fix the description/contextValue swap if ever built. | n/a -- no telemetry event |
| ACA-093 | `logStreamItem` | node | B | **Adapt** | Not a node. Becomes the `inline` + context-menu affordance for ACA-016 on the container app node. | n/a -- no telemetry event |
| ACA-094 | `logsItem` | node | B | **Reuse** | Not a node. Generic open-in-portal command on the container app node, pointed at the app's logs blade. | n/a -- no telemetry event |

## Wizard flows & sub-flows (16)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-095 | `Quickstart image source` | wizard step | B | **Adapt** | Becomes a Bicep default, not a prompt | n/a -- no telemetry event |
| ACA-096 | `ACR image source (registry/repo/tag pick)` | wizard step | B | **Defer** | Supplies a prebuilt image to an azd-backed deployment targeting an existing app. **Blocked by:** the image-backed service workflow and registry-access contract in [#347](https://github.com/microsoft/vscode-azure/issues/347). | n/a -- no telemetry event |
| ACA-097 | `Docker Hub image source` | wizard step | B | **Defer** | Unauthenticated, public-only; niche **Blocked by:** Non-ACR registry support; revisit on demand. | n/a -- no telemetry event |
| ACA-098 | `"Other registry" free-text image` | wizard step | B | **Defer** | Fully qualified prebuilt-image input for the same azd workflow as ACA-096. **Blocked by:** [#347](https://github.com/microsoft/vscode-azure/issues/347); private-registry access must be configured explicitly. | n/a -- no telemetry event |
| ACA-099 | `Remote ACR build pipeline (tar -> blob -> run -> poll)` | wizard flow | B | **Drop** | JC4. azd covers this via `docker.remoteBuild: true`, using the same ACR Tasks APIs (`GetBuildSourceUploadURL` -> blob upload -> `BeginScheduleRun` with a `DockerBuildRequest` -> poll -> log SAS URL). Reviewer (verbatim): "let's plan on relying entirely on AZD for JC4" | n/a -- no telemetry event |
| ACA-100 | `Dockerfile --platform strip workaround` | parser | B | **Drop** | JC4. azd does not strip `FROM --platform=`; per the ownership rule that fix belongs upstream in azd, not as a Dockerfile rewriter maintained here. File an azd issue. | n/a -- no telemetry event |
| ACA-101 | `Registry credentials -- managed identity` | wizard flow | B | **Adapt** | Becomes Bicep (identity + AcrPull role assignment) | n/a -- no telemetry event |
| ACA-102 | `Registry credentials -- docker login / admin user` | wizard flow | B | **Drop** | Admin-user auth is discouraged; identity path supersedes | n/a -- no telemetry event |
| ACA-103 | `env discovery & parsing` | detector | B | **Drop** | Env config belongs to the settings adapter / azd | n/a -- no telemetry event |
| ACA-104 | `Ingress auto-config from Dockerfile EXPOSE` | detector | B | **Adapt** | Useful as a Bicep parameter default, not a prompt | n/a -- no telemetry event |
| ACA-105 | `Start verification + Log Analytics fetch` | execute step | B | **Migrate** | Real diagnostic value; feeds Copilot context | n/a -- no telemetry event |
| ACA-106 | `V1 -> V2 settings conversion` | migration | B | **Drop** | Both schemas dropped (ACA-055-058) | n/a -- no telemetry event |
| ACA-107 | `Basic vs Advanced deployment mode` | wizard flow | B | **Drop** | Prompt budget explicitly bans the mode split | n/a -- no telemetry event |
| ACA-108 | `Saved deployment-configuration reuse` | wizard flow | B | **Drop** | Replaced by azd environments | n/a -- no telemetry event |
| ACA-109 | `Revision-draft deploy prompt` | wizard step | B | **Drop** | JC1 revision drafts -> Bicep/IaC. | n/a -- no telemetry event |
| ACA-110 | `Overwrite / unsupported-features confirm` | wizard step | B | **Adapt** | Keep the safety warning; rebuild on monorepo confirm | n/a -- no telemetry event |

## Integrations (27)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-111 | `ContainerAppsAPIClient wrapper` | client | B | **Migrate** | New ContainerAppsClient.ts in azutils; re-export SDK types | n/a -- no telemetry event |
| ACA-112 | `ContainerRegistry management client` | client | B | **Reuse** | AcrClient exists | n/a -- no telemetry event |
| ACA-113 | `@azure/container-registry data-plane client` | client | B | **Defer** | Supporting ACR discovery for ACA-096, only as needed; reuse shared clients rather than require a particular SDK. **Blocked by:** image-selection UX in [#347](https://github.com/microsoft/vscode-azure/issues/347). | n/a -- no telemetry event |
| ACA-114 | `Authorization client (role assignments)` | client | B | **Adapt** | Role assignment moves into Bicep | n/a -- no telemetry event |
| ACA-115 | `LogsQueryClient (@azure/monitor-query)` | client | B | **Migrate** | Backs ACA-105 | n/a -- no telemetry event |
| ACA-116 | `Storage blob upload (source archive)` | client | B | **Drop** | JC4. azd performs the source-archive upload. | n/a -- no telemetry event |
| ACA-117 | `Docker Hub v2 REST client` | client | B | **Defer** | Only for ACA-097 **Blocked by:** Client for ACA-097; deferred with it. | n/a -- no telemetry event |
| ACA-118 | `Log-stream data-plane transport` | provider | B | **Migrate** | Non-trivial: ARM token exchange + cross-origin redirect opt-in + chunked stream | n/a -- no telemetry event |
| ACA-119 | `Revision-draft FileSystemProvider` | provider | B | **Drop** | JC1. The virtual filesystem is the draft mechanism itself. | n/a -- no telemetry event |
| ACA-120 | `Confirmation webview (React/Fluent)` | webview | B | **Drop** | New capability for the monorepo -- judgment call Reviewer (verbatim): "Drop the webviews" | n/a -- no telemetry event |
| ACA-121 | `Loading webview` | webview | B | **Drop** | Same | n/a -- no telemetry event |
| ACA-122 | `Copilot deploy integration` | integration | B | **Drop** | Orphaned by the Copilot drop (ACA-009) and depends on the dropped confirmation webview. | n/a -- no telemetry event |
| ACA-123 | `Channel / Transport RPC scaffolding` | code | B | **Drop** | Unwired dead code in the source | n/a -- no telemetry event |
| ACA-124 | `azd detection (telemetry only)` | detector | B | **Drop** | Monorepo *is* azd-first; the signal is meaningless here | n/a -- no telemetry event |
| ACA-125 | `Portal URL builder` | helper | B | **Reuse** | Generic portal helpers | n/a -- no telemetry event |
| ACA-126 | `Branch data provider + host API handshake` | provider | B | **Adapt** | -> registerTrees.ts; no host handshake in the monorepo | n/a -- no telemetry event |
| ACA-127 | `Exported API deployImage` | api | B | **Defer** | Consumer found: Containers/Docker extension ("Deploy Image to Azure Container Apps..."). Breaking it breaks a shipping contract **Blocked by:** External contract: the Containers/Docker extension calls this API today. Needs an owner-level decision before it can be dropped or rebuilt. | n/a -- no telemetry event |
| ACA-128 | `Exported API deployWorkspaceProject` | api | B | **Drop** | No consumer found in this monorepo | n/a -- no telemetry event |
| ACA-129 | `Test API (VSCODE_RUNNING_TESTS)` | api | B | **Drop** | Monorepo has its own test seams | n/a -- no telemetry event |
| ACA-130 | `jsonValidation containerapp-template schema` | contribution | A | **Drop** | JC1. The schema exists to validate the draft document. | n/a -- no telemetry event |
| ACA-131 | `Walkthrough contribution (5 steps)` | contribution | A | **Drop** | With ACA-050-054 | n/a -- no telemetry event |
| ACA-132 | `Unused proposed APIs (authenticationChallenges, authLearnMore)` | code | B | **Drop** | Vendored but never enabled or consumed | n/a -- no telemetry event |
| ACA-133 | `browser/fs-extra stub` | code | B | **Drop** | Dead stub; no browser bundle exists | n/a -- no telemetry event |
| ACA-134 | `Resource-provider registration step` | wizard step | B | **Adapt** | azd/Bicep handles RP registration | n/a -- no telemetry event |
| ACA-135 | `Product icons (8 SVGs)` | asset | B | **Adapt** | Check azutils/resources/azureIcons/ first; only add what's missing | n/a -- no telemetry event |
| ACA-136 | `Activity-log integration` | integration | B | **Reuse** | Activity view + ARM deployment provider exist | n/a -- no telemetry event |
| ACA-137 | `Output channel` | integration | B | **Reuse** | Monorepo logging | n/a -- no telemetry event |

## Dead / orphan (3)

| ID | Feature | Kind | Layer | Disposition | Rationale | Usage consulted |
|---|---|---|---|---|---|---|
| ACA-138 | `NLS containerApps.viewProperties` | nls | - | **Drop** | Dead key, no behavior | n/a -- no telemetry event |
| ACA-139 | `NLS containerApps.revealResource` | nls | - | **Drop** | Dead key, no behavior | n/a -- no telemetry event |
| ACA-140 | `NLS containerApps.openInPortal` | nls | - | **Drop** | Dead key, no behavior | n/a -- no telemetry event |

## Follow-up ideas (not migrated features)

Raised during review. These are **not** dispositioned features and carry no migration obligation --
they are recorded so the reasoning is not lost.

- **Environment -> apps browsing.** Flattening apps out from under environments (ACA-063) removes the only
  path for "show me every app in this environment". The inverse jump exists as a command (ACA-014), but not
  this direction. There is no ARM endpoint for it either, so it would need a list plus a client-side filter
  on `environmentId` -- and because an app may sit in a *different* resource group than its environment, a
  resource-group-scoped list can miss apps. A subscription-scoped list or Azure Resource Graph would be
  required. If wanted later, the natural shape is a filter or a "reveal apps in this environment" command
  rather than re-nesting the resources.
- **Image browsing belongs to the registry products.** Container images (repositories, tags, manifests) are
  ACR / Docker Hub artifacts, not container app children. If image browsing is wanted, it belongs in the ACR
  product tree, where `AcrClient` and the ACR data/view providers already exist. The container app tree only
  ever shows *which* image a container runs, as a property of that container.
- **CI/CD story is `azd pipeline config`.** If GitHub deployment is wanted later, surface azd's OIDC-first
  pipeline configuration rather than rebuilding the ACA `sourcecontrols` flow.
- **Emit `docker.remoteBuild: true`** when generating `azure.yaml`. azd defaults to a *local* Docker build;
  the source extension builds in ACR and therefore never required Docker locally. Opting into remote build
  preserves that property. Constraints: remote build is `linux/amd64` only and ACR only.
- **File an azd issue** for `FROM --platform=` handling in remote builds (the source extension strips it as a
  workaround for ACR Tasks; azd does not).
- **AVM candidate:** `avm/ptn/azd/container-app-upsert` appears in azd's reference templates and is the
  starting point for the Phase 3 AVM-first search.

## Source bugs -- fix rather than port

- `DaprItem` sets `description` to the context-value constant and `contextValue` to a bare literal, so the
  tree displays the string `daprAppProtocolItem` as a description (ACA-092, deferred).
- Two distinct tree callbacks share the telemetry id `getChildren` (`ConfigurationItem` and `RevisionsItem`),
  making those paths indistinguishable in telemetry.
- Source `contextValue` regexes use bare substrings with no word boundary, so `containerItem` also matches
  `containersItem`. The monorepo's `\b`-anchored convention fixes this; do not reproduce it.
