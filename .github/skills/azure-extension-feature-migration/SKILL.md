---
name: azure-extension-feature-migration
description: >-
  Migrate the FEATURES of a source Azure VS Code extension (e.g.
  vscode-azurestaticwebapps, vscode-azurevirtualmachines, vscode-azuredatabases)
  into the vscode-azure monorepo, re-implemented with the monorepo's own design
  patterns and standards. This is a FEATURE migration, not a code port: features
  are triaged with a human, mapped onto monorepo patterns (DI, ManagedCommand,
  DataProvider/ViewProvider trees, azd+Bicep creation wizards, azutils clients),
  and rebuilt from scratch. Use when: migrate an extension into the monorepo,
  port a product's features, plan a feature migration, or turn an INVENTORY.md
  into a migration plan and implementation.
---

# Azure Extension Feature Migration

> **AUTHORITATIVE GUIDANCE**
>
> This skill migrates the **features** of a source Azure VS Code extension into the `vscode-azure`
> monorepo by **re-implementing them from scratch** using the monorepo's patterns. It is driven by a
> feature `INVENTORY.md` (produced by the `azure-extension-feature-inventory` skill) and gated by a
> **mandatory human triage** of what should and should not be migrated.

---

## Triggers

Activate this skill when the user wants to:
- Migrate a source Azure VS Code extension's features into the `vscode-azure` monorepo.
- Port a product (its commands, tree views, wizards, settings, debuggers) into the new extension.
- Turn a feature `INVENTORY.md` into a migration plan and/or implementation.
- Plan which features of an extension should and should not be migrated.

---

## Core principle: migrate features, not code

The single most important rule. **You are not porting source code.** Copying the source extension's
classes into the monorepo is wrong and will be rejected. Instead:

| Do | Don't |
|----|-------|
| Take each *feature* from the inventory and re-implement it with the monorepo's patterns | Copy `AzExtTreeItem` subclasses, `registerCommand` callbacks, or ARM-deploy code |
| Delegate deployment/provisioning to **azd + Bicep** (`AzdJob`, `GenerateBicepStep`, `AzdProvisionStep`) | Re-create hand-written ARM deployment wizards from the source |
| Search **Azure Verified Modules (AVM)** first: use a resource module only for a single-resource topology, and require a pattern module when supporting resources are needed | Author bespoke Bicep before checking AVM, or compose resource modules when the feature requires a pattern |
| When AVM has no suitable module, generate one AVM-shaped local module plus a thin consumer | Inline a fallback module into one monolithic template |
| Rebuild the tree as `DataProvider` + `ViewProvider`; resource providers use `ProductRegistrar`, workspace/activity use `registerTrees.ts` | Re-create per-node tree-item classes that fetch their own children |
| Write commands as `@injectable()` `ManagedCommand` classes with a static `ContextValue` | Register bare `vscode.commands.registerCommand` callbacks |
| Reuse shared monorepo packages (azutils clients, generic commands, shared settings framework) and product precedents (Functions `SettingsAdapter`) | Re-vendor the source's client/settings code, or hand-roll a helper the monorepo already has |
| Leave scaffolding/build/debug setup to its verified upstream owner, and project/deployment configuration to the owning tool | Duplicate upstream orchestration, author/parse azd's files outside the shared step, or call into the extension being retired |
| Conform **all** new code to `docs/conventions.md` (DI interfaces, `l10n.t`, logging, headers) | Carry over the source's style, `vscode` imports, or string handling |

**Features rarely map 1:1.** The target UX is different by design — most notably, deployment is delegated
to **azd + Bicep**, and the tree is built from **provider registries**, not per-node item classes. See
[does-not-map.md](references/does-not-map.md) for the catalog of features that must be *adapted* rather
than ported, and [pattern-mapping.md](references/pattern-mapping.md) for the source-feature -> monorepo-pattern playbook.

---

## Prerequisite: a committed inventory (hard stop)

This skill **consumes** an `INVENTORY.md`. It does not start without one that is **committed and tracked** at
`docs/migrations/<service>/INVENTORY.md`. A copy that exists only in session scratch, in chat, or in a
reviewer's memory does not count — it evaporates, and the migration then has no checklist to be verified
against. If there is no tracked inventory, run the `azure-extension-feature-inventory` skill first and commit
its output, then come back.

All three process artifacts live in that same tracked folder and are part of the migration's deliverable:

| Artifact | Produced by | Must be committed |
|----------|-------------|-------------------|
| `docs/migrations/<service>/INVENTORY.md` | inventory skill | before Phase 1 can start |
| `docs/migrations/<service>/TRIAGE.md` | Phase 2 | after explicit human sign-off, **before any feature code** |
| `docs/migrations/<service>/MIGRATION-PLAN.md` | Phase 4 | after mapping, **before any feature code** |

The chronology is **committed inventory before triage; committed signed triage and plan before feature
code**. The artifacts may be separate commits or already exist on the base branch; no particular first-commit
layout is required. All remain tracked deliverables. Scope or behavioral adaptations beyond sign-off require
explicit human approval and an updated decision record before implementation.

