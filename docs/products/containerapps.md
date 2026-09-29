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
| Create Empty Container App in Azure... | palette | azd + Bicep, `createNew` job; quickstart image on port 80 |
| Deploy Project as Container App... | palette | azd + Bicep, `deploy` job |
| Restart Container App | app node | Restarts the latest revision |
| Reveal Environment | app node | Jumps to the hosting managed environment |
| Open Log Stream... | app node | Live log stream from one container of one replica |
| Open Console in Portal | app node | Portal `/console` blade |
| Open Logs in Portal | app node | Portal `/logs` blade |

Open in Portal, Browse Website, and Delete come from the shared resource-generic commands.

## Log streaming

Container Apps console and system log streams use **chunked HTTP, not web sockets**:

1. `containerApps.getAuthToken` exchanges the user's ARM credentials for a short-lived data-plane token.
2. Console logs use the container's `logStreamEndpoint`, captured during replica/container selection
   and passed to the streaming service. System logs use the
   app's ARM-returned `eventStreamEndpoint` with `follow=true&output=json`, without revision or replica filters.
3. Output is buffered until VS Code opens the terminal, then streamed as it arrives.
   System terminals are labeled `system, JSON` and show
   JSON lines. Closing a terminal cancels that stream.

Redirects from Azure's log service are followed **manually** to preserve `Authorization` across origins,
which automatic fetch redirects would strip. Destinations must use HTTPS, and at most five redirects
are followed.

Concurrent starts for the same target share initialization and one terminal. System and console streams
have separate identities and can run together. Disposing the service cancels pending ARM requests and
connection attempts as well as established streams. Neither stream requires Azure CLI or Log Analytics
query permission; ARM app/replica reads and the app's log-stream token action must be authorized.

The revision -> replica -> container picks are each skipped when they have a single candidate, so the common
single-revision app streams with no prompts.

