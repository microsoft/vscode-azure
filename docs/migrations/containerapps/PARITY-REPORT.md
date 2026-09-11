# Azure Container Apps -- Parity Report

Phase 6 verification of the Container Apps migration against the signed [TRIAGE.md](TRIAGE.md).

| | |
|---|---|
| **Source** | `microsoft/vscode-azurecontainerapps` @ `f6c93dcd1a55b6aaf27ed4edca8f6a52b5348e16` (v0.11.2) |
| **Triage rows** | 140 |
| **Resolved** | 140 (0 unaccounted for) |
| **Date** | 2026-09-11 |

Evidence paths are relative to `extensions/vscode-azure/src/` unless another package is named.

## Summary

| Disposition | Rows | Outcome |
|---|---|---|
| Migrate | 7 | all landed |
| Adapt | 18 | all landed |
| Reuse | 11 | all wired (verified against source, not assumed) |
| Defer | 13 | all tracked in [MIGRATION-PLAN.md](MIGRATION-PLAN.md#deferred-tracked-not-built-now) |
| Drop | 91 | all confirmed absent from the codebase |
| **Total** | **140** | |

## Artifact check

| Check | Result |
|---|---|
| `INVENTORY.md` tracked | yes |
| `TRIAGE.md` tracked, signed | yes -- Brandon Waterloo (@bwateratmsft), 2026-09-11 |
| `MIGRATION-PLAN.md` tracked, every task tagged with an ID | yes |
| Artifacts landed before any feature code | yes -- `431c4453` is the branch's first commit |
| No artifact exists only in scratch | yes |

## Kept features (Migrate / Adapt / Reuse)

| ID | Feature | Disposition | Outcome | Evidence |
|---|---|---|---|---|
| ACA-002 | `createContainerApp` | Adapt | landed | `commands/containerApps/CreateContainerApp.ts` + `resources/templates/containerApp/**` |
| ACA-003 | `createManagedEnvironment` | Adapt | landed | topology module provisions the environment as supporting infra; no standalone command, as the triage anticipated |
| ACA-004 | `deleteManagedEnvironment` | Reuse | wired | `resourceContextValue()` adds `DeleteAzureResource.ResourceContextValue` |
| ACA-005 | `deployWorkspaceProject` | Adapt | landed | `CreateContainerApp.ts` (`deploy` job) |
| ACA-008 | `deployContainerApp` | Adapt | landed | `CreateContainerApp.ts` (`deploy` job) |
| ACA-011 | `deleteContainerApp` | Reuse | wired | `resourceContextValue()` |
| ACA-013 | `browse` | Reuse | wired | `BrowseWebsite.ContextValue`, once `enrich` calls `setWebsiteUrl(fqdn)` |
| ACA-014 | `revealInEnvironment` | Adapt | landed | `commands/containerApps/RevealContainerAppEnvironment.ts` + `AzureNodeId.forRelatedResource` |
| ACA-015 | `openConsoleInPortal` | Reuse | wired | `OpenUrl` + `OpenInPortal.bladeUrl('/console')` |
| ACA-016 | `startStreamingLogs` | Migrate | landed | `commands/containerApps/StartStreamingLogs.ts` |
| ACA-017 | `stopStreamingLogs` | Migrate | landed | Closing the per-stream terminal automatically stops the stream. |
| ACA-041 | `restartRevision` | Migrate | landed | `commands/containerApps/RestartContainerApp.ts` |
| ACA-048 | `createAcr` | Reuse | wired | registry is a line in the topology module; no container-apps create-registry command |
| ACA-060 | `deleteConfirmation` setting | Reuse | wired | `DeleteAzureResource` owns the modal confirmation; no setting contributed |
| ACA-062 | `managedEnvironmentItem` | Adapt | landed | `tree/resources/containerApps/ManagedEnvironment.ts`; renders as a leaf |
| ACA-063 | `containerAppItem` | Adapt | landed | `ContainerApp.ts` + `ContainerAppsDataProvider` / `ContainerAppsViewProvider`; rooted in its resource group |
| ACA-069 | `containerItem` | Adapt | landed | `ContainerAppsDataProvider.getChildren`; image in `description` / `tooltip` |
| ACA-083 | `logsGroupItem` | Adapt | landed | capability moved onto the app node; no group node |
| ACA-093 | `logStreamItem` | Adapt | landed | `StartStreamingLogs.ContextValue`, inline + context menu |
| ACA-094 | `logsItem` | Reuse | wired | `OpenUrl` + `OpenInPortal.bladeUrl('/logs')` |
| ACA-095 | Quickstart image source | Adapt | landed | `CreateContainerApp.ts` provisions the upsert pattern's quickstart image automatically; `DetectTargetPortStep` uses port 80 |
| ACA-101 | Registry creds -- managed identity | Adapt | landed | topology module: `identityType: 'UserAssigned'` + AcrPull |
| ACA-104 | Ingress from Dockerfile `EXPOSE` | Adapt | landed | `steps/DetectTargetPortStep.ts` -> `targetPort` Bicep param; project-scoped detection with a port 80 default |
| ACA-105 | Start verification + log fetch | Migrate | landed | `steps/VerifyContainerAppStartStep.ts` |
| ACA-110 | Overwrite confirm | Adapt | landed (reuse) | `azd/wizard/ConfirmProvisionStep.ts`, wording sharpened |
| ACA-111 | Container Apps client | Migrate | landed | `packages/azutils/src/rest/clients/ContainerAppsClient.ts` |
| ACA-112 | ACR management client | Reuse | wired | existing `AcrClient`; no `arm-containerregistry` import in this product |
| ACA-114 | Authorization client | Adapt | landed | role assignment expressed in Bicep, not an ARM call |
| ACA-115 | Logs query client | Migrate | landed | `packages/azutils/src/rest/clients/LogsQueryClient.ts` |
| ACA-118 | Log-stream transport | Migrate | landed | `tree/resources/containerApps/ContainerAppLogStream.ts` |
| ACA-125 | Portal URL builder | Reuse | wired | `OpenInPortal` over `AzureNodeId.toPortalUrl` (sovereign-aware) |
| ACA-126 | Branch data provider | Adapt | landed | `products/registerContainerApps.ts` |
| ACA-134 | Resource-provider registration | Adapt | landed | ARM registers RPs as a side effect of the deployment; no `VerifyProvidersStep` |
| ACA-135 | Product icons | Adapt | reused | both `azureIcons/microsoft.app/*.svg` already shipped; none added |
| ACA-136 | Activity-log integration | Reuse | wired | no product-specific activity registration |
| ACA-137 | Output channel | Reuse | wired | no product-specific channel registration |

## Dropped features -- confirmed absent

ACA-096 (existing ACR image selection), ACA-098 (free-text image selection), and ACA-113 (the dedicated
ACR data-plane client) are out of scope by signed decision. Creation uses quickstart; project deployment
builds and pushes through azd. Registry browsing remains owned by the ACR product.

Each judgment-call group was grepped across all 205 tracked source, manifest, and template files.

| Group | Patterns searched | Result |
|---|---|---|
| Revision drafts (JC1) | `revisionDraft`, `RevisionDraft` | clean |
| Secrets (JC2) | `addSecret`, `SecretValueStep`, `secretsItem` | clean |
| Env vars (JC2) | `addEnvironmentVariable`, `environmentVariablesItem`, `EnvFileListStep` | clean |
| Ingress + scaling (JC3) | `enableIngress`, `disableIngress`, `toggleVisibility`, `editTargetPort`, `scaleRule`, `minMaxReplica` | clean |
| Remote ACR build (JC4) | `UploadSourceCode`, `TarFileStep`, `BuildImageStep`, `BuildSourceUploadUrl` | clean |
| GitHub (JC5) | `connectToGitHub`, `disconnectRepo`, `sourcecontrols`, `github-auxiliary` | clean |
| Webviews (JC6) | `confirmationView`, `loadingView`, `WebviewRegistry` | clean |
| Copilot (JC7) | `deployWithCopilot`, `CopilotUserInput` | clean |
| Walkthrough | `walkthrough` | clean |
| V1/V2 settings | `deploymentConfigurations`, `convertV1ToV2` | clean |
| Calls into the retired extension | `azureResourceGroups.`, `vscode-azurecontainerapps` | clean |
| Draft JSON schema | `containerapp-template` | clean |

## Tree contract

All seven Container Apps `view/item/context` entries use a `\b`-anchored regex, and every one names a
context value that is declared in source and assembled onto the node by `ContainerAppsViewProvider`:

`openContainerAppConsole`, `openContainerAppLogs`, `revealContainerAppEnvironment`, `restartContainerApp`,
`startContainerAppLogStream` -- plus the generic `openInPortal`,
`deleteResource`, and `browseWebsite` contributed by `resourceContextValue()`.

`revealContainerAppEnvironment` is conditional by design and appears only once `environmentId` is known.

`ContainerAppsDataProvider` / `ContainerAppsViewProvider` are registered before the generic providers in
`registerProducts.ts`.

## Ownership, activation, and settings

| Check | Result |
|---|---|
| New `activationEvents` entries | none |
| New `contributes.configuration` settings | none (all 7 source settings were Drop or Reuse) |
| `azure.yaml` authored or parsed outside shared azd services | no |
| Calls into the extension being retired | none |
| `@azure/*` imports in extension source | one, pre-existing (`@azure/core-lro` in `tree/activity/ArmDeploymentDataProvider.ts`); none added by this migration |

## Build gates

| Gate | Result |
|---|---|
| `pnpm --filter @microsoft/vscode-azure-azutils --filter vscode-azure run lint` | clean |
| `pnpm --filter @microsoft/vscode-azure-azutils --filter vscode-azure run build` | succeeds |
| `pnpm --filter @microsoft/vscode-azure-azutils --filter vscode-azure run test` | 1,135 extension and 375 azutils passing; 0 failing (4 extension tests pending) |
| `bicep build` on the consumer template | compiles; all pinned AVM modules resolve |

Validation covers the affected azutils and extension workspaces. The utils workspace is unchanged.

## Known gaps

Honest remainder. None is a silent omission -- each is tracked.

1. **No live-Azure verification.** The log-stream transport (ACA-118) and start verification (ACA-105) are
   covered by unit tests over stubbed I/O but have never run against a real container app. The redirect
   behavior of the real log-stream endpoint is the most likely thing to need adjustment.
2. **`getParent` is grouping-unaware for loaded nodes.** Affects reveal (ACA-014) under `resourceType` /
   `location` / `armTag` grouping. **Pre-existing and not specific to this product** -- `AcrViewProvider`,
   `WebAppViewProvider` and `SettingsViewProvider` have the identical naive implementation. Tracked by
   [#331](https://github.com/microsoft/vscode-azure/issues/331).
3. **Deploying requires a local container runtime.** The source extension always built in ACR, so it did
   not. Accepted for now; restoring remote build is tracked by
   [#334](https://github.com/microsoft/vscode-azure/issues/334).
4. **13 Defer rows are not built**, by signed decision:

   | Theme | IDs | Status |
   |---|---|---|
   | Exported `deployImage` contract | ACA-007, ACA-127 | [#332](https://github.com/microsoft/vscode-azure/issues/332) -- live contract with the Containers extension; needs an owner decision |
   | Dapr surface | ACA-082, ACA-089-092 | [#333](https://github.com/microsoft/vscode-azure/issues/333) |
   | Revision activate/deactivate + nodes | ACA-039, ACA-040, ACA-065, ACA-067 | on demand -- no successful uses in the telemetry window |
   | Docker Hub browsing | ACA-097, ACA-117 | on demand -- a typed Docker Hub reference already works |
