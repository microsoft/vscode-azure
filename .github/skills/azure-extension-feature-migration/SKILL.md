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
| Rebuild the tree as `DataProvider` + `ViewProvider` registered in `registerTrees.ts` | Re-create per-node tree-item classes that fetch their own children |
| Write commands as `@injectable()` `ManagedCommand` classes with a static `ContextValue` | Register bare `vscode.commands.registerCommand` callbacks |
| Reuse shared monorepo packages (azutils clients, generic commands) and product precedents (Functions app-settings) | Re-vendor the source's client / app-settings code |
| Conform **all** new code to `docs/conventions.md` (DI interfaces, `l10n.t`, logging, headers) | Carry over the source's style, `vscode` imports, or string handling |

**Features rarely map 1:1.** The target UX is different by design — most notably, deployment is delegated
to **azd + Bicep**, and the tree is built from **provider registries**, not per-node item classes. See
[does-not-map.md](references/does-not-map.md) for the catalog of features that must be *adapted* rather
than ported, and [pattern-mapping.md](references/pattern-mapping.md) for the source-feature -> monorepo-pattern playbook.

---

## Prerequisite: a reviewed inventory

This skill **consumes** an `INVENTORY.md`. If one does not exist for the source extension, run the
`azure-extension-feature-inventory` skill first. The inventory is the checklist the migration is
verified against — every feature must end up with an explicit disposition.

---

## Overview

> 1. **INTAKE** — Load the source `INVENTORY.md` and the monorepo's pattern docs; confirm the target package + a precedent product.
> 2. **TRIAGE (human gate)** — With a human, assign every feature a disposition: Migrate / Adapt / Reuse / Drop / Defer. **Hard stop until signed off**, then commit the decisions as `TRIAGE.md`.
> 3. **MAP** — Map each *kept* feature (read from `TRIAGE.md`) onto a concrete monorepo pattern + target file location; for provisioning, record the AVM search and module decision.
> 4. **SEQUENCE** — Order the work by dependency (constants -> clients -> data providers -> view providers -> registerTrees -> commands -> wizards -> package.json -> tests). Emit `MIGRATION-PLAN.md`, each task tagged with its `TRIAGE.md` ID.
> 5. **IMPLEMENT** — Build feature-by-feature against a precedent product, conforming to standards; lint/build/test each slice.
> 6. **VERIFY** — Parity check against `TRIAGE.md` (every ID accounted for) + conformance check against conventions; report gaps honestly.

---

## Phase 1: Intake

| # | Action | Reference |
|---|--------|-----------|
| 1 | Locate the source `INVENTORY.md`. If missing, run the inventory skill first. Record the source repo + commit SHA it was taken from. | [intake.md](references/intake.md) |
| 2 | Identify the target extension package (`extensions/vscode-azure`) and read the pattern docs (`docs/{commands,tree-views,wizard,resource-creation,dependency-injection,conventions,azure-clients}.md`). | [intake.md](references/intake.md) |
| 3 | Pick a **precedent product** already migrated (`acr`, `functions`, `deploy`, `auth`, `tools`) whose shape most resembles the source; you will mirror its layout. | [target-patterns.md](references/target-patterns.md) |

---

## Phase 2: Triage — the human decision gate

> **This phase is mandatory and human-driven. A human decides what is and is not migrated. Do not
> auto-decide, and do not proceed to Phase 3 without explicit sign-off.**

| # | Action | Reference |
|---|--------|-----------|
| 1 | Build a triage table: one row per inventory feature, each with a **stable ID** (`<PRODUCT>-NNN`), a **recommended** disposition + one-line rationale (you recommend; the human decides). | [triage.md](references/triage.md) |
| 2 | Pre-flag features that **do not map 1:1** (deployment -> azd+Bicep, custom trees -> providers, vendored clients -> azutils/shared packages, dead/orphan -> Drop). | [does-not-map.md](references/does-not-map.md) |
| 3 | Present the table to the human. Capture their decisions + rationale verbatim. Iterate until they explicitly sign off. | [triage.md](references/triage.md) |
| 4 | On sign-off, write the decisions to **`TRIAGE.md`** in the tracked `docs/migrations/<service>/` folder (beside `INVENTORY.md`) and **commit it on its own** (separate from feature code). This committed artifact is the read-only source of truth for Phases 3-6 — dispositions are never changed in-flight, only by editing `TRIAGE.md` and re-confirming. | [triage.md](references/triage.md) |

