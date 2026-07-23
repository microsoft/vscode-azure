# Resource Creation

Resource creation wizards live in `extensions/vscode-azure/src/azd/wizard/` and use the [Wizard Framework](wizard.md) to walk the user through generating Azure infrastructure-as-code (IaC) files and optionally provisioning resources via the Azure Developer CLI (`azd`).

## Jobs-to-be-done

Each creation command receives an `AzdJob` that determines how the wizard behaves:

| Job | `iacFolder` target | Workspace modified? | Use case |
|-----|--------------------|--------------------|----------|
| `createNew` | Temp directory via `TempDirManager` | No | Spin up a standalone Azure resource without committing IaC to the workspace |
| `deploy` | User's workspace folder | Yes | Generate IaC into the workspace so `azd deploy` / `azd provision` work long-term |

## Wizard Context

All azd creation wizards share `AzdWizardContext`. Resource-specific commands extend it (e.g. `CreateFunctionAppContext` adds `runtime`, `runtimeVersion`, `hostingPlan`).

### Core fields

| Field | Set by | Purpose |
|-------|--------|---------|
| `job` | Command entry point | `'createNew'` or `'deploy'` |
| `iacFolder` | `SelectIacFolderStep` | Folder holding (or receiving) `azure.yaml` + `infra/` |
| `subscription` | `HydratableChooseSubscriptionStep` | Selected Azure subscription |
| `location` | `HydratableChooseLocationStep` | Selected Azure region |
| `environmentName` | `ProjectNameStep` or `HydrateAzdInfoStep` | Name for the azd environment |
| `azdServiceName` | `HydrateAzdInfoStep` (from `azd show`) or `ProjectNameStep` | Written as `azd-service-name` tag on the resource |
| `provision` | Seeded `true`; may be overridden by `ConfirmProvisionStep` | Whether to run `azd provision` |

### Hydration flags (deploy job only)

Set by `HydrateAzdInfoStep` to let downstream steps skip work that's already done:

| Flag | Meaning |
|------|---------|
| `hasAzureYaml` | `azure.yaml` exists in `iacFolder` |
| `hasInfra` | `infra/main.bicep` exists |
| `hasServices` | `azure.yaml` declares at least one `services:` entry |
| `existingDefaultEnvName` | Name of a fully-configured default azd environment |
| `hydratedSubscriptionId` | `AZURE_SUBSCRIPTION_ID` from the default env |
| `hydratedLocationName` | `AZURE_LOCATION` from the default env |

## Wizard Step Sequence

Using `CreateFunctionApp` as the concrete example:

### Prompt steps (in order)

| # | Step | Prompts user? | Sets on context |
|---|------|--------------|-----------------|
| 1 | `SelectIacFolderStep` | Only in multi-root deploy | `iacFolder` |
| 2 | `HydrateAzdInfoStep` | Never | Hydration flags, `azdServiceName`, possibly `environmentName` |
| 3 | `HydratableChooseSubscriptionStep` | Unless hydrated | `subscription` |
| 4 | `HydratableChooseLocationStep` | Unless hydrated | `location` |
| 5 | `ProjectNameStep` | Unless `environmentName` set | `environmentName`, `azdServiceName` (if not already hydrated) |
| 6 | `PickRuntimeStep` | Unless `hasInfra` | `functionWorkerRuntime` |
| 6a | `PickRuntimeVersionStep` (subprompt of `PickRuntimeStep`) | Unless `hasInfra` or version already set (only shows a pick when the runtime has more than one supported version) | `runtimeVersion` |
| 7 | `PickHostingPlanStep` | Unless `hasInfra` | `hostingPlan` |
| 8 | `ConfirmProvisionStep` | Only when Bootstrapped | `provision` (may flip to `false`) |

### Execute steps (in order)

| # | Step | Runs when | Effect |
|---|------|-----------|--------|
| 1 | `GenerateBicepStep` | No existing `infra/` | Copies bundled `main.bicep` template, writes `main.parameters.json` |
| 2 | `GenerateAzureYamlStep` | No existing `azure.yaml` | Runs `azd init --minimal --no-prompt` |
| 3 | `CreateAzdEnvStep` | No `existingDefaultEnvName` | Runs `azd env new` |
| 4 | `AzdProvisionStep` | `provision === true` | Runs `azd provision` as a foreground VS Code task |
| 5 | `AzdDeployStep` | `deploy === true` | Runs `azd deploy`; tracks progress via `CodeDeploymentHandle` |
| 6 | `ShowEndpointUrlStep` | `iacFolder` is set | Shows a toast with the deployed endpoint URL |

## Scenario Matrix

The `deploy` job encounters one of three azd states in `iacFolder`. The `createNew` job always starts fresh.

### 1. Fresh — no azd state

Applies to: `createNew` (always), or `deploy` into an empty workspace folder.

- **All prompt steps run.** User picks subscription, location, project name, and resource-specific options.
- **All execute steps run.** Bicep + `azure.yaml` generated, env created, provisioning runs.
- `azdServiceName` is derived from the user's project name input.

