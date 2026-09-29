# Azure Container Apps -- Migration Plan

Dependency-ordered implementation plan for migrating the Azure Container Apps features into this
monorepo. Every task is tagged with the [TRIAGE.md](TRIAGE.md) ID that authorizes it, so parity can be
audited against the signed decision record.

| | |
|---|---|
| **Source** | `microsoft/vscode-azurecontainerapps` @ `f6c93dcd1a55b6aaf27ed4edca8f6a52b5348e16` (v0.11.2) |
| **Inventory** | [INVENTORY.md](INVENTORY.md) |
| **Triage (signed)** | [TRIAGE.md](TRIAGE.md) -- Brandon Waterloo (@bwateratmsft), 2026-09-11 |
| **Target** | `extensions/vscode-azure` (+ `packages/azutils`) |
| **Precedents** | `functions` (azd create/deploy wizard, AVM module, `WebApp*` providers), `acr` (product registrar, virtual children), `deploy` (azd job wiring) |
| **Monorepo phase** | Phase 0/1 (internal/beta) -- parity gaps acceptable, non-core features may Defer |

## How to read this plan

- Tasks are grouped into **slices**. Each slice compiles and is validated on top of the previous one.
- `<- ACA-0xx` tags the task with its `TRIAGE.md` row. Dispositions are **read-only** here; if a task
  reveals that a disposition is wrong, edit `TRIAGE.md` and re-confirm with the reviewer rather than
  re-deciding in flight.
- Each slice carries a **mapping record** (Phase 3 output): the monorepo pattern, exact target files, the
  precedent whose shape is copied, the shared-primitive sweep result, activation cost, and any external
  fact with its source. A task with no mapping record is unfinished mapping, not ready work.
- **Migrate** = same UX in new patterns. **Adapt** = deliberately changed UX. **Reuse** = wire up
  something that already exists. Every ID appears somewhere in this file, including Drop rows.

## Target tree shape

