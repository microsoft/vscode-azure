# Azure Container Apps

Product documentation for the Container Apps features in `extensions/vscode-azure`.

See [the migration folder](../migrations/containerapps/) for how this product's scope was decided:
[INVENTORY.md](../migrations/containerapps/INVENTORY.md) catalogs the source extension,
[TRIAGE.md](../migrations/containerapps/TRIAGE.md) is the signed decision record, and
[MIGRATION-PLAN.md](../migrations/containerapps/MIGRATION-PLAN.md) tracks the implementation.

## Tree shape

Container apps and managed environments are **both first-class resources**, each rooted in its own
resource group:

```
Resource group (or resource-type group)
├── Container Apps Environment        leaf
└── Container App
    └── Container xN                  description: <repository>:<tag>
```

An app is deliberately *not* nested under its environment. Both are top-level ARM resources -- an app's
resource ID contains no trace of its environment, and there is no API to list an environment's apps. The
relationship is expressed as a command (Reveal Environment) rather than as containment.

A container renders the image it runs in its `description` and `tooltip`. The image is a property of the
container, not a node above or below it; browsing a registry's repositories and tags belongs to the ACR
product.

## Commands

| Command | Acts on | Notes |
|---|---|---|
| Create Empty Container App in Azure... | palette | azd + Bicep, `createNew` job |
| Deploy Project as Container App... | palette | azd + Bicep, `deploy` job |
| Restart Container App | app node | Restarts the latest revision |
| Reveal Environment | app node | Jumps to the hosting managed environment |
| Start Streaming Logs... | app node | Live log stream from one container of one replica |
| Open Console in Portal | app node | Portal `/console` blade |
| Open Logs in Portal | app node | Portal `/logs` blade |

Open in Portal, Browse Website, and Delete come from the shared resource-generic commands.

## Log streaming

The Container Apps log stream is **chunked HTTP, not a web socket**:

1. `containerApps.getAuthToken` exchanges the user's ARM credentials for a short-lived data-plane token.
2. That token is presented to the container's `logStreamEndpoint`, read from the replica.
3. The chunked response is written into a per-replica terminal. Closing the terminal cancels the stream.

Redirects are followed **manually**. The fetch specification strips `Authorization` across origins, and
following a redirect blindly would instead hand an Azure credential to whatever host the response names, so
the token is only re-attached while the target stays on `*.azurecontainerapps.io` over HTTPS.

The revision -> replica -> container picks are each skipped when they have a single candidate, so the common
single-revision app streams with no prompts.

## Provisioning

Creation and deployment are delegated to **azd + Bicep**. The generated project is:

```text
infra/
  main.bicep                                  consumer: subscription scope, resource group, azd params
  main.parameters.json                        azd placeholders + the wizard's answers
  modules/container-app-topology/main.bicep   the topology
```

The topology module provisions a Log Analytics workspace, a managed environment, a container registry, a
user-assigned identity for the app, the AcrPull role assignment, and the container app. Only the app carries
the `azd-service-name` tag, because only the app is an `azd deploy` target.

**Registry authentication is managed identity only.** No admin user, no registry password, and no secret of
any kind is written to the template, to ARM, or to disk.

The topology module is a local stand-in that *composes* published Azure Verified Modules
(`avm/ptn/azd/monitoring`, `avm/ptn/azd/container-apps-stack`,
`avm/res/managed-identity/user-assigned-identity`, `avm/ptn/azd/container-app-upsert`), each pinned to a
version. It exists because no published AVM pattern module covers the whole topology; publishing one is
tracked by [#329](https://github.com/microsoft/vscode-azure/issues/329). When that lands, the module
collapses to a single `br/public:` reference and the consumer does not change.

The ingress target port is detected from the project's Dockerfile `EXPOSE` instruction and emitted as a
Bicep parameter rather than prompted for -- the value is already declared there, and the generated Bicep
stays editable.

The image is chosen through a single combo box that suggests every tag in the user's own container
registries and accepts anything else typed in -- a Docker Hub image, a third-party registry, a tag that does
not exist yet. That replaces the source extension's registry-kind -> registry -> repository -> tag chain and
removes the need for a separate "other registry" surface. It is only asked on `createNew`; the `deploy` job
has azd build and push the image instead.

**Deploying requires a local container runtime.** azd builds the image locally with Docker or Podman, so one
must be installed and running. Building in ACR instead would remove that requirement; it is tracked by
[#334](https://github.com/microsoft/vscode-azure/issues/334).

After provisioning, the app's latest revision is polled until it settles. Provisioning succeeding only means
ARM accepted the template -- the container can still fail to start on a bad image reference or a crash on
boot. When it does, the app's own console logs are read from the environment's Log Analytics workspace and
written to the output channel, which is where the explanation actually lives.

## What this product deliberately does not do

Per the signed triage, the following are expressed in Bicep rather than as commands or tree nodes:
environment variables, secrets, ingress, scaling, and revision mode. Secrets are avoided entirely in favor
of managed identity and Key Vault references. Revision drafts, the confirmation webviews, and the GitHub
connect/disconnect flow are not migrated; `azd pipeline config` owns CI/CD.

Deferred, tracked separately: the exported `deployImage` contract with the Containers extension
([#332](https://github.com/microsoft/vscode-azure/issues/332)), the Dapr surface
([#333](https://github.com/microsoft/vscode-azure/issues/333)), revision activate/deactivate, and Docker Hub
browsing. See [PARITY-REPORT.md](../migrations/containerapps/PARITY-REPORT.md) for the full accounting.
