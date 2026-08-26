# Static Web Apps

How the Static Web Apps product is built on the shared monorepo frameworks.
For the frameworks themselves see [Resource Creation](../resource-creation.md),
[Settings](../settings.md), and [Tree Views](../tree-views.md).

## Creation

`CreateStaticWebApp` registers `vscode-azure/staticWebApps/createNew` (basic)
and `vscode-azure/staticWebApps/createAdvanced` (advanced). An open workspace
selects the `deploy` job; without one, creation uses temporary IaC and
provisions only. Basic mode defaults to the Free SKU. Advanced mode adds the
Free/Standard SKU prompt.
The shared location step is constrained to Central US, East US 2, East Asia,
West Europe, and West US 2 for this resource type.

After the shared folder, hydration, subscription, location, and project-name
steps, the wizard selects a grouped build preset and prompts for application,
Functions API, and output locations. Detection reads workspace files through
`vscode.workspace.fs`, preselects retained frameworks, resolves Angular
`dist/<project-name>`, and prefers Functions APIs in root, one-level, then
deeper order. The three location prompts honor:

- `vscode-azure.staticWebApps.appSubpath`
- `vscode-azure.staticWebApps.apiSubpath`
- `vscode-azure.staticWebApps.outputSubpath`

Execution generates `staticWebApp.bicep` plus its resource-group module,
initializes `azure.yaml`, adds a `host: staticwebapp` service when the selected
artifact shape is supported, creates the azd environment, provisions, and
deploys when applicable. The Bicep resource uses
`Microsoft.Web/staticSites@2023-12-01`, emits its HTTPS endpoint, and tags the
site with `azd-env-name` and `azd-service-name`.

Existing GitHub remote and branch metadata is retained only when the remote is
on github.com. No token is written, workflow generation is disabled, and the
wizard never creates a repository or pushes code. Repository bootstrap is
intentionally deferred until it can be an explicit, independently confirmed
flow.

Current azd Static Web Apps deployment requires an artifact directory distinct
from the source directory. Empty, `/`, and `.` output locations therefore
provision the resource but skip service generation and `azd deploy`; the
resource remains available in the refreshed Azure tree. A selected Functions
path is retained as Bicep build metadata, but direct azd deployment does not
create a managed Functions workflow. Direct azd deployments also do not poll
GitHub Actions; the existing 15-second/20-minute poller is reserved for actual
linked workflow runs.

## Local Tooling

Static Web Apps owns its local CLI, task, and debug integration through
product-specific DI bindings:

- `ISwaCliService` wraps `IProcessExecutor`, `IOutputChannel`, and `IVsCode`.
- Task and debug providers are singleton bindings so commands and VS Code
  registrations share state.
- `SwaTaskLifecycle` is activated through `pushDisposable`; its event
  subscriptions are disposed with the extension.
- `registerStaticWebApps()` declares activations on the `ProductRegistrar` that
  push every VS Code task and debug registration into
  `IExtensionContext.subscriptions`.

Raw process signaling is isolated behind `IProcessTerminator`; tests replace
that service and never signal a real process.

## Settings

Static Web Apps keeps no application settings on the site itself, so the site
node has no settings document. Each *environment* -- production plus one per
open pull request -- owns its own dictionary, and they come from different ARM
endpoints: production reads and writes at the site level, while every other
environment is keyed by its build id.

`StaticWebAppDataProvider` therefore passes the environment's virtual node to
`getSettingsNodes` rather than the ARM resource, which keys the settings node
beneath the environment at `environments/<buildId>/settings`, and passes a
document name so sibling environments open as distinguishable editor tabs.
`StaticWebAppSettingsAdapter` reads the environment back off the owner it is
handed and picks the matching endpoint. See [Settings](../settings.md) for the
framework's ownership model.

## CI/CD Routing

After creation, `CreateStaticWebApp` routes deployment based only on the
project's *existing* Git remote -- it never assists with initializing,
adding, or pushing one. The decision is made silently by
`DetermineStaticWebAppDeploymentRouteStep`, the last prompt step in the
wizard, once `iacFolder` and `outputLocation` are already known:

