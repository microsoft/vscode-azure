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
| Deploy Static Web App... | palette / post-create route | Uses azd for direct deployment or CI/CD setup |
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

Product steps select one of 13 retained build presets and resolve application,
Functions API, and output locations. Defaults come from framework detection,
the selected preset, and `swa-cli.config.json`.

The generated Bicep provisions a Static Web App through the pinned
`avm/res/web/static-site:0.9.5` module. The plan defaults to Free; changing the
`staticWebAppSkuName` parameter and provisioning again applies a different
supported SKU. The resource receives the shared azd environment/service tags.

The `host: staticwebapp` azd service records `project` and `dist` for deployable
static artifacts. Empty, `/`, and `.` output locations can provision the ARM
resource but do not produce an azd deploy target. Server-rendered Next.js also
stops with explicit guidance rather than reporting a deployment.

## Deployment routing

The current implementation inspects existing Git metadata but never creates a
repository, adds a remote, or pushes a branch.

- No supported remote: run direct `azd deploy` for a valid static artifact.
- Supported GitHub/Azure DevOps remote without an upstream branch: explain the
  prerequisite and offer direct deployment.
- Supported pushed remote with a sufficient azd version: run interactive
  `azd pipeline config`.
- Invalid/missing `host: staticwebapp` service or unsupported artifact: stop
  with reason-specific guidance.

Before configuring one provider, the command checks for the other provider's
canonical azd workflow file and asks for confirmation. It does not delete or
overwrite pipeline files itself.

This routing is under active ownership review on PR #237. Review feedback asks
whether parsing/editing `azure.yaml`, build-preset scaffolding, and the routing
decision should move further into azd. The implementation above is current
branch behavior, not a settled exception to that boundary.

## Configuration and local tooling

Two similarly named files have separate owners:

| File | Purpose |
|---|---|
| `staticwebapp.config.json` | Service routing, fallback, authentication, and related runtime configuration |
| `swa-cli.config.json` | Local SWA CLI configuration; creation reads location defaults from it |

The manifest associates the public schemas for both files.

`SwaInstaller` registers the `swa` executable with the shared tool service. The
independent install/update command acquires version 2 or later through
Homebrew, where available, or the
[`@azure/static-web-apps-cli`](https://www.npmjs.com/package/@azure/static-web-apps-cli)
npm package. No CLI check or outdated-version warning runs at activation.

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