---

## Overview

> 1. **INTAKE** — Load the source `INVENTORY.md` and the monorepo's pattern docs; confirm the target package + a precedent product.
> 2. **TRIAGE (human gate)** — With a human, assign every feature a disposition: Migrate / Adapt / Reuse / Drop / Defer. **Hard stop until signed off**; record decisions in `TRIAGE.md` and commit before feature code.
> 3. **MAP** — Verify upstream ownership/capabilities before choosing patterns; record retained behavioral contracts and incremental UX value, plus AVM decisions for provisioning.
> 4. **SEQUENCE** — Identify shared foundations and dependencies, propose independently reviewable PRs where warranted, then commit `MIGRATION-PLAN.md` with tasks keyed to `TRIAGE.md` before feature code.
> 5. **IMPLEMENT** — Reuse shared primitives and verify behavioral contracts and conventions per slice; lint/build/test the relevant scope; re-sweep after every rebase from `main`.
> 6. **VERIFY** — Account for every ID separately from satisfying every retained contract; commit `PARITY-REPORT.md` with coverage, evidence levels, unresolved decisions, and live gaps.

---

## Phase 1: Intake

| # | Action | Reference |
|---|--------|-----------|
| 1 | Confirm a **committed, tracked** `docs/migrations/<service>/INVENTORY.md` exists (`git ls-files` it — an untracked or session-only file is a hard stop). If missing, run the inventory skill and commit its output first. Record the source repo + commit SHA it was taken from. | [intake.md](references/intake.md) |
| 2 | Identify the target extension package (`extensions/vscode-azure`) and read the pattern docs (`docs/{commands,tree-views,wizard,resource-creation,dependency-injection,conventions,azure-clients}.md`). | [intake.md](references/intake.md) |
| 3 | Pick a **precedent product** already migrated (`acr`, `functions`, `deploy`, `auth`, `tools`) whose shape most resembles the source; you will mirror its layout. | [target-patterns.md](references/target-patterns.md) |

---

## Phase 2: Triage — the human decision gate

> **This phase is mandatory and human-driven. A human decides what is and is not migrated. Do not
> auto-decide, and do not proceed to Phase 3 without explicit sign-off.**