Transport references: [Container Apps log streaming](https://learn.microsoft.com/en-us/azure/container-apps/log-streaming),
[Azure CLI transport](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/containerapp/custom.py)
(`stream_containerapp_logs`), and the
[ARM response recording](https://github.com/Azure/azure-cli/blob/dev/src/azure-cli/azure/cli/command_modules/containerapp/tests/latest/recordings/test_container_acr.yaml)
showing the app's `https://eastus.azurecontainerapps.dev/.../eventstream` endpoint.

## Provisioning

Creation and deployment are delegated to **azd + Bicep**. The generated project is:

```text
infra/
  main.bicep                                  consumer: subscription scope, resource group, azd params
  main.parameters.json                        azd placeholders + the wizard's answers
  modules/container-app-topology/main.bicep   the topology
```

For project deployment, the command also ensures `azure.yaml` declares the selected service as a local Docker
project hosted by Container Apps. Existing service declarations are preserved.

The topology module provisions a Log Analytics workspace, Application Insights and its dashboard, a managed environment, a container registry, a
user-assigned identity for the app, the AcrPull role assignment, and the container app. Only the app carries
the `azd-service-name` tag, because only the app is an `azd deploy` target. Public network access is enabled
for external ingress. Registry login servers come from ARM, including the active sovereign cloud's suffix.
Zone redundancy is disabled because this topology does not provision an infrastructure subnet.
The app uses a minimum of one replica and inherits the AVM module's maximum of ten replicas.

**Registry authentication is managed identity only.** The registry admin account is disabled and no
registry password is generated or stored by the topology.

The `createNew` job provisions the quickstart sample image with external ingress on port 80. Its IaC lives
in a temporary directory; it does not build local source or run `azd deploy`. The `deploy` job provisions
the topology and then has azd build the local project, push its image to the generated ACR, and deploy it.
Both jobs configure the app identity with AcrPull on that generated registry.

The parameters file references `${AZURE_CONTAINER_APP_NAME}`, the name persisted by azd after provision.
On first provision, the unset value uses Bicep's empty default and creates the app. On subsequent
provisions, the upsert pattern reads the existing app's current image, preserving the image installed by
`azd deploy` rather than substituting the initial image.

The topology module is a local stand-in that *composes* published Azure Verified Modules
(`avm/ptn/azd/monitoring`, `avm/ptn/azd/container-apps-stack`,
`avm/res/managed-identity/user-assigned-identity`, and `avm/ptn/azd/container-app-upsert:0.4.0`),
each pinned to a version. The upsert pattern owns the app, registry authentication, and AcrPull assignment.
No published AVM pattern module covers the whole topology; publishing one is
tracked by [#329](https://github.com/microsoft/vscode-azure/issues/329). When that lands, the module
collapses to a single `br/public:` reference and the consumer does not change.

For project deployment, ingress port detection checks `Dockerfile` in the single existing service's
project directory reported by `azd show`, then each parent up to the azd project root. A project-file path
such as a `.csproj` uses its containing directory. A newly configured service uses the workspace root.
Only the nearest Dockerfile is inspected; descendants and sibling services are not searched.
Its first usable TCP `EXPOSE` supplies `targetPort` in `infra/main.parameters.json`.

Detection is best-effort: multiple services, an unavailable or out-of-root service path, or no usable
port in the nearest Dockerfile result in port 80 without a prompt. Custom Dockerfile paths/names and
build-stage selection are not interpreted. Users can correct the generated parameter; existing
infrastructure is left untouched. Quickstart creation always uses port 80.
Neither job asks for an image reference.

### Application telemetry

The primary container receives `APPLICATIONINSIGHTS_CONNECTION_STRING` from the provisioned Application
Insights resource. On reprovisioning, the topology preserves the primary container's other environment
variables (including `secretRef` entries) and replaces any entry with that exact name with the provisioned
connection string. The upsert module continues to preserve the deployed image. An application-only
`azd deploy` retains the provisioned environment; explicit service environment settings can override it.

The application must install and initialize an Application Insights SDK or Azure Monitor OpenTelemetry
integration that reads this environment variable, or pass its value to the SDK explicitly. For example,
an ASP.NET Core app using the `Azure.Monitor.OpenTelemetry.AspNetCore` package can register
`builder.Services.AddOpenTelemetry().UseAzureMonitor()` (with the `Azure.Monitor.OpenTelemetry.AspNetCore`
namespace imported). See [Azure Monitor OpenTelemetry setup](https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-enable)
for language-specific setup and supported versions.

An environment variable does not instrument an arbitrary Docker image. The quickstart image does
not gain request, dependency, or trace telemetry from this configuration.
Container Apps console/system logging to Log Analytics remains configured independently of the
application SDK and Application Insights.

The pinned monitoring module leaves Application Insights local authentication enabled. This topology
does not configure managed-identity-authenticated telemetry or disable local authentication; connection-
string-only ingestion requires local authentication to be permitted by the resource and applicable
Azure policy. The app's managed identity is used for registry access, not automatically by a telemetry SDK.

Existing generated projects must incorporate this template configuration and reprovision to add the
connection string; deploying an image alone does not add it. User-owned infrastructure is never rewritten
by the generation step.

**Deploying requires a local container runtime.** azd builds the image locally with Docker or Podman, so one
must be installed and running. Building in ACR instead would remove that requirement; it is tracked by
[#334](https://github.com/microsoft/vscode-azure/issues/334).

### Startup verification

After a successful application-image deployment, a thin wizard step dispatches the hidden
`vscode-azure/containerApps/verifyStart` managed command without awaiting completion. Quickstart-only
creation does not launch verification; deploying into an existing environment does, even when provisioning
is skipped. Verification has its own command execution scope and root activity, independent of the
completed `azd deploy` activity and the wizard's lifetime.

The launcher resolves the subscription and reads the app and resource group names from the
`AZURE_CONTAINER_APP_NAME` and `AZURE_RESOURCE_GROUP` azd outputs using the wizard's error handling.
It passes only the resolved subscription and those names to the command, not the wizard context.
The command reads the app from ARM once to capture its latest revision, then uses
`@azure/core-lro` to poll that same revision's provisioning and running states. The two-minute startup
bound includes the initial app lookup. `Provisioned` plus `Running` or `ScaledToZero` is healthy.
Failed states, app or revision lookup errors, missing revisions, and timeouts produce a failed verification
activity without changing the deployment's result. The wizard does not wait for ARM lookup or startup
polling; the independent command does not read azd outputs or resolve the subscription again.

The shared azd deployment API does not return the deployed revision or image digest. Verification therefore
checks the latest revision observed after deployment, **not an image-correlated deployment result**.
A concurrent deployment before that first ARM read can affect which revision is selected; subsequent
deployments do not change the revision being polled.

On startup failure, the activity offers two clickable leaf entries:

- **Open System Log Stream** opens app-scoped system events, including when no replica is running.
- **Open App Log Stream** opens console logs for the captured revision, with replica/container picks as
  needed. If that revision has no replicas, the command explains this rather than selecting another
  revision. If verification could not capture a revision (including an app lookup failure), the shortcut
  still targets the app and selects an active revision when clicked.

Log access occurs only when the user selects a shortcut. Verification does not query Log Analytics or
attach customer log text to the activity. The app tree/palette **Open Log Stream...** command uses the
usual console revision/replica/container selection flow.

Programmatic callers may supply a cancellation token to stop verification and mark its activity canceled.
The launcher does not pass a wizard-owned token, and the activity tree has no Cancel action.

## What this product deliberately does not do

Per the signed triage, the following are expressed in Bicep rather than as commands or tree nodes:
environment variables, secrets, ingress, scaling, and revision mode. Secrets are avoided entirely in favor
of managed identity and Key Vault references. Revision drafts, the confirmation webviews, and the GitHub
connect/disconnect flow are not migrated; `azd pipeline config` owns CI/CD.

Deferred, tracked separately: deploying a prebuilt image to an existing app through an azd image-backed
service ([#347](https://github.com/microsoft/vscode-azure/issues/347)), the exported `deployImage` contract with the Containers extension
([#332](https://github.com/microsoft/vscode-azure/issues/332)), the Dapr surface
([#333](https://github.com/microsoft/vscode-azure/issues/333)), revision activate/deactivate, and Docker Hub
browsing. See [PARITY-REPORT.md](../migrations/containerapps/PARITY-REPORT.md) for the full accounting.
