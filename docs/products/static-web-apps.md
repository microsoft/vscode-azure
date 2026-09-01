# Azure Static Web Apps

Current product documentation for Static Web Apps features in
`extensions/vscode-azure`.

The migration records are:
[INVENTORY.md](../migrations/swa/INVENTORY.md) for source-extension facts,
[TRIAGE.md](../migrations/swa/TRIAGE.md) for decisions,
[MIGRATION-PLAN.md](../migrations/swa/MIGRATION-PLAN.md) for the reconstructed
implementation sequence, and
[PARITY-REPORT.md](../migrations/swa/PARITY-REPORT.md) for current coverage and
open gaps.

## Tree shape

```text
Static Web App
|- Production environment
|  |- Application Settings
|  `- Functions (or Functions help)
`- Preview environment xN
   |- Application Settings
   `- Functions (or Functions help)
```

The root is a `Microsoft.Web/staticSites` ARM resource. Environments come from
the Static Sites builds API and are virtual nodes, not first-class ARM
resources. The build id `default` identifies production; all other builds are
preview environments. Production is sorted first.

Preview labels can contain service-provided pull request titles and branches.
Virtual paths use the stable build id, not those display values. Fork branch
values are normalized for display without changing production's source branch.
Each build carries its own hostname, so the root and every environment can use
the shared Browse Website command.

Malformed environments and functions remain visible as warning nodes rather
than silently disappearing.

## Commands

| Command | Acts on | Notes |
|---|---|---|
| Create Static Web App... | palette / workspace | azd+Bicep creation; Free plan by default |
| Configure CI/CD | palette / `azure.yaml` context menu | Runs `azd pipeline config` |
| Create Configuration File | workspace | Creates `staticwebapp.config.json` |
| Delete Environment... | preview environment | Deletes the selected build |
| Documentation | palette | Opens Static Web Apps documentation |
| Azure Functions Documentation | Functions help | Opens managed API guidance |
| Install / Update Azure Static Web Apps CLI | palette | Shared tool acquisition for `swa` |

Open in Portal, Browse Website, root-resource Delete, and View Properties are
shared commands. View Properties reads an environment through
`StaticWebAppEnvironmentPropertiesAdapter`, because the payload worth showing is
the build behind the virtual node rather than what an ARM GET returns.

## Environments, settings, and managed Functions

Production and preview environments use different Static Sites endpoints:
site-level endpoints for production and build-level endpoints for previews.
That distinction applies to settings and managed Functions.

Each environment owns an independent application-settings dictionary.
`StaticWebAppSettingsAdapter` reads and replaces the appropriate site/build
dictionary through the shared JSONC settings editor. The site root has no
settings document. Full-dictionary replacement means concurrent edits can
overwrite one another.

The provider probes the corresponding function-app-settings endpoint to
determine whether an environment has a managed API. A successful probe adds a
Functions group whose children come from the site/build Functions endpoint. A
rejected probe produces a help row instead. The settings editor deliberately
uses the application-settings endpoints, which remain available independently
of that managed-API probe.

Functions portal navigation uses a related-resource URL derived from the
environment build id. Resource selection, portal URL construction, and paging
come from shared monorepo abstractions.

## Creation and provisioning

`CreateStaticWebApp` runs one wizard. With an open workspace it uses the
`deploy` job; without one it uses `createNew`. Shared steps select the IaC
folder, hydrate azd state, choose subscription/location, choose the project
name, confirm, generate Bicep/`azure.yaml`, create the azd environment,
provision, deploy when eligible, and show the endpoint.

Product steps resolve the application, Functions API, and output locations
without asking. A layout the user has already declared in `swa-cli.config.json`
wins, since that file is what a later `swa build` reads. Otherwise
`DetectStaticWebAppConfigStep` calls `swa init --yes` through `SwaCliService`,
which keeps the framework table the CLI's to maintain rather than mirroring it
here. Creation therefore requires `swa`; when it is missing or too old the step
fails with the same actionable install toast the rest of the product uses.

Detection itself is read-only even though `swa init` is a scaffolding command.
The CLI scans its working directory but writes to the path given by `--config`,
and stores what it found verbatim rather than rebasing it onto the
configuration's own location. Pointing `--config` at a scratch directory
therefore yields the detection-only mode the CLI does not otherwise offer. For
an eligible deploy job, the detected file is written to the workspace only
after the user confirms; a provision-only job leaves the project untouched. A
detection run still exits zero when it finds nothing, so the result is read
back by name instead of trusted from the exit code.

The generated Bicep provisions a Static Web App through the pinned
`avm/res/web/static-site:0.9.5` module. The plan defaults to Free; changing the
`staticWebAppSkuName` parameter and provisioning again applies a different
supported SKU. The resource receives the shared azd environment/service tags.

The `host: staticwebapp` azd service runs from the workspace root when an SWA
CLI configuration owns the build. This lets azd discover the file, invoke
`swa build`, and preserve API runtime metadata such as Python. Without that
file, the service records `project` and `dist` for a prebuilt static artifact.
`canAzdDeployStaticWebApp` is the single gate on whether an output location
produces one. Empty, `/`, and `.` provision the ARM resource with nothing to
deploy. So does `.next`: the CLI reports one output location per framework, so
a server-rendered Next.js project and its static export both resolve to the
server build, which would be a broken site if uploaded as static content.

## Configuring CI/CD

`ConfigureCicd` is a two-step wizard: the shared
`SelectIacFolderStep` resolves the folder containing `azure.yaml`, then
`AzdPipelineConfigStep` runs `azd pipeline config` there. Nothing about it is
specific to Static Web Apps -- it is the shared command for any azd project,
and lives beside the other azd commands in `src/commands/deploy/`.

Everything after that belongs to azd. It prompts for the provider, creates and
pushes a repository when the project has no remote yet, authenticates against
the provider, and writes the workflow file. The extension deliberately does not
inspect Git metadata beforehand, because every such check could only remove a
capability azd already has.

The one precondition enforced locally is `MinAzdPipelineVersion`, since
federated Azure DevOps authentication fails below it and azd asks which provider
to use only once it is already running. When no azd version can be read at all,
the command proceeds so azd's own "not found" install prompt is what the user
sees.

A successful run means the pipeline is configured, not that code was deployed;
that happens on the next push.

## Configuration and local tooling

Two similarly named files have separate owners:

| File | Purpose |
|---|---|
| `staticwebapp.config.json` | Service routing, fallback, authentication, and related runtime configuration |
| `swa-cli.config.json` | Local SWA CLI configuration; creation reads the app/API/output layout from it when present |

The manifest associates the public schemas for both files.

`SwaInstaller` registers the `swa` executable with the shared tool service. The
independent install/update command acquires version 2 or later through
Homebrew, where available, or the
[`@azure/static-web-apps-cli`](https://www.npmjs.com/package/@azure/static-web-apps-cli)
npm package. No CLI check or outdated-version warning runs at activation.

`SwaCliService` invokes that executable, mirroring `AzdService`: it resolves the
path the tool service last acquired and falls back to the bare command name, and
it turns a missing or too-old CLI into a warning toast offering the install
command. `detect()` runs `swa init --yes` against a scratch file to let the CLI
detect a project's framework, then reads the file back rather than trusting the
exit code -- the CLI reports a detection or write failure on its output alone
and still exits zero.

## Current limitations

- Static Web Apps browser/Functions debugging, generated emulator tasks, Data
  API location discovery, task lifecycle coordination, and `$swa-watch` are
  tracked together by
  [#339](https://github.com/microsoft/vscode-azure/issues/339).
- GitHub Actions run/job/step browsing and native SWA workflow parsing are not
  part of the product.
- Repository bootstrap is not implemented and has no linked tracking issue.

See [PARITY-REPORT.md](../migrations/swa/PARITY-REPORT.md) for row-by-row
accounting.