| # | Action | Reference |
|---|--------|-----------|
| 1 | Build a triage table: one row per inventory feature, each with a **stable ID** (`<PRODUCT>-NNN`), a **recommended** disposition + one-line rationale (you recommend; the human decides). | [triage.md](references/triage.md) |
| 2 | Pre-flag features that **do not map 1:1** (deployment -> azd+Bicep, custom trees -> providers, vendored clients -> azutils/shared packages, dead/orphan -> Drop) and features that cross an **ownership boundary** (azd's `azure.yaml` and scaffolding, anything that calls into the extension being retired). | [does-not-map.md](references/does-not-map.md) |
| 3 | If triage needs fresh or deeper usage data, **confirm the user is on the corporate VPN before attempting a query**. Then use the Azure MCP server's `kusto` tool with the `kusto_query` command when available. Pass `cluster-uri`, `database`, `query`, and the corporate `tenant`. If Azure MCP or that command is unavailable, fall back to the inventory skill's existing direct ADX REST approach; if telemetry is unreachable, emit the matching ADX deeplink. | [triage.md](references/triage.md) |
| 4 | Present the table using the scale guidance in the triage reference: an in-chat Markdown table is acceptable below roughly 40 rows; larger tables use a generated Excel review workbook where blank decisions accept the recommendation and filled cells record overrides. Capture decisions + rationale verbatim, report the accepted-vs-overridden split, then iterate until the human explicitly signs off. | [triage.md](references/triage.md) |
| 5 | On sign-off, write the decisions to **`TRIAGE.md`** beside `INVENTORY.md` and commit before feature code. It may be committed with the plan once mapped. This artifact is the source of truth for Phases 3-6; scope/behavior changes require an updated record and explicit human approval. | [triage.md](references/triage.md) |

> Dispositions: **Migrate** (rebuild as-is in new patterns) · **Adapt** (rebuild with changed UX/behavior, e.g. azd) · **Reuse** (satisfied by an existing shared package) · **Drop** (dead/out-of-scope) · **Defer** (later phase).

---

## Phase 3: Map features to patterns

> Operate only on `TRIAGE.md` rows dispositioned **Migrate / Adapt / Reuse**. Read dispositions from
> `TRIAGE.md`; do not re-decide them here.

| # | Action | Reference |
|---|--------|-----------|
| 1 | Before design, verify the supported upstream version's capabilities and record ownership across VS Code, language extension, product CLI/Core Tools, azd, and this extension as relevant. For every retained feature, record its behavioral contract, UX value, pattern, target paths, and Reuse wiring/conditions. Seek human approval for adaptations outside signed triage. | [pattern-mapping.md](references/pattern-mapping.md) |
| 2 | Define the tree contract: for each node type, its `DataProvider`/`ViewProvider`, the command's static `ContextValue`, and the `package.json` regex `when` clause. | [pattern-mapping.md](references/pattern-mapping.md), [target-patterns.md](references/target-patterns.md) |
| 3 | For creation/deploy features, define the wizard as azd `PromptStep`/`ExecuteStep` + `AzdJob`, then apply the AVM-first decision process. Record the selected versioned AVM resource/pattern module, or the two-file local-module fallback in a bundled template directory. | [avm-provisioning.md](references/avm-provisioning.md), [pattern-mapping.md](references/pattern-mapping.md) |

---

## Phase 4: Sequence the work

| # | Action | Reference |
|---|--------|-----------|
| 1 | Identify independently reviewable shared foundations and dependency order early; propose separate PRs where appropriate without automatically creating them. Keep product orchestration local without concrete reuse or framework ownership. | [sequencing.md](references/sequencing.md) |
| 2 | Emit `MIGRATION-PLAN.md`: ordered, checkbox tasks grouped by slice, each tagged with its **`TRIAGE.md` ID** and linked to a target pattern. | [sequencing.md](references/sequencing.md) |
| 3 | Commit `MIGRATION-PLAN.md` beside the signed `TRIAGE.md` in `docs/migrations/<service>/`, both before feature code. | [sequencing.md](references/sequencing.md) |
| 4 | Agree the **drift protocol** for this branch: migrations are long-lived, so every rebase/merge from `main` re-runs the shared-primitive sweep over already-landed slices. | [sequencing.md](references/sequencing.md) |

---

## Phase 5: Implement, slice by slice

| # | Action | Reference |
|---|--------|-----------|
| 1 | **Shared-primitive sweep (before writing anything).** Search `packages/utils/src`, `packages/azutils/src`, `extensions/vscode-azure/src`, and both testing barrels for the concept behind every helper, utility, service, wizard step, or fixture the slice needs. Record "reused `<symbol>`" or "searched `<terms>`, none exists" in the mapping record. | [implementation.md](references/implementation.md) |
| 2 | Implement one slice at a time, copying the **shape** (not the code) of the precedent product. Review the slice's behavioral contract and apply existing localization, fixture, layering, and test-value rules before marking it complete. | [implementation.md](references/implementation.md), [verification.md](references/verification.md) |
| 3 | Wire DI, register providers/commands, contribute to `package.json` + `package.nls.json`, localize strings, add the copyright header. Justify every new `activationEvents` entry against the **activation budget**. | [implementation.md](references/implementation.md), [target-patterns.md](references/target-patterns.md) |
| 4 | Verify every **external fact** written as authority (CLI minimum versions, file/schema names, URLs, package names, existing assets) against a real source, and record the source. | [implementation.md](references/implementation.md) |
| 5 | Lint + build + test the smallest scope that covers the slice before moving on. Product docs go to `docs/products/<product>.md`, never into the framework docs. | [implementation.md](references/implementation.md) |
| 6 | After every rebase/merge from `main`, re-run the sweep over already-landed slices per the drift protocol. | [sequencing.md](references/sequencing.md) |

---

## Phase 6: Verify

Run the checklist in [verification.md](references/verification.md). First confirm the three process artifacts
are present and tracked, then trace **every `TRIAGE.md` ID** to an
outcome: retained features to satisfied behavioral contracts (including actual Reuse wiring), Drop rows to
confirmed non-migration, and Defer rows to a tracked plan item. ID coverage alone is not behavioral parity.
Commit `docs/migrations/<service>/PARITY-REPORT.md`, distinguishing inspection, automated behavioral evidence,
and live verification. Report conditional reuse, pending adaptation approvals, and unverified scenarios
honestly; generate the remaining manual checklist without losing checked progress.

---

## Outputs

| Artifact | Contents |
|----------|----------|
| `docs/migrations/<service>/TRIAGE.md` (committed) | The signed-off decision record: every inventory feature with a stable ID, final disposition, rationale, and sign-off header. Read-only source of truth for Phases 3-6. |
| `docs/migrations/<service>/MIGRATION-PLAN.md` (committed) | Dependency-ordered, checkboxed implementation plan; each task tagged with its `TRIAGE.md` ID and a target pattern; carries the drift-protocol log. |
| Migrated code | New feature code in `extensions/vscode-azure` (+ `packages/azutils`), conforming to monorepo patterns |
| Product doc | `docs/products/<product>.md` — the one place product-specific documentation lives |
| `docs/migrations/<service>/PARITY-REPORT.md` (committed) | ID accounting and retained-contract satisfaction reported separately; code/automated/live evidence, conditional reuse, unresolved adaptations, gaps/deferrals, and remaining manual checklist |

---

## References

- [Intake](references/intake.md)
- [Triage (human gate)](references/triage.md)
- [Features That Don't Map 1:1](references/does-not-map.md)
- [AVM-First Bicep Provisioning](references/avm-provisioning.md)
- [Pattern Mapping Playbook](references/pattern-mapping.md)
- [Target Patterns Cheat-Sheet](references/target-patterns.md)
- [Sequencing & Plan](references/sequencing.md)
- [Implementation Loop](references/implementation.md)
- [Verification](references/verification.md)