Per the [tree shape directives](TRIAGE.md#tree-shape-directives-phase-3), container apps are flattened out
from under their environments and both become ordinary first-class resources:

```
Resource group (or resource-type group)
├── Container Apps Environment        first-class resource, leaf
└── Container App                     first-class resource
    │                                 [inline: browse, stream logs, restart]
    └── Container xN                  description: <registry>/<image>:<tag>
```

---

## Provisioning decision (AVM-first record)

**Required topology** (subscription scope, greenfield "create a container app from a workspace project"):

| # | ARM type | Notes |
|---|---|---|
| 1 | `Microsoft.Resources/resourceGroups` | deployment-scope container, created by the consumer |
| 2 | `Microsoft.OperationalInsights/workspaces` | app logs destination for the environment |
| 3 | `Microsoft.App/managedEnvironments` | `appLogsConfiguration` -> #2 |
| 4 | `Microsoft.ManagedIdentity/userAssignedIdentities` | app identity; replaces every secret-based path |
| 5 | `Microsoft.ContainerRegistry/registries` | destination for the project image built and pushed by azd |
| 6 | `Microsoft.Authorization/roleAssignments` | AcrPull for #4 on #5 |
| 7 | `Microsoft.App/containerApps` | **primary**; `azd-service-name` tag, ingress, MSI registry auth |

**AVM search result.** Searched `Azure/bicep-registry-modules` under `avm/res/app/*` and `avm/ptn/*` by ARM
type and product name, and read each candidate's `main.bicep` rather than judging by name:

| Module | Latest | Covers | Verdict |
|---|---|---|---|
| [`avm/ptn/azd/container-app-upsert`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/ptn/azd/container-app-upsert) | `0.4.0` | #7 + #6 (AcrPull via [`avm/ptn/azd/acr-container-app:0.5.0`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/ptn/azd/acr-container-app)); MSI-only registry auth, no admin user, no secrets | Covers the primary resource only -- requires #3, #4, #5 to pre-exist |
| [`avm/ptn/azd/container-apps-stack`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/ptn/azd/container-apps-stack) | `0.4.0` | #3 + #5 | Requires the Log Analytics workspace to pre-exist; creates no identity, role assignment, or app |
| [`avm/ptn/azd/monitoring`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/ptn/azd/monitoring) | `0.1.0` | #2 (+ Application Insights) | Monitoring only |
| [`avm/res/managed-identity/user-assigned-identity`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/managed-identity/user-assigned-identity) | `0.4.x` | #4 | Single resource |
| [`avm/res/app/container-app`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/app/container-app) | `0.23.0` | #7 | Resource module; a multi-resource topology may not be assembled from resource modules |
| [`avm/res/app/managed-environment`](https://github.com/Azure/bicep-registry-modules/tree/main/avm/res/app/managed-environment) | `0.15.0` | #3 | Resource module; `appLogsConfiguration` shape changed in `0.12.0` |

**No single published AVM pattern module covers the whole topology.** The closest composition -- and what
azd's own reference templates use (see
[`todo-nodejs-mongo-aca/infra/main.bicep`](https://github.com/Azure-Samples/todo-nodejs-mongo-aca/blob/main/infra/main.bicep))
-- is `monitoring` + `container-apps-stack` + `user-assigned-identity` + `container-app-upsert`.

**Decision (reviewer, this session).** Take the skill's two-file fallback: author one AVM-shaped local
**pattern** module that owns the complete topology, plus a thin consumer. The local module is not written
from scratch -- **it composes the published AVM modules above**, so the stand-in is exactly the pattern
module AVM is missing rather than a re-implementation of modules that already exist. Publishing the real
module is tracked by [#329](https://github.com/microsoft/vscode-azure/issues/329) (the Container Apps
analog of [#112](https://github.com/microsoft/vscode-azure/issues/112) for Functions); when it lands, the
local module collapses to a single pinned `br/public:` reference and the consumer does not change.

**Generated layout** (module boundary preserved, per the fallback rules):

```text
extensions/vscode-azure/resources/templates/containerApp/
  main.bicep                                  -> infra/main.bicep          (consumer: resource group + azd params)
  modules/container-app-topology/main.bicep   -> infra/modules/container-app-topology/main.bicep
```

The consumer owns `targetScope = 'subscription'`, the resource group, and the azd
`environmentName`/`location` placeholders. The local module owns the topology and exposes a
registry-contract-shaped interface, so swapping its path for `br/public:avm/ptn/azd/...` later is a
one-line change.

**Parameter / output map** (wizard input -> module parameter -> post-create consumer):

| Wizard input | Module parameter | Source | Triage |
|---|---|---|---|
| azd env name | `environmentName` | `AZURE_ENV_NAME` placeholder | -- |
| location | `location` | `AZURE_LOCATION` placeholder | -- |
| azd service name | `azdServiceName` -> `tags['azd-service-name']` on the app only | `ProjectNameStep` / hydration | -- |
| image | upsert pattern's quickstart default; existing image retained on repeat provision | automatic; azd builds the project image on deploy | ACA-095 |
| existing app name | `containerAppName` -> upsert `exists` | `${AZURE_CONTAINER_APP_NAME}` persisted by azd | ACA-002, ACA-005 |
| ingress + target port | `ingressEnabled`, `targetPort` (default from Dockerfile `EXPOSE`) | detector default, not a prompt | ACA-104 |
| -- | `identityType: 'UserAssigned'` + AcrPull | always; no secrets, no admin user | ACA-101, ACA-114 |

| Module output | Consumed by |
|---|---|
| `uri` | `ShowEndpointUrlStep` / browse affordance |
| `resourceId`, `name`, `resourceGroupName` | tree invalidation + start verification (ACA-105) |
| `containerRegistryName` | azd image push target |

**Resource-provider registration** (ACA-134): `Microsoft.App`, `Microsoft.OperationalInsights`,
`Microsoft.ContainerRegistry` are registered by ARM as a side effect of the deployment; azd/Bicep owns
this, so no `VerifyProvidersStep` equivalent is built.

---

## Slice 0 -- Foundations

> **Mapping record.** Pattern: resource-model file + guards, azutils client wrapper.
> Target files: `extensions/vscode-azure/src/tree/resources/containerApps/{ContainerApp,ManagedEnvironment}.ts`,
> `packages/azutils/src/rest/clients/ContainerAppsClient.ts`.
> Precedent: `tree/resources/acr/AcrRegistry.ts`, `rest/clients/AcrClient.ts`.
> Shared-primitive sweep: reused `isGenericResource` / `GenericResource` / `getResourceGroupName` /
> `createArmRestSubscriptionClient` / `WithRequired` / `SyncFactory` from azutils+utils; searched
> `CaselessSet` for the multi-type guard shape (as in `webApp/WebApp.ts`), reused. No new primitive needed.
> Activation: none -- providers and commands are registered cheaply and do their work on first use.
> External facts: `@azure/arm-appcontainers@4.0.0-beta.1` is the modular REST-style SDK exposing
> `./api`, `./api/containerApps`, `./api/containerAppsRevisions`, `./api/managedEnvironments`, `./models`
> (verified via `npm view @azure/arm-appcontainers@4.0.0-beta.1 exports`); the GA `3.0.0` line exposes only
> the class-based root entry point and does not fit the wrapper pattern. Beta ARM SDKs are already the norm
> here (`@azure/arm-resources@^8.0.0-beta.1`). Icons `microsoft.app/containerapps.svg` and
> `microsoft.app/managedenvironments.svg` already ship in `packages/azutils/resources/azureIcons/`
> (directory listed; nothing to add).

- [x] Add `ContainerApp.ts`: `ContainerAppResourceType = 'Microsoft.App/containerApps'`, the enriched
      `ContainerApp` / `EnrichedContainerApp` interfaces, and `isContainerApp()` comparing `logicalType`
      case-insensitively against the constant  <- ACA-063
- [x] Add `ManagedEnvironment.ts`: `ManagedEnvironmentResourceType = 'Microsoft.App/managedEnvironments'`
      and `isManagedEnvironment()`  <- ACA-062
- [x] Add `@azure/arm-appcontainers` (single consumer -> direct version specifier in
      `packages/azutils/package.json`, not the catalog) and `pnpm install`  <- ACA-111
- [x] Add `ContainerAppsClient.ts` wrapper: `IContainerAppsClient`, `IContainerAppsClientProvider`,
      static `create()` over `createArmRestSubscriptionClient`, normalizing the SDK's free functions into
      `client.containerApps.*` / `client.containerAppsRevisions.*` / `client.managedEnvironments.*`.
      Re-export every SDK type used in the public surface (`ContainerApp`, `Revision`, `Container`,
      `ManagedEnvironment`) from `packages/azutils/src/index.ts`  <- ACA-111
- [x] Bind the client provider in a new `products/registerContainerApps.ts` via
      `registrar.registerAzureClientProvider`, and add it to `registerProducts.ts` **before**
      `registerGenericAzure`  <- ACA-126
- [x] Confirm (do not add) the two existing resource icons resolve by `logicalType` convention  <- ACA-135

## Slice 1 -- Resource nodes in the tree

> **Mapping record.** Pattern: `DataProvider` branch + `ViewProvider` branch + type guards, registered
> specific-before-generic. Target files:
> `src/tree/resources/containerApps/{ContainerAppsDataProvider,ContainerAppsViewProvider}.ts`.
> Precedent: `webApp/WebAppDataProvider.ts` (enrichment + website URL + expandable node) and
> `acr/AcrViewProvider.ts` (description/tooltip, virtual children).
> Shared-primitive sweep: reused `setWebsiteUrl`/`getWebsiteUrl` (`tree/resources/websiteUrl.ts`),
> `resourceContextValue`/`combineContextValues` (`tree/contextValueHelpers.ts`),
> `createGenericResourceTreeItem` (`GenericAzureViewProvider.ts`), `getResourceTypeIconUri`
> (`tree/iconPath.ts`), `isVirtualResource`/`VirtualResource` and `AzureNodeId` from azutils. Searched
> `image`, `container`, `logStream` across both packages -- no existing container-level abstraction, so
> containers are modeled as `VirtualResource` children exactly like ACR's category nodes.
> Activation: none.
> Tree contract: see the table below; every menu entry gates on `viewItem =~ /\b<value>\b/i`.

Both resource types are handled by **one** data provider and **one** view provider, mirroring how
`WebAppDataProvider` owns all three `Microsoft.Web/sites` flavors.

| Node | contextValue (assembled) | Children |
|---|---|---|
| Container Apps environment | `openInPortal;deleteResource` | none (leaf) |
| Container app | `openInPortal;deleteResource;browseWebsite;restartContainerApp;revealContainerAppEnvironment;openContainerAppConsole;openContainerAppLogs;startContainerAppLogStream` | one node per container |
| Container | `containerAppContainer` | none (leaf) |

- [x] `ContainerAppsDataProvider.canHandle` -> `isContainerApp(r) || isManagedEnvironment(r)` plus this
      product's own virtual container nodes  <- ACA-062, ACA-063, ACA-126
- [x] `ContainerAppsDataProvider.enrich` for the app: `containerApps.get` -> `setWebsiteUrl(fqdn)`, and
      attach `environmentId` (the current property -- **not** the deprecated `managedEnvironmentId`),
      `provisioningState`, `latestRevisionName`, and `template.containers`  <- ACA-063, ACA-014
- [x] `ContainerAppsDataProvider.getChildren`: containers as `VirtualResource` nodes hanging directly off
      the app, with no `Containers` grouping node, single or multiple  <- ACA-068, ACA-069
- [x] `ContainerAppsViewProvider.getTreeItem`: environment leaf; app collapsible with a non-`Succeeded`
      `provisioningState` description; container node whose `description` is the image tag and whose
      `tooltip` carries registry + full image reference  <- ACA-062, ACA-063, ACA-069, ACA-084, ACA-085
- [x] Register both providers in `registerContainerApps.ts` ahead of the generic providers  <- ACA-126
- [x] **Reuse** wiring, no new code: the generic `openInPortal` and `deleteResource` context values come
      from `resourceContextValue`; `browseWebsite` appears automatically once `setWebsiteUrl` runs
      <- ACA-004, ACA-011, ACA-013, ACA-060, ACA-125
- [x] **Reuse** `OpenUrl` with a portal-blade resolver registered as a prefix arg, for the app's console
      and logs blades -- no product-specific browse or portal command  <- ACA-015, ACA-094
- [x] **Reuse**, verify only: activity-log entries come from the existing ARM deployment provider and the
      output channel from `IOutputChannel`; nothing product-specific is added  <- ACA-136, ACA-137

## Slice 2 -- Commands on the tree

> **Mapping record.** Pattern: `@injectable()` `ManagedCommand` classes with a static `ContextValue`,
> resolved through `IResourceSelector` so each works from the tree *or* the palette.
> Target files: `src/commands/containerApps/*.ts`, plus
> `src/tree/resources/containerApps/ContainerAppLogStream.ts` for the transport.
> Precedent: `commands/acr/DisableAcrAdminUser.ts` (selector + `whenEnriched` + progress).
> Shared-primitive sweep: reused `IResourceSelector`, `withDelayedProgress`, `showMessage`,
> `showSmartQuickPick`, `stringifyError`, `CancellationError`, `toAbortSignal`, `EventEmitter`,
> `Disposable`. Searched `stream`, `logStream`, `OutputChannel`, `chunked`, `pipe` across
> `packages/utils/src` and `packages/azutils/src` -- no streaming primitive exists, so the transport is new;
> it stays product-local because nothing else in the monorepo streams a data plane today.
> Activation: none. Every command activates the extension when invoked.
> External facts: `ReplicaContainer.logStreamEndpoint` and `containerApps.getAuthToken` are the transport's
> two ARM inputs (verified against the installed `@azure/arm-appcontainers@4.0.0-beta.1` type definitions).
> The redirect is followed by hand rather than delegated: the fetch spec strips `Authorization` on a
> cross-origin redirect. The token is preserved across HTTPS redirects from Azure's log service,
> with at most five redirects followed.

- [x] `RestartContainerApp` -- `ContextValue = 'restartContainerApp'`; resolves the app, awaits enrichment
      for `latestRevisionName`, calls `containerAppsRevisions.restartRevision`, then invalidates the node.
      Contributed to `view/item/context` **and** `"group": "inline"`  <- ACA-041
- [x] `RevealContainerAppEnvironment` -- `ContextValue = 'revealContainerAppEnvironment'`; awaits
      enrichment for `environmentId`, derives the environment's node id, and reveals it in the resources
      view. Needs an **additive** public factory on `AzureNodeId` (its constructor is private and only
      `parse()`/`from()` are public) to derive a sibling resource node id without string surgery; add it in
      azutils, do not fork  <- ACA-014
- [x] `ContainerAppLogStream` service -- ARM `containerApps.getAuthToken` for a short-lived data-plane
      token, GET the per-container `logStreamEndpoint` with authenticated HTTPS redirects, and pipe the
      chunked response into a per-replica pseudoterminal backed by an `AbortController`  <- ACA-118
- [x] `StartStreamingLogs` -- `ContextValue = 'startContainerAppLogStream'`; picks revision -> replica ->
      container, then opens the stream. Absorbs the source's `logStreamItem` leaf and the `Logs` group node
      <- ACA-016, ACA-083, ACA-093
- [x] Closing a log terminal automatically aborts its stream, with no separate stop command  <- ACA-017
- [x] Contribute all three commands, their `%key%` titles, `commandPalette` visibility, and `\b`-anchored
      `when` clauses to `package.json` + `package.nls.json`  <- ACA-016, ACA-017, ACA-041, ACA-014

## Slice 3 -- Create / Deploy (azd + Bicep)   [Adapt]

> **Mapping record.** Pattern: one `ManagedCommand` registered twice by `AzdJob` prefix arg, assembling
> shared azd prompt/execute steps plus product-specific steps.
> Target files: `src/commands/containerApps/CreateContainerApp.ts`,
> `src/commands/containerApps/CreateContainerAppContext.ts`,
> `src/commands/containerApps/steps/*.ts`,
> `extensions/vscode-azure/resources/templates/containerApp/**`.
> Precedent: `commands/functions/CreateFunctionApp.ts` + `steps/PickRuntimeStep.ts`.
> Shared-primitive sweep: reused `SelectIacFolderStep`, `HydrateAzdInfoStep`,
> `HydratableChooseSubscriptionStep`, `HydratableChooseLocationStep`, `ProjectNameStep`,
> `ConfirmProvisionStep`, `GenerateAzureYamlStep`, `CreateAzdEnvStep`, `AzdProvisionStep`,
> `AzdDeployStep`, `ShowEndpointUrlStep`, `IGenerateBicepStepFactory`, `Wizard`, `PromptStep`,
> `ExecuteStep`, `showSmartQuickPick`, `showSmartInputBox`, `PickWorkspaceLocationStep`, and the
> workspace index (`WorkspaceIndexService`) for Dockerfile discovery -- the product never walks the
> workspace itself.
> Activation: none.
> External facts: azd opts into a remote ACR build with `services.<name>.docker.remoteBuild: true`
> (verified against [azd's `azure.yaml` schema](https://raw.githubusercontent.com/Azure/azure-dev/main/schemas/v1.0/azure.yaml.json)
> and the [azd schema docs](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/azd-schema));
> the bare service-level `remoteBuild` is a **different**, Functions-only feature. Every AVM module
> reference, version, and parameter name in the topology module is verified by `az bicep build`, which
> resolves each pinned `br/public:` module from the registry and type-checks the call. That compile caught
> one error in the research: `container-apps-stack:0.4.0` takes `logAnalyticsWorkspaceName`, not
> `logAnalyticsWorkspaceResourceId`.

**Status: complete.** The wizard provisions the full topology, uses quickstart for creation or lets azd build
one, ensures project deployments declare a local Docker Container Apps service in `azure.yaml`, and verifies
the app actually started.


- [x] File the tracking issue for a real AVM container-apps topology pattern module
      ([#329](https://github.com/microsoft/vscode-azure/issues/329)), and link it from the local module's
      header comment  <- ACA-002
- [x] Generalize `GenerateBicepStep` from copying **one** template file to copying a template **directory**
      with relative paths preserved, and move `functionApp.bicep` to `functionApp/main.bicep` in the same
      change so no previously migrated product stays the implicit default case  <- ACA-002
- [x] Author `templates/containerApp/modules/container-app-topology/main.bicep`: an AVM-shaped pattern
      module composing `avm/ptn/azd/monitoring`, `avm/ptn/azd/container-apps-stack`,
      `avm/res/managed-identity/user-assigned-identity`, and `avm/ptn/azd/container-app-upsert`, each at a
      pinned `br/public:...:<version>` reference; every parameter and output described and named for a
      future registry contract  <- ACA-002, ACA-003, ACA-101, ACA-114
- [x] Author `templates/containerApp/main.bicep`: thin consumer owning `targetScope = 'subscription'`, the
      resource group, and the azd placeholders  <- ACA-002
- [x] Validate the consumer with the repo's Bicep validation so the remote modules actually resolve, and
      confirm Post-clone / Bootstrapped still skip generation when `infra/main.bicep` exists  <- ACA-002
- [x] `CreateContainerAppContext` extending `AzdWizardContext` with the target port, localized resource
      display name, and persisted app-name expression for repeat provisioning
      <- ACA-002
- [x] **Reuse**, no code: registry creation is a line in the topology module, and everything else about
      registries belongs to the ACR product -- no container-apps-owned "create registry" command  <- ACA-048, ACA-112
- [x] Creation uses the upsert pattern's quickstart image on port 80 without an image prompt.
      Project deployment builds and pushes through azd. The pattern receives the registry's
      cloud-specific suffix and the persisted app name controls its `exists` flag  <- ACA-095, ACA-101
- [x] In-project Dockerfile `EXPOSE` parsing feeds the `targetPort` Bicep parameter for project deployment,
      defaulting to 80 when none is declared. Quickstart creation uses its known port, 80.
      Read the Dockerfile through the workspace index  <- ACA-104
- [x] Overwrite warning: satisfied by **reusing** the shared `ConfirmProvisionStep`, which already
      interrupts exactly the risky case -- re-provisioning over an existing azd environment. Its wording was
      sharpened to say that provisioning updates already-deployed resources. The source's *unsupported
      features* half does not carry over: it existed because the source round-tripped the app's ARM template
      through its own model and could silently drop what it did not understand. Here Bicep is the source of
      truth and the user can read it, so nothing is silently lost  <- ACA-110
- [x] `VerifyContainerAppStartStep` dispatches the hidden `VerifyContainerAppStart` managed command after
      application-image deployment, including deployment without provisioning. Quickstart-only creation
      skips verification. The launcher resolves the subscription and reads app/resource group names from azd
      outputs; these lookups use wizard error handling. The independent command owns a separate root activity,
      reads the app once to capture its latest revision, and polls that revision's provisioning
      and running states with `@azure/core-lro`. Its two-minute bound includes the initial app lookup.
      The shared deploy API provides no exact revision/image correlation. Failures offer two clickable leaves,
      **Open System Log Stream** and **Open App Log Stream**, through reusable activity command pass-through.
      App logs retain the captured revision when known; system logs are app-scoped and require no replica.
      App/revision lookup, missing revision, timeout, and startup failures remain
      visible without changing the wizard's result. Optional programmatic cancellation is supported; the
      activity tree has no Cancel action. See [startup verification](../../products/containerapps.md#startup-verification)
      for the correlation limitation and diagnostic behavior. <- ACA-105
- [x] Diagnostic access uses the shared `ContainerAppLogStreamService` with typed console/system targets,
      ARM `getAuthToken`, and the app's `eventStreamEndpoint` (`follow=true&output=json`). System and
      console terminals coexist, deduplicate independently, and use authenticated HTTPS redirects and
      cancellation. `StartStreamingLogs` accepts explicit activity targets without a cached resource;
      its tree/palette console flow is unchanged. This is the user-approved Adapt refinement recorded
      in `TRIAGE.md`; no automatic Log Analytics query is part of verification. <- ACA-115, ACA-118
- [x] Register `CreateContainerApp` twice -- `vscode-azure/containerApps/createNew` and
      `vscode-azure/containerApps/deploy` -- via `prefixArgs`, matching the Functions precedent. This is
      where `createContainerApp`, `createManagedEnvironment`, `deployWorkspaceProject` and
      `deployContainerApp` all land: the environment is provisioned as supporting infrastructure inside the
      topology module, so it has no standalone create command  <- ACA-002, ACA-003, ACA-005, ACA-008

## Slice 4 -- Manifest, docs, verification

- [x] Final `package.json` / `package.nls.json` pass: every command localized, every palette entry
      deliberate, every `when` clause `\b`-anchored and matching an **assembled** context value  <- --
- [x] No `contributes.configuration` entries are added -- all seven source settings are Drop or Reuse
      <- ACA-055 .. ACA-061
- [x] Product doc `docs/products/containerapps.md`; framework docs get at most a link  <- --
- [x] Unit tests for the behavior each slice adds (guards, enrichment, view rendering, the log-stream
      service's live-set bookkeeping, quickstart creation and project deployment). No manifest-completeness,
      DI-registration, or
      `contextValue`-literal tests  <- --
- [x] Parity pass: trace every `TRIAGE.md` ID to landed code, a confirmed absence, or a Deferred entry
      here; gaps documented in [PARITY-REPORT.md](PARITY-REPORT.md)  <- --

---

## Deferred (tracked, not built now)

Existing-image deployment is independent of quickstart creation and source-project deployment.
[#347](https://github.com/microsoft/vscode-azure/issues/347) tracks an azd image-backed service using
`image` with `docker.imagePassthrough: true`, explicit target selection, and registry-access prerequisites.
The existing-image branch of ACA-008 depends on this work; its source-project branch uses the current
azd deploy job. The AVM quickstart topology does not need an additional registry for this scenario.

| ID | Feature | Blocker |
|---|---|---|
| ACA-007 | `deployImageApi` compat shim | Serves ACA-127 only; moves with it |
| ACA-039 | `activateRevision` | Revision management beyond restart; revisit post-MVP if users ask |
| ACA-040 | `deactivateRevision` | Same |
| ACA-065 | `revisionsItem` node | Needed only if ACA-039/040 are built |
| ACA-067 | `revisionItem` node | Same |
| ACA-082 | `daprEnabledItem` | Dapr surface; out of scope pre-GA |
| ACA-089 | `daprDisabledItem` | Same |
| ACA-090 | `daprAppIdItem` | Same |
| ACA-091 | `daprAppPortItem` | Same |
| ACA-092 | `daprAppProtocol` | Same; fix the description/contextValue swap if ever built |
| ACA-096 | ACR image selection for existing-app deployment | [#347](https://github.com/microsoft/vscode-azure/issues/347) -- azd image-backed service workflow and registry-access contract |
| ACA-097 | Docker Hub image source | Non-ACR registry support; revisit on demand |
| ACA-098 | Free-text prebuilt-image reference | [#347](https://github.com/microsoft/vscode-azure/issues/347) -- same deployment workflow as ACA-096 |
| ACA-113 | ACR data-plane discovery support | [#347](https://github.com/microsoft/vscode-azure/issues/347) -- only as required by the image-selection UX; prefer shared facilities |
| ACA-117 | Docker Hub v2 REST client | Client for ACA-097; deferred with it |
| ACA-127 | Exported `deployImage` API | Live external contract with the Containers/Docker extension; needs an owner-level decision |

## Dropped (for the record)

Not built, by signed decision. Grouped by the rationale in `TRIAGE.md`; see that file for each row's
verbatim reasoning.

| Group | IDs |
|---|---|
| Revision drafts -> Bicep/IaC (JC1) | ACA-034, ACA-035, ACA-036, ACA-037, ACA-038, ACA-061, ACA-066, ACA-109, ACA-119, ACA-130 |
| Env vars + secrets -> Bicep / managed identity + Key Vault (JC2) | ACA-020, ACA-021, ACA-022, ACA-023, ACA-024, ACA-025, ACA-026, ACA-031, ACA-032, ACA-033, ACA-071, ACA-072, ACA-079, ACA-080 |
| Ingress + scaling -> Bicep (JC3) | ACA-027, ACA-028, ACA-029, ACA-030, ACA-042, ACA-043, ACA-044, ACA-073, ACA-074, ACA-075, ACA-077, ACA-078, ACA-086, ACA-087, ACA-088 |
| Remote ACR build -> azd `docker.remoteBuild` (JC4) | ACA-049, ACA-099, ACA-100, ACA-116 |
| GitHub connect/disconnect -> `azd pipeline config` (JC5) | ACA-045, ACA-046, ACA-047, ACA-081 |
| Webviews (JC6) | ACA-120, ACA-121 |
| Copilot deploy (JC7) | ACA-009, ACA-122 |
| Walkthrough | ACA-050, ACA-051, ACA-052, ACA-053, ACA-054, ACA-131 |
| Deployment config in VS Code settings -> `azure.yaml` | ACA-055, ACA-056, ACA-057, ACA-058, ACA-059, ACA-103, ACA-106, ACA-108 |
| Superseded by monorepo patterns | ACA-001, ACA-010, ACA-012, ACA-064, ACA-068, ACA-070, ACA-076, ACA-084, ACA-085, ACA-093 (as a node), ACA-102, ACA-107, ACA-124, ACA-128, ACA-129 |
| Dead / orphan in the source | ACA-006, ACA-018, ACA-019, ACA-123, ACA-132, ACA-133, ACA-138, ACA-139, ACA-140 |

> ACA-093 appears in both Slice 2 and this table on purpose: the *capability* is Adapted onto the container
> app node, the *node* is not built.

## Open questions

- _(none currently open)_

## Decisions taken after sign-off

Recorded here because they change what shipped, without changing any signed disposition.

- **Local Docker build, for now.** The source extension always built in ACR, so it never required a local
  container runtime; azd defaults to a local build. Emitting `services.<name>.docker.remoteBuild: true` would
  restore that property but means authoring a file azd owns, which this repo deliberately does not do.
  Accepted the local-build requirement and tracked restoring remote build in
  [#334](https://github.com/microsoft/vscode-azure/issues/334).
- **Reveal is grouping-unaware for loaded nodes** (`RevealContainerAppEnvironment`, ACA-014). Pre-existing
  across all four product view providers; tracked by
  [#331](https://github.com/microsoft/vscode-azure/issues/331) rather than fixed inside this migration.

## Drift log

- _(no rebases yet)_