| Condition | Outcome |
|---|---|
| Supported (GitHub or Azure DevOps), pushed remote, and `azd` version `>=` the pipeline gate (any artifact shape) | `deploy: false` + `deploymentRoute` set. `AzdDeployStep` is skipped by the merge (no changes to that shared step); after the wizard finishes successfully, `CreateStaticWebApp` launches the standalone `DeployStaticWebApp` command (`vscode-azure/staticWebApps/deploy`) as a **separate command/event**, passing the already-known project/provider/branch. Its own interactivity (`azd pipeline config` runs as a foreground task), failure, or cancellation never alters the already-successful create result. |
| CI/CD not currently possible (no/unsupported remote, unpushed branch, or `azd` below the gate), but the artifact can be deployed directly (static/export-capable output) | Context untouched -- `AzdDeployStep` runs the existing, unmodified `azd deploy` exactly as it does today. |
| CI/CD not currently possible **and** the artifact cannot be deployed directly (Next.js hybrid/SSR, or any other shape `OutputLocationStep` already flags as unsupported) | `deploy: false` is forced explicitly (defensive -- not reliant on `OutputLocationStep`'s own gating), and `deploymentBlockedReason` (`noRemote` / `unsupportedRemote` / `notPushed` / `azdVersionTooLow`) is set. `CreateStaticWebApp` shows a single, reason-specific toast that never claims a deployment occurred, with a "Deploy Static Web App" action. |

`DeployStaticWebApp` is a standalone, repeatable command (not tied to
creation): invoked with known context it skips rediscovery entirely; invoked
from the command palette it resolves the target project itself (enumerating
open workspace folders for a `host: staticwebapp` service, prompting with a
`QuickPick` when more than one matches). Its routing:

- No / unsupported remote -> direct deploy, i.e. the existing, unmodified
  `IAzdService.deploy()`. For a `host: staticwebapp` service this uploads the
  configured `dist` artifact through azd's own Static Web Apps CLI
  integration -- the extension does not invoke `swa build` itself and makes
  no claim that a separate build step runs.
- Supported remote not yet pushed, or `azd` below the pipeline version gate
  -> explains the prerequisite and offers a "Deploy Directly Instead"
  fallback action. Never mutates Git state.
- Supported, pushed remote and a sufficient `azd` version -> checks whether
  the *other* provider's canonical workflow file already exists (GitHub:
  `.github/workflows/azure-dev.{yml,yaml}`; Azure DevOps:
  `.azdo/pipelines/azure-dev.{yml,yaml}` and
  `.azuredevops/pipelines/azure-dev.{yml,yaml}`) and requires explicit
  confirmation before continuing if so, so two pipelines are never silently
  enabled. It never deletes or overwrites a workflow file -- `azd pipeline
  config` (gated on `azd >= 1.30.0`, run as an interactive foreground task,
  never `--no-prompt`) owns that.
- Next.js hybrid/SSR with no eligible CI/CD path -> stops with guidance
  instead of calling `azd deploy` (which cannot deploy server-rendered
  content), so a failed/skipped deployment is never reported as successful.

`azd pipeline config`-based CI/CD is production-only -- it does not create
GitHub PR preview environments the way the native Static Web Apps GitHub
Actions workflow does. This is a known, disclosed limitation, not something
this feature works around.

**Known gap:** Existing GitHub Actions tree support recognizes only the legacy
native `Azure/static-web-apps-deploy` workflow shape. It does not yet recognize
azd-generated pipeline workflow files such as
`.github/workflows/azure-dev.yml` or `.github/workflows/azure-dev.yaml`
(GitHub Actions) and their Azure Pipelines equivalents. A project deployed
through this feature's CI/CD path therefore will not show its workflow runs in
those tree nodes. Extending the parser for the generic workflow shape is tracked
as a follow-up, not implemented as part of this feature.