### 2. Post-clone — `azure.yaml` exists, no fully-configured env

Applies to: `deploy` when the workspace has `azure.yaml` from a cloned repo. Since `.azure/` is gitignored by default, the typical post-clone state has **no azd environments at all**. A less common variant is a partially-configured default env (missing `AZURE_SUBSCRIPTION_ID` and/or `AZURE_LOCATION`).

- `HydrateAzdInfoStep` sets `hasAzureYaml` (and `hasInfra` / `hasServices` as appropriate). If `azure.yaml` has `services:`, `azdServiceName` is set from the first service key.
- When **no envs exist** (typical): `environmentName` is **not** set by hydration. `ProjectNameStep` **prompts** for the name, sets `environmentName`, and preserves the hydrated `azdServiceName`.
- When a **partial env exists** (rare): `environmentName` is seeded with a suffixed name (e.g. `dev-2`) to avoid colliding with the broken env. `ProjectNameStep` is **skipped** (`environmentName` already set).
- Subscription and location pickers **still prompt** (no hydrated values).
- `GenerateBicepStep` / `GenerateAzureYamlStep` are skipped if `hasInfra` / `hasAzureYaml`.
- `CreateAzdEnvStep` **runs**. `ConfirmProvisionStep` is skipped (no `existingDefaultEnvName`).

### 3. Bootstrapped — default env fully configured

Applies to: `deploy` when the default env has both `AZURE_SUBSCRIPTION_ID` and `AZURE_LOCATION`.

- `HydrateAzdInfoStep` seeds `environmentName`, `existingDefaultEnvName`, `hydratedSubscriptionId`, `hydratedLocationName`, and `azdServiceName` (from the first service key in `azure.yaml`).
- **Subscription, location, and project name pickers are all skipped.**
- `ConfirmProvisionStep` **prompts**: "Provision now?" If the user picks No, `provision` flips to `false` and `AzdProvisionStep` skips.
- `GenerateBicepStep`, `GenerateAzureYamlStep`, and `CreateAzdEnvStep` are all skipped.

## Key Design Decisions

### `azdServiceName` resolution

`azdServiceName` identifies the deployed resource for `azd deploy` targeting. It's resolved in priority order:

1. **Hydration** — `HydrateAzdInfoStep` reads the first key from `services:` in `azd show` output.
2. **User input** — `ProjectNameStep` sets it from the project name, but only if hydration didn't already provide one.

This ensures that existing projects keep their established service names while fresh projects derive a sensible default from the user's chosen name.

### Temp directory lifecycle

`createNew` uses `TempDirManager`, which allocates directories under `extensionContext.storageUri/tmp/d-{uuid}`. These are cleaned up when the manager is disposed (extension deactivation). The workspace is never modified.

### Environment collision avoidance

When the default env is partially configured (Post-clone), the wizard never mutates it. Instead, `HydrateAzdInfoStep` generates a suffixed name (e.g. `dev-2`, `dev-3`) that doesn't collide with existing envs. `CreateAzdEnvStep` also double-checks at execute time with `azd env exists` as a safety net.

### Provision gating

`provision` is seeded to `true` by the command entry point. Only the Bootstrapped state shows a confirmation prompt — this is the one case where re-provisioning could affect an existing live deployment. Fresh and Post-clone paths provision unconditionally (the environment is new, so there's nothing to overwrite).

## Static Web Apps Creation

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

## Adding a New Resource Type

To add a new creation wizard (e.g. Static Web App):

1. **Create a context type** extending `AzdWizardContext` with resource-specific fields.
2. **Add resource-specific prompt steps** (e.g. `PickFrameworkStep`). These should check `hasInfra` to skip when infrastructure already exists.
3. **Add a Bicep template** in `resources/templates/` (e.g. `staticWebApp.bicep`).
4. **Create a command class** implementing `ManagedCommand`. Inject `Container` and resolve each step via `this.container.get(SomeStep)` -- steps are `@injectable`, so the per-execution child container (which has `autobind` enabled) constructs them with their dependencies. Assemble the wizard with the shared steps (`SelectIacFolderStep`, `HydrateAzdInfoStep`, `HydratableChooseSubscriptionStep`, `HydratableChooseLocationStep`, `ProjectNameStep`) plus your resource-specific steps. Add your new template name to the `BicepTemplateName` union in `GenerateBicepStep.ts` (which is resolved through a factory rather than autobind -- see [Dependency Injection](dependency-injection.md#factory-bindings-for-azure-clients)).
5. **Register the command** in `registerCommands.ts` with `prefixArgs` for each `AzdJob`. See [Commands](commands.md) for the registration pattern.

> Wizard steps are resolved from the container rather than constructed with `new`. A step that needs DI services declares them with `@inject(<token>)` on its constructor and is marked `@injectable()`; the command never threads those services through. See [Dependency Injection](dependency-injection.md) for how the per-execution child container enables `autobind`.
