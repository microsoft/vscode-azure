# Executive Brief: The vscode-azure Platform Consolidation

*Companion to [engineering-pains-and-solutions.md](./engineering-pains-and-solutions.md), which
documents the underlying pain points and solutions in detail. This brief is the condensed
summary, with quantitative evidence of the maintenance burden the consolidation is designed to
retire.*

## Problem We Solved

The previous Azure VS Code architecture optimized for independent extensions, but over time
engineering boundaries became delivery boundaries. Even simple cross-cutting improvements required
coordinated changes across shared packages, product repositories, release pipelines, and downstream
consumers. This created a growing coordination tax, duplicated maintenance effort, slower feature
delivery, and inconsistent engineering practices.

Because every recurring obligation -- security remediation, dependency updates, SDK upgrades,
runtime upgrades, CI/CD changes, compliance updates, and release management -- had to be repeated
once per repository, the cost of ownership scaled with the size of the fleet rather than with the
value being delivered.

## What Changed

We created a unified `vscode-azure` platform that consolidates the product experience, Azure
abstractions, testing infrastructure, authentication layer, deployment workflows, and engineering
patterns into a single delivery boundary while retaining the centralized engineering standards from
`vscode-azuretools`.

This transforms the engineering model from:

> "Many repositories coordinating together"

to

> "One platform evolving together".

## Business Impact

This investment delivers value across four dimensions:

### 1. Engineering Velocity
Features that previously required package releases, dependency updates, and coordinated rollouts can
now be implemented, validated, and shipped through a single workflow. Cross-cutting changes that
historically fanned out to an average of ~7 repositories collapse to a single pull request.

### 2. Reduced Operating Cost
The team eliminates repeated effort across compliance updates, dependency management, SDK upgrades,
Node/TypeScript upgrades, CI/CD changes, release management, and incident-response activities that
previously had to be replicated across multiple repositories. Over the last 12 months, this
recurring toil accounted for roughly **61% of all merged engineering work** across the fleet (see
Metrics below).

### 3. Platform Scalability
The new provider architecture, dependency-injection model, command framework, resource-creation
framework, telemetry system, testing infrastructure, and tree architecture create a reusable
foundation for onboarding future Azure services -- a new service is a set of providers inside one
platform, not a new repository with its own lifecycle to maintain.

### 4. Product Quality
Authentication, resource discovery, deployment, telemetry, testing, and data consistency are now
standardized platform capabilities instead of bespoke implementations across extensions.

## Metrics

### Velocity Metrics

| Metric | Before | After |
| --- | --- | --- |
| Unit of delivery | Package + consumer rollouts | Single PR / single workflow |
| Shared-infrastructure changes | Multi-repo coordination | Single product boundary |
| Feature integration | Publish + consume + validate | Build and test together |
| Dependency updates | Distributed across repos | Centralized (single lockfile + catalog) |
| Cross-cutting change fan-out | ~7 repositories per initiative (avg) | 1 repository |

*Evidence includes elimination of package-publication loops and migration to workspace-based
development.*

### Operational Efficiency Metrics

| Metric | Before | After |
| --- | --- | --- |
| Package lockfiles across the fleet | 26 (8 in `vscode-azuretools` alone) | 1 (`pnpm-lock.yaml`) |
| Dependency version management | Independent per repo and package | Shared `catalog:` in `pnpm-workspace.yaml` |
| Reach of a shared infrastructure migration (e.g. private-feed / 1ES rollout) | 14 repos, 31 coordinated PRs | 1 repo, 1 PR |

## Maintenance Toil: 12-Month Baseline (Quantitative)

To quantify the toil the consolidation retires, we measured every merged pull request across the
14-repo fleet over the last full year.

**Measurement window:** 2025-07-28 to 2026-07-27.
**Scope:** the 14 repositories that made up the pre-consolidation fleet (`vscode-azuretools`,
`vscode-azurefunctions`, `vscode-azureresourcegroups`, `vscode-azureappservice`,
`vscode-azurestorage`, `vscode-azurestaticwebapps`, `vscode-azurevirtualmachines`,
`vscode-azurecontainerapps`, `vscode-containers`, `vscode-docker`, `vscode-docker-extensibility`,
`compose-language-service`, `vscode-node-azure-pack`, `vscode-dev-azurecloudshell`).

### Headline: most merged work was maintenance, not product

