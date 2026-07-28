# Azure for VS Code: Engineering Pains and How the Consolidated Architecture Addresses Them

## Executive summary

`microsoft/vscode-azure` was created on February 17, 2026 to build a consolidated
Azure experience for VS Code. It brings the user-facing extension and its immediate
general and Azure-specific utility layers into one workspace-based repository.

This is more than a repository merge. It changes the unit of engineering delivery:

- **Before:** Azure Resources and the service extensions were separate products that
  consumed independently versioned packages from `microsoft/vscode-azuretools`.
  Changes that crossed those boundaries required package builds or releases,
  downstream dependency updates, and sometimes coordinated rollouts across many
  repositories.
- **Now:** the extension, Azure abstractions, and general infrastructure can change
  together in one pull request, build, and test run. Narrow providers, dependency
  injection, shared command and wizard frameworks, and a layered tree model provide
  explicit extension points within the product.
- **Intentionally unchanged:** `vscode-azuretools` remains valuable as the shared
  engineering control plane for reusable CI, linting, testing, and packaging
  standards across the broader VS Code extension fleet.

The expected management outcome is a lower coordination tax, faster end-to-end
changes, more consistent engineering quality, and a clearer path to evolve the
Azure product without preserving every historical internal abstraction indefinitely.
It also reduces a significant ownership multiplier: routine maintenance, compliance,
dependency, runtime, CI, and release tasks previously had to be completed and
validated separately in every repository the team owned. The user migration and
service-migration rollout remain active delivery workstreams; the partner contribution
strategy is now documented.

## Scope and evidence

This report reviews the issue and pull request history available through July 28,
2026 for:

- [`microsoft/vscode-azure`](https://github.com/microsoft/vscode-azure), created
  February 17, 2026.
- [`microsoft/vscode-azuretools`](https://github.com/microsoft/vscode-azuretools),
  created October 13, 2017.
- [`microsoft/vscode-azureresourcegroups`](https://github.com/microsoft/vscode-azureresourcegroups),
  created February 5, 2020.

The conclusions below combine documented facts with architectural synthesis. Links
to issues, pull requests, and source documents are included so readers can distinguish
shipped implementation from proposals and open work. Closed, unmerged pull requests
are used only as evidence that a pain was recognized, not that their proposed fix
shipped.

## What the predecessor model optimized for

The old model was reasonable for a growing family of independent extensions:

- `vscode-azuretools` supplied common packages for authentication, Azure APIs,
  UI flows, testing, and engineering infrastructure.
- Azure Resources supplied the common account/subscription/resource-group tree
  and APIs through which installed service extensions contributed service-specific
  functionality.
- Service extensions retained separate ownership, releases, and marketplace
  identities.

Over time, those boundaries also became delivery boundaries. The same separation
that enabled independent products increased the cost of changes that needed to move
shared infrastructure, the common resource experience, and service functionality
together.

## Pain points and solutions

### 1. Cross-repository shared-package development was slow and fragile

**Pain.** The documented local-development workflow for `vscode-azuretools`
required building a `.tgz` in the package repository, installing it into a consuming
extension, and repeating that loop for each change. The alternative, `npm link`, was
known to cause missing breakpoints and removed dependencies. See the
[`vscode-azuretools` development instructions](https://github.com/microsoft/vscode-azuretools/blob/main/README.md).

This meant an end-to-end feature could require:

1. A shared-package change.
2. A package build or publication.
3. A dependency update in one or more consumers.
4. Validation in each consuming repository.

**Solution.** The new repository contains three pnpm workspaces with a deliberate
dependency direction: extension -> Azure utilities -> general utilities. Internal
dependencies use workspace references, and extension builds resolve local package
source directly. See the
[`vscode-azure` architecture](https://github.com/microsoft/vscode-azure/blob/main/docs/architecture.md),
the [workspace configuration](https://github.com/microsoft/vscode-azure/blob/main/pnpm-workspace.yaml),
and [PR #183](https://github.com/microsoft/vscode-azure/pull/183).

**Outcome.** A change to a tree abstraction, Azure client wrapper, and the user
experience that consumes them can be authored, reviewed, built, and tested as one
coherent change. Publication is no longer required merely to validate integration.

### 2. Dependency and release coordination accumulated hidden cost

**Pain.** Independently managed packages and lockfiles allowed versions and dependency
assumptions to drift. A 2026 attempt to migrate `vscode-azuretools` to pnpm workspaces
found eight package lockfiles, inconsistent shared versions, dependencies that had
worked only because npm hoisted them, duplicated Azure SDK type identities, and
repeated VS Code test downloads. That PR was closed without merge, but it is useful
evidence of the accumulated complexity. See
[`vscode-azuretools` PR #2354](https://github.com/microsoft/vscode-azuretools/pull/2354).

**Solution.** The new repository uses one lockfile, pnpm workspace isolation, a
catalog for shared versions, workspace-wide security overrides, explicit native-build
allowlisting, and a one-week minimum package release age. See
[`pnpm-workspace.yaml`](https://github.com/microsoft/vscode-azure/blob/main/pnpm-workspace.yaml)
and [PR #183](https://github.com/microsoft/vscode-azure/pull/183).

**Outcome.** Dependency consistency and supply-chain policy are enforced at the
repository boundary. Strict isolation exposes undeclared dependencies early instead
of allowing them to survive as hidden coupling.

### 3. Shared infrastructure changes required fleet-wide interlocked rollouts

**Pain.** Some changes to shared engineering infrastructure affected every consumer
of a moving pipeline-template reference. A 2026 private-feed migration required a
multi-phase rollout across 14 repositories, with explicit gates before changing the
shared template. Azure Resources alone needed an additive PR and a cleanup PR as part
of that sequence. See
[`vscode-azuretools` issue #2320](https://github.com/microsoft/vscode-azuretools/issues/2320),
[`vscode-azureresourcegroups` PR #1477](https://github.com/microsoft/vscode-azureresourcegroups/pull/1477),
and [`vscode-azureresourcegroups` PR #1479](https://github.com/microsoft/vscode-azureresourcegroups/pull/1479).

This was part of a broader **cost-of-ownership multiplier**. Many tasks did not become
more valuable when repeated, but repository boundaries required the repetition:

- Mandatory Microsoft files, licenses, security policy, and other compliance updates.
- Dependency and vulnerability remediation, lockfile updates, and SDK migrations.
- Node.js, TypeScript, test-runner, lint, build, and packaging upgrades.
- CI and release-pipeline changes, secrets/feed configuration, and policy adoption.
- Marketplace metadata, release preparation, validation, and incident fixes.

With a fleet of independently released extensions, one maintenance requirement could
produce a separate issue, pull request, build, review, rollout decision, and release
in every owned repository. The 14-repository feed migration is a concrete example,
but the same multiplication applied to routine work throughout the year. This raised
total cost of ownership and displaced time that could otherwise go to user-facing
capabilities.

**Solution.** Product code and its immediate abstractions now move together in this
repository, while common engineering templates continue to come from
`vscode-azuretools`. The new repository's
[main workflow](https://github.com/microsoft/vscode-azure/blob/main/.github/workflows/main.yml)
still invokes the reusable Azure engineering job.

**Outcome.** The design reduces multi-repository coordination where code and API
changes are product-specific, without copying fleet-wide engineering standards into
the product repository. A single maintenance or compliance change can cover the
consolidated product once instead of being repeated for each absorbed extension.
Centralization is applied selectively rather than treated as an all-or-nothing goal.

### 4. The common resource tree carried data, presentation, compatibility, and service integration concerns

**Pain.** The predecessor extension's activation path assembled provider managers,
branch-provider managers, caches, multiple trees, compatibility adapters, and
versioned APIs for dependent extensions. Temporary APIs also had to remain while
service extensions migrated. See the
[`vscode-azureresourcegroups` activation code](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/src/extension.ts).

Adding a service experience could therefore cross several concerns:

- Azure data acquisition and caching.
- Tree presentation and grouping.
- Resource identity and reveal behavior.
- Compatibility with independently released service extensions.
- Commands and context-value conventions.

**Solution.** The new tree architecture explicitly separates:

- A **data layer** for loading, caching, pagination, enrichment, and invalidation.
- A **view layer** for filtering, grouping, virtual nodes, labels, icons, and commands.
- Ordered, narrow providers with generic fallbacks.
- Stable URI-based Azure node identities.

The architecture was introduced incrementally in
[PR #17](https://github.com/microsoft/vscode-azure/pull/17),
[PR #20](https://github.com/microsoft/vscode-azure/pull/20),
[PR #22](https://github.com/microsoft/vscode-azure/pull/22),
[PR #23](https://github.com/microsoft/vscode-azure/pull/23), and
[PR #26](https://github.com/microsoft/vscode-azure/pull/26). The current contract is
documented in
[`tree-views.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/tree-views.md)
and
[`resource-models.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/resource-models.md).

**Outcome.** New service behavior is added through focused providers and models
rather than by expanding a central compatibility-heavy tree implementation. Data and
presentation can evolve and be tested independently.

### 5. Tree responsiveness competed with correctness and cache freshness

**Pain.** The predecessor had known performance pressure around revealing resources,
performing Azure calls before expansion, issuing repeated `GET` calls instead of
`LIST`, and keeping cached lists correct after mutation. See the unmerged
[`vscode-azureresourcegroups` PR #887](https://github.com/microsoft/vscode-azureresourcegroups/pull/887).

These are related problems: broad refreshes preserve correctness but create latency
and unnecessary API traffic; aggressive caching improves responsiveness but risks
stale data.

**Solution.** The new data tree supports:

- Lazy loading on expansion.
- Paged results loaded on demand.
- Configurable and provider-specific cache lifetimes.
- Background enrichment that preserves object identity.
- O(1) node lookup.
- Narrow invalidation by key, subtree, subscription, resource type, root set, or
  full tree.
- Root reconciliation that preserves valid subtrees during account changes.

See [PR #36](https://github.com/microsoft/vscode-azure/pull/36),
[PR #193](https://github.com/microsoft/vscode-azure/pull/193),
[PR #200](https://github.com/microsoft/vscode-azure/pull/200), and the
[tree architecture](https://github.com/microsoft/vscode-azure/blob/main/docs/tree-views.md).

**Outcome.** Refresh scope is now an explicit design choice. A deployment can
invalidate one subscription, an account change can reconcile roots, and a global
cloud change can still invalidate everything. This reduces unnecessary Azure calls
and rerendering without pretending that all cached data has the same lifetime.

**Remaining work.** A view-layer performance guardrail was proposed in
[issue #100](https://github.com/microsoft/vscode-azure/issues/100), and persistent
tenant/subscription caching remains under consideration in
[issue #194](https://github.com/microsoft/vscode-azure/issues/194).

### 6. Authentication and Azure SDK churn leaked through shared and product layers

**Pain.** Azure Resources had already migrated users from the Azure Account extension
to VS Code's built-in Microsoft authentication, with known session and selected-
subscription migration effects. Its implementation still depended on shared
authentication and environment packages. Meanwhile, old and new Azure SDK client
styles imposed different authentication, pipeline, pagination, type, and bundle-size
behaviors. See the
[`vscode-azureresourcegroups` README](https://github.com/microsoft/vscode-azureresourcegroups/blob/main/README.md)
and [`vscode-azure` issue #107](https://github.com/microsoft/vscode-azure/issues/107).

**Solution.** The new Azure utility package owns a smaller boundary:

- `VsCodeExtensionCredential` integrates with VS Code authentication.
- `EnvironmentLike` and cloud presets replace a deprecated environment package.
- Credentials are created through an injectable factory rather than embedded in
  subscription objects.
- Typed REST client wrappers normalize client creation and pagination.
- Shared pipeline policies provide correlation, language, and request behavior.
- Modular Azure SDK packages reduce bundle size and avoid two competing client
  patterns.

See [PR #51](https://github.com/microsoft/vscode-azure/pull/51),
[PR #54](https://github.com/microsoft/vscode-azure/pull/54),
[PR #186](https://github.com/microsoft/vscode-azure/pull/186), and the comprehensive
[PR #187](https://github.com/microsoft/vscode-azure/pull/187).

**Outcome.** Authentication, sovereign-cloud behavior, MFA/CAE handling, resource
identity, and Azure REST clients now meet at a deliberately owned boundary. Product
providers consume stable local interfaces instead of reproducing SDK and auth details.

### 7. Commands, resource creation, and deployment repeatedly needed the same plumbing

**Pain.** Across separate extensions, common user flows repeatedly needed resource
selection, telemetry, error handling, wizard navigation, process execution, progress
tracking, and Azure provisioning logic. Independent implementations increase UX
variation and make changes such as adding cancellation, telemetry, or a new creation
mode expensive to propagate.

The new repository's planning issues made the design questions explicit for both
[single-resource creation](https://github.com/microsoft/vscode-azure/issues/103) and
[full application deployment](https://github.com/microsoft/vscode-azure/issues/102).

**Solution.**

- Injectable `ManagedCommand` classes receive execution-scoped action context.
- Registration automatically wraps commands with telemetry and error handling.
- A reusable wizard framework supports prompt steps, execute steps, and back
  navigation.
- Shared resource-selection steps work from either tree context or the command
  palette.
- Resource creation generates Bicep and uses `azd`, with separate create-now and
  deploy-into-workspace jobs.
- Existing `azd` state is hydrated so the extension avoids redundant prompts and
  does not overwrite partially configured environments.
- Deployment progress appears in a common activity model.

See [PR #29](https://github.com/microsoft/vscode-azure/pull/29),
[PR #31](https://github.com/microsoft/vscode-azure/pull/31),
[PR #74](https://github.com/microsoft/vscode-azure/pull/74),
[PR #79](https://github.com/microsoft/vscode-azure/pull/79),
[PR #125](https://github.com/microsoft/vscode-azure/pull/125),
[`commands.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/commands.md),
and
[`resource-creation.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/resource-creation.md).

**Outcome.** New resource types can reuse a standard sequence and add only their
specific prompts, Bicep template, and provider behavior. Cross-cutting behavior is
implemented once and applied consistently.

### 8. Tight runtime coupling made isolated testing and consistent telemetry harder

**Pain.** Code that directly imports VS Code APIs, manually constructs dependencies,
or threads telemetry through every call chain is difficult to unit test. In a
provider-rich extension, that pressure encourages either large extension-host tests
or increasingly elaborate hand-built mocks.

**Solution.**

- Dependency injection defines explicit service seams for VS Code, Azure clients,
  credentials, commands, process execution, telemetry, and trees.
- Each command receives a child container and execution-scoped action context.
- `AsyncLocalStorage` carries correlation and telemetry context through data,
  view, polling, and HTTP pipeline operations.
- Shared mocks and Azure fixtures support fast unit tests, while extension-host and
  end-to-end tests cover integration behavior.
- Root scripts run lint, build, and test consistently across all workspaces.

See [PR #9](https://github.com/microsoft/vscode-azure/pull/9),
[PR #39](https://github.com/microsoft/vscode-azure/pull/39),
[PR #41](https://github.com/microsoft/vscode-azure/pull/41),
[PR #53](https://github.com/microsoft/vscode-azure/pull/53),
[PR #197](https://github.com/microsoft/vscode-azure/pull/197),
[`dependency-injection.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/dependency-injection.md),
[`testing.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/testing.md), and
[`telemetry.md`](https://github.com/microsoft/vscode-azure/blob/main/docs/telemetry.md).

**Outcome.** Most behavior can be tested without launching VS Code or calling Azure,
while common telemetry records result, duration, correlation, activation load time,
and tree-operation context. The architecture makes testability and observability
default behavior rather than optional work for each feature.

**Remaining work.** Coverage enforcement is still being considered in
[issue #98](https://github.com/microsoft/vscode-azure/issues/98). A bundle-size
guardrail was proposed in
[issue #99](https://github.com/microsoft/vscode-azure/issues/99) and implemented in
[PR #119](https://github.com/microsoft/vscode-azure/pull/119).

### 9. Product consolidation creates migration and ownership risks of its own

**Pain.** The predecessor model has an installed base, established command and setting
identities, and service extensions that depend on Azure Resources APIs. A hard cutover
would risk duplicate trees and commands, lost settings, broken partner integrations,
and user confusion.

**Solution.** The migration plan makes coexistence a staged product decision:

1. Internal MVP.
2. Standalone beta that disables itself beside Azure Resources.
3. User opt-in after feature completeness, with Azure Resources disabling itself.
4. GA replacement, with Azure Resources becoming an extension-pack stub.
5. Deprecation and cleanup.

See [issue #105](https://github.com/microsoft/vscode-azure/issues/105),
[PR #225](https://github.com/microsoft/vscode-azure/pull/225), and the
[migration plan](https://github.com/microsoft/vscode-azure/blob/main/docs/monorepo-migration.md).

The partner contribution strategy has also been documented, resolving
[issue #104](https://github.com/microsoft/vscode-azure/issues/104) through
[PR #232](https://github.com/microsoft/vscode-azure/pull/232). The chosen direction is
to:

- Migrate Microsoft-owned extensions first and prove the path before onboarding
  partners.
- Inventory each extension's features and explicitly decide what to migrate, adapt,
  reuse, defer, or drop.
- Agree with each partner team on long-term maintenance ownership before migration.
- Keep the public API intentionally small, preferring commands over a broad extension
  API and not preserving tree data-provider APIs by default.

That migration process is supported by feature-inventory and feature-migration skills
added in [PR #229](https://github.com/microsoft/vscode-azure/pull/229). They reconcile
manifest, source, documentation, and telemetry evidence; require human approval of
feature dispositions; and rebuild selected features on the monorepo's architecture
rather than copying legacy implementations.

**Outcome.** Compatibility is treated as an explicit workstream with gates rather
than as indefinite architecture. The plan preserves user choice during transition
and makes feature completeness a prerequisite for replacement. Partner onboarding
now has a documented sequence, API direction, migration method, and ownership
checkpoint. The first application of that process is underway in the open
[Static Web Apps migration PR #237](https://github.com/microsoft/vscode-azure/pull/237).

**Remaining work.** The strategy is resolved, but execution remains: Microsoft-owned
extensions must be migrated first, the existing Azure Resources API must be reviewed
to decide which capabilities survive, authentication integration still needs a
partner-facing plan, and each partner migration still requires an explicit maintenance
ownership agreement.

## Summary comparison

| Area | `vscode-azuretools` / Azure Resources model | Consolidated `vscode-azure` model |
|---|---|---|
| Unit of change | Package PR/release plus downstream consumer PRs | Extension and immediate utility layers can change in one PR |
| Dependencies | Independently versioned packages and multiple lockfiles | Workspace references, one lockfile, shared version catalog |
| Resource tree | Shared extension APIs plus service-extension integration and compatibility | Data/view separation with ordered, narrow providers |
| Caching | Performance and staleness handled across tree and service implementations | Lazy, paged, enriched data with targeted invalidation |
| Authentication | Shared auth/environment packages consumed by product code | Locally owned credential, identity, environment, and client boundary |
| Commands and wizards | Patterns repeated or propagated across extensions | DI-backed managed commands and reusable wizard/resource-selection steps |
| Testing | Repository- and package-specific seams | Shared mocks/fixtures plus unit, integration, and E2E layers |
| Telemetry | Shared utilities adopted by each consumer | Automatic command/tree scoping and correlation by default |
| CI standards | Central shared templates | Central shared templates retained intentionally |
| Migration | Independently installed extensions and APIs | Staged coexistence plus inventory, human triage, architectural rebuild, replacement, and deprecation |

## Delivery timeline

| Date | Milestone |
|---|---|
| 2017-10-13 | `vscode-azuretools` created for common Azure extension packages. |
| 2020-02-05 | `vscode-azureresourcegroups` created as the common Azure resource-management extension. |
| 2024-07-25 | Azure Resources [PR #887](https://github.com/microsoft/vscode-azureresourcegroups/pull/887) documents reveal, Azure-call, and cache-performance concerns. |
| 2026-02-17 | `vscode-azure` created; initial extension/package scaffold and CI land in [PR #6](https://github.com/microsoft/vscode-azure/pull/6) and [PR #7](https://github.com/microsoft/vscode-azure/pull/7). |
| 2026-02 to 2026-03 | DI, data/view tree layers, stable node IDs, paging, wizards, testing helpers, telemetry context, Azure client wrappers, sovereign-cloud support, and extension tests are established. |
| 2026-03 to 2026-05 | Function App support, provisioning, activity tracking, bundle-size protection, `azd` integration, full-app deployment, tool installation, and the workspace view are added. |
| 2026-06-08 | The repository migrates to pnpm workspaces in [PR #183](https://github.com/microsoft/vscode-azure/pull/183). |
| 2026-06-05 to 2026-06-08 | Shared pipeline migration [issue #2320](https://github.com/microsoft/vscode-azuretools/issues/2320) demonstrates the coordination cost of fleet-wide infrastructure changes. |
| 2026-06-12 to 2026-06-25 | Auth/identity/REST boundaries, root reconciliation, selector-based cache invalidation, E2E infrastructure, and subscription-selection flows mature. |
| 2026-07-15 | The phased product migration plan lands in [PR #225](https://github.com/microsoft/vscode-azure/pull/225). |
| 2026-07-23 | Feature inventory and migration skills land in [PR #229](https://github.com/microsoft/vscode-azure/pull/229), and the partner/API strategy lands in [PR #232](https://github.com/microsoft/vscode-azure/pull/232), resolving issue #104. |
| 2026-07-28 | Research cutoff for this report; the first service migration is underway in [Static Web Apps PR #237](https://github.com/microsoft/vscode-azure/pull/237). |

## Management takeaways

1. **The primary gain is coordination efficiency.** The extension and the abstractions
   most likely to evolve with it now share a delivery boundary.
2. **Consolidation reduces the ownership multiplier.** Compliance, dependency,
   runtime, CI, release, and incident-response work can be completed once for the
   consolidated product rather than once per independently owned repository.
3. **The architecture is designed for growth, not merely consolidation.** Provider
   dispatch, data/view separation, DI, managed commands, and reusable wizards make
   service additions narrower and more consistent.
4. **Performance and correctness are explicit contracts.** Lazy loading, pagination,
   enrichment, root reconciliation, and targeted invalidation replace broad,
   implicit cache behavior.
5. **Shared engineering has not been discarded.** `vscode-azuretools` remains the
   right home for standards that should move the whole extension fleet together.
6. **Migration execution is the largest remaining risk.** The partner strategy is
   documented; GA should remain gated on feature completeness, settings and API
   compatibility decisions, successful migration of Microsoft-owned extensions,
   and explicit maintenance ownership agreements with partner teams.

## Recommended success measures

To verify that the consolidation delivers the intended benefits, track:

- Median time from a shared-abstraction change to validated product integration.
- Number of repositories and published package versions required per feature.
- Engineering time and pull-request count spent applying the same maintenance,
  compliance, dependency, runtime, or pipeline change across repositories.
- Build, lint, and test duration for local and CI workflows.
- Extension activation time, bundle size, tree expansion latency, and Azure request
  volume.
- Defect rate in authentication, tree refresh, reveal, and deployment flows.
- Percentage of commands/providers covered by shared patterns and automated tests.
- Migration adoption, side-by-side conflict rate, settings-migration failures, and
  support incidents during each rollout phase.
- Time and review effort required for a partner team to add or update a service
  experience.