> Dispositions: **Migrate** (rebuild as-is in new patterns) · **Adapt** (rebuild with changed UX/behavior, e.g. azd) · **Reuse** (satisfied by an existing shared package) · **Drop** (dead/out-of-scope) · **Defer** (later phase).

---

## Phase 3: Map features to patterns

> Operate only on `TRIAGE.md` rows dispositioned **Migrate / Adapt / Reuse**. Read dispositions from
> `TRIAGE.md`; do not re-decide them here.

| # | Action | Reference |
|---|--------|-----------|
| 1 | For each Migrate/Adapt feature, choose the monorepo pattern and the exact target file path. For each **Reuse** feature, record the existing symbol/command to wire and where it gets wired (so Phase 6 has evidence to verify). | [pattern-mapping.md](references/pattern-mapping.md) |
| 2 | Define the tree contract: for each node type, its `DataProvider`/`ViewProvider`, the command's static `ContextValue`, and the `package.json` regex `when` clause. | [pattern-mapping.md](references/pattern-mapping.md), [target-patterns.md](references/target-patterns.md) |
| 3 | For creation/deploy features, define the wizard as azd `PromptStep`/`ExecuteStep` + `AzdJob`, then apply the AVM-first decision process. Record the selected versioned AVM resource/pattern module, or the two-file local-module fallback and required generator changes. | [avm-provisioning.md](references/avm-provisioning.md), [pattern-mapping.md](references/pattern-mapping.md) |

---

## Phase 4: Sequence the work

| # | Action | Reference |
|---|--------|-----------|
| 1 | Order features by dependency so each slice compiles on top of the last. | [sequencing.md](references/sequencing.md) |
| 2 | Emit `MIGRATION-PLAN.md`: ordered, checkbox tasks grouped by slice, each tagged with its **`TRIAGE.md` ID** and linked to a target pattern. | [sequencing.md](references/sequencing.md) |

---

## Phase 5: Implement, slice by slice

| # | Action | Reference |
|---|--------|-----------|
| 1 | Implement one slice at a time, copying the **shape** (not the code) of the precedent product. Conform to `docs/conventions.md` on every file. | [implementation.md](references/implementation.md) |
| 2 | Wire DI, register providers/commands, contribute to `package.json` + `package.nls.json`, localize strings, add the copyright header. | [implementation.md](references/implementation.md), [target-patterns.md](references/target-patterns.md) |
| 3 | Lint + build + test the smallest scope that covers the slice before moving on. | [implementation.md](references/implementation.md) |

---

## Phase 6: Verify

Run the checklist in [verification.md](references/verification.md). Trace **every `TRIAGE.md` ID** to an
outcome: kept features (Migrate/Adapt/Reuse) to landed code, Drop rows to a confirmed absence, Defer rows to
a tracked item in `MIGRATION-PLAN.md`. Any inventory feature missing from `TRIAGE.md`, or any kept row with
no landed code, is a gap. New code must pass lint/build/test and conform to conventions. Report gaps instead
of hiding them.

---

## Outputs

| Artifact | Contents |
|----------|----------|
| `TRIAGE.md` (committed) | The signed-off decision record: every inventory feature with a stable ID, final disposition, rationale, and sign-off header. Read-only source of truth for Phases 3-6. |
| `MIGRATION-PLAN.md` | Dependency-ordered, checkboxed implementation plan; each task tagged with its `TRIAGE.md` ID and a target pattern. |
| Migrated code | New feature code in `extensions/vscode-azure` (+ `packages/azutils`), conforming to monorepo patterns |
| Parity report | `TRIAGE.md` ID -> disposition/landed-code coverage, with any gaps called out |

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