| Category of merged work | PRs (12 mo) | Share |
| --- | ---: | ---: |
| Automated dependency updates (Dependabot) | 479 | 30% |
| Manual maintenance (compliance, deps, SDK, runtime, CI/CD, release, incidents) | 486 | 31% |
| **Total maintenance / keeping-the-lights-on** | **965** | **61%** |
| Product features and other work | 623 | 39% |
| **Total merged PRs** | **1,588** | **100%** |

Nearly two-thirds of merged engineering output over the last year went to keeping the existing
fleet running rather than to new product value. The consolidated platform is designed to perform
that same work **once** instead of once per repository.

### Manual maintenance by category

The 486 manual (non-Dependabot) maintenance PRs break down across the categories called out for
review as follows. Counts are keyword-classified from PR titles and are approximate, intended to
show relative magnitude rather than exact accounting.

| Toil category | Merged PRs (12 mo) | Representative examples |
| --- | ---: | --- |
| CI/CD and build pipeline changes | 155 | AzDO pipeline template deprecation, internal-feed / `feedBaseUrl` rollout, `actions/checkout` + `setup-node` bumps, esbuild/tsx build migration, reusable triage workflows |
| Release management | 118 | Per-repo "Bump version for release", CHANGELOG backfills, alpha-release republishes |
| Incident response / security remediation | 69 | `npm audit fix` sweeps, dependency-revert hotfixes, lockfile-corruption fixes |
| SDK / Azure library upgrades | 53 | `@azure/identity` 4.13.1, modular `@azure/arm-*` migrations, `@microsoft/vscode-azext-*` bumps |
| Dependency management (manual, non-Dependabot) | 49 | Coordinated `@microsoft/vscode-azext-utils` bumps, NPM `overrides` for transitive advisories |
| Compliance and policy updates | 32 | Privacy-statement link updates, license-header enforcement, mandatory-file and archival notices |
| Node / TypeScript upgrades | 10 | Node 22/24 engine bumps, TypeScript / `tsconfig` upgrades |
| **Total manual maintenance** | **486** | |

### Coordination tax: the multiplier effect

Beyond raw volume, the defining cost of the old model was that a single logical change had to be
executed many times. Over the same 12 months we identified **17 coordinated cross-cutting
maintenance initiatives** (for example: privacy-link compliance, the shared engineering-package
migration, the auth v6 rewrite, and the internal-feed migration). These 17 initiatives expanded to
roughly **122 repository-level pull requests** -- an average of **~7 repositories per initiative**
(median 6). The flagship example, the private-feed / 1ES pipeline migration, required **31 PRs
across all 14 repositories**.

| Coordination metric | Value |
| --- | ---: |
| Coordinated cross-cutting initiatives (12 mo) | 17 |
| Repository-level PRs those initiatives generated | ~122 |
| Average repositories touched per initiative | ~7.2 |
| Median repositories touched per initiative | 6 |
| Median fleet rollout duration (first to last merged PR) | ~6 days |
| Average fleet rollout duration | ~31 days |

## How This Improves Going Forward

Every metric above describes work whose cost scaled with the *number of repositories*. In the
consolidated platform, the same obligations are met once against a single delivery boundary:

- **Compliance and policy:** a privacy-link or license-header update is one edit, not one per repo.
- **Dependency management:** a single `pnpm-lock.yaml` and shared `catalog:` replaces the 26
  package lockfiles that existed across the 14-repo fleet, so a dependency bump is one change and
  Dependabot noise collapses from up to 14 PRs per advisory to one.
- **SDK and runtime upgrades:** an `@azure/*` SDK or Node/TypeScript upgrade lands in one workspace
  and is validated against every package together, instead of being published and re-consumed
  repo by repo.
- **CI/CD changes:** pipeline and feed migrations -- the single largest toil category (155 PRs) --
  target one pipeline rather than fanning out to ~7-14 repositories.
- **Release management:** the 118 per-repo release PRs are replaced by a single coordinated
  version-and-release workflow for the product.
- **Incident response:** a security fix is applied and shipped once, shortening the window in which
  any part of the product is exposed.

The consolidation does not eliminate maintenance -- it removes the multiplier. Work that the fleet
performed 7 to 14 times per initiative is now performed once, freeing engineering capacity for
product value and making the remaining toil predictable and centrally owned.

---

*Data sourced from merged pull requests across the 14-repo fleet for the window 2025-07-28 to
2026-07-27, retrieved via the GitHub API. Category counts are keyword-classified from PR titles and
are intended to convey relative magnitude. Structural claims (single lockfile, shared catalog,
workspace-based development) are verified against the `vscode-azure` repository.*
