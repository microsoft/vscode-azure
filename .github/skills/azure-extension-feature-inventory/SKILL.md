---
name: azure-extension-feature-inventory
description: >-
  Produce a complete, migration-ready FEATURE inventory of a source Azure VS Code
  extension (e.g. vscode-azurestaticwebapps, vscode-azurevirtualmachines,
  vscode-azuredatabases). Reconciles the extension manifest, the NLS string table,
  the extension source code, and the published docs into a single normalized
  INVENTORY.md. Use when: inventory an extension's features, catalog commands /
  settings / tree views / debuggers, audit contribution points, or prepare a
  feature migration into the vscode-azure monorepo.
---

# Azure Extension Feature Inventory

> **AUTHORITATIVE GUIDANCE**
>
> This skill catalogs **every user-facing and behavioral feature** of a source Azure VS Code
> extension so it can later be *feature-migrated* (not code-migrated) into the `vscode-azure`
> monorepo. The output is a normalized `INVENTORY.md`, not a code dump.

---

## Triggers

Activate this skill when the user wants to:
- Inventory / catalog the features of an Azure VS Code extension (any `ms-azuretools.vscode-azure*`).
- Enumerate an extension's contribution points (commands, settings, menus, views, debuggers, tasks).
- Audit what an extension does before migrating it into the monorepo.

---

## Core principle: no single source is complete

The single most important rule. A correct inventory is the **reconciliation of four sources**, because
each one is individually incomplete and they *disagree*:

| Source | Gives you | Misses / lies about |
|--------|-----------|---------------------|
| `package.json` `contributes` | Declarative surfaces (commands, settings, menus, views, debuggers, tasks, activation) | All behavior; code-registered commands; providers |
| `package.nls.json` | User-facing strings; enum labels | Contains **orphan/dead strings** for removed features |
| Source code (`activate()`, `registerCommands.ts`, `src/`) | The authoritative behavior + code-only features + exported API | Nothing — but it's large; needs structured traversal |
| Published docs | UX naming, intent, screenshots | **Not exhaustive**; often stale or 404. Reference only. |

Treat **code as authoritative for behavior** and use the manifest/NLS/docs to cross-check. See
[reconciliation.md](references/reconciliation.md) for the exact cross-referencing and orphan-detection procedure.

---

## Overview

> 1. **ACQUIRE** — Locate/clone the source extension at a known ref; confirm scope.
> 2. **MANIFEST** — Enumerate every `package.json` contribution point + NLS strings.
> 3. **CODE** — Traverse the source for code-only/behavioral features (providers, wizards, tree, CLI, debug, API, telemetry).
> 4. **RECONCILE** — Cross-reference the layers; flag code-only features and orphan strings.
> 5. **TELEMETRY** — Run one generic query to collect real per-feature usage for the whole extension, attach it to each feature, and offer an **advisory** Migrate/Drop suggestion (numbers + window + confidence; verdict stays with the human). Fall back to emitting links only when telemetry is unreachable.
> 6. **EMIT** — Write a normalized, migration-ready `INVENTORY.md`.
> 7. **VERIFY** — Self-check the inventory for completeness against the checklist.

---

## Phase 1: Acquire the source

| # | Action | Reference |
|---|--------|-----------|
| 1 | Determine the source extension + repo. Ask the user if ambiguous. | [source-acquisition.md](references/source-acquisition.md) |
| 2 | Clone it to a temp dir (outside the monorepo) at a pinned ref, or locate an existing checkout. Record the exact commit SHA. | [source-acquisition.md](references/source-acquisition.md) |
| 3 | List `src/**` files to build a mental map of the code surfaces. | [source-acquisition.md](references/source-acquisition.md) |

---

## Phase 2: Manifest + NLS surfaces (declarative)

Enumerate **every** contribution point in `package.json` and cross-reference `package.nls.json`.
Do not summarize — list each item with its exact id/key.

| # | Action | Reference |
|---|--------|-----------|
| 1 | Extract extension-level shape: activationEvents, extensionDependencies, capabilities, `x-azResources`. | [manifest-surfaces.md](references/manifest-surfaces.md) |
| 2 | Enumerate `contributes`: commands, configuration, menus, submenus, views, viewsContainers, debuggers, taskDefinitions, problemMatchers, jsonValidation, keybindings, languages, walkthroughs. | [manifest-surfaces.md](references/manifest-surfaces.md) |
| 3 | Load `package.nls.json`; resolve `%...%` titles; note every NLS key **not** referenced by the manifest (candidate orphans — confirm in Phase 4). | [manifest-surfaces.md](references/manifest-surfaces.md) |

---

## Phase 3: Code surfaces (behavioral)

Read the code that the manifest can't express. Parallelize the independent areas below into separate
investigations (e.g. with `explore` subagents) so each gets its own context.

| # | Action | Reference |
|---|--------|-----------|
| 1 | Read `activate()` / `extension.ts`: every `register*` call, provider, resolver, and the **exported extension API** return value. | [code-surfaces.md](references/code-surfaces.md) |
| 2 | Read `registerCommands.ts` (or equivalent): find commands registered **only** in code (not in `package.json`). | [code-surfaces.md](references/code-surfaces.md) |
| 3 | Inventory the **tree view**: full node hierarchy, exact `contextValue` strings (incl. status variants + `invalid*`), icons, click commands, pagination, refresh/polling. | [code-surfaces.md](references/code-surfaces.md) |
| 4 | Inventory **wizards**: ordered Prompt/Execute steps, defaults, validation, basic-vs-advanced deltas, telemetry. | [code-surfaces.md](references/code-surfaces.md) |
| 5 | Inventory **integrations**: CLI lifecycle, task providers, debug providers, framework detectors, build presets, config-file scaffolding/parsing, external SDK/API clients, git/GitHub/auth. | [code-surfaces.md](references/code-surfaces.md) |
| 6 | Capture each instrumented callback's **telemetry callback id** (the first arg to `callWithTelemetryAndErrorHandling` / `registerCommand*`) — for commands it's the command id, but task providers/resolvers/wizards may use other ids. Needed for the telemetry EventName in Phase 5. | [telemetry-usage.md](references/telemetry-usage.md) |

---

## Phase 4: Reconcile

| # | Action | Reference |
|---|--------|-----------|
| 1 | Diff manifest commands ⇄ code-registered commands. Mark each feature's **source layer**: `A` (declarative), `B` (code), or `A+B`. | [reconciliation.md](references/reconciliation.md) |
| 2 | Confirm orphan NLS keys have no code reference and no contribution → mark **DEAD (do not migrate)**. | [reconciliation.md](references/reconciliation.md) |
| 3 | Capture the command⇄node contract: for each menu `when` clause, the exact `contextValue` regex and `enablement`/`commandPalette` gating. | [reconciliation.md](references/reconciliation.md) |
| 4 | Fetch published docs only to enrich intent/naming; explicitly note gaps and mark docs layer `C` (supplementary). | [reconciliation.md](references/reconciliation.md) |

---

## Phase 5: Telemetry usage (collect + analyze)

Collect **real** per-feature usage in a single query and attach it to the inventory so the human has data —
not guesses — when weighing Migrate vs Drop later. Produce an **advisory** suggestion per feature (numbers +
window + confidence). The final verdict stays with the human and the migration skill's triage gate.

| # | Action | Reference |
|---|--------|-----------|
| 1 | For each instrumented feature, derive `EventName` = `<extensionId>/<callbackId>` (lowercased). Mark non-instrumented surfaces (settings, menu containers, orphan strings) as "no telemetry event". | [telemetry-usage.md](references/telemetry-usage.md) |
| 2 | Authenticate to the `ddtelvscode` cluster with a **corp-tenant** token (`--tenant 72f988bf-...`; a default-tenant token 401s), then run the **one generic query** (`by EventName`, external users + Succeeded/Failed/Canceled + LastSeen) once for the whole extension. | [telemetry-usage.md](references/telemetry-usage.md) |
| 3 | Map each result row back to its feature. Reconcile misses (renamed/suppressed != unused); flag framework-only rows. Attach the numbers to each feature. | [telemetry-usage.md](references/telemetry-usage.md) |
| 4 | Produce an advisory suggestion per feature using the numbers + guardrails (suppression, Canceled != Failed, internal-only, small-N). Never present a bare verdict; always show window + counts. | [telemetry-usage.md](references/telemetry-usage.md) |
| 5 | If telemetry is unreachable (no `az` / no corp access), **fall back** to emitting the per-feature + roll-up ADX deeplinks so the human can run them. Also keep the roll-up deeplink for handoff either way. | [telemetry-usage.md](references/telemetry-usage.md) |
| 6 | Support the user's **targeted questions** (e.g. "usage in the last 7d", "failure rate", "by version/platform") by scoping the query, running it, and reporting the numbers — or emitting a matching link. | [telemetry-usage.md](references/telemetry-usage.md) |

---

## Phase 6: Emit the inventory

| # | Action | Reference |
|---|--------|-----------|
| 1 | Write `INVENTORY.md` following the template's section order and tables. Include the per-feature usage numbers + advisory suggestion and the top-of-file usage summary (real data + roll-up link, or links-only if telemetry was unreachable). | [inventory-template.md](references/inventory-template.md) |
| 2 | Save it where the user asked (default: alongside the migration workspace, or a session artifact). Print the path. | [inventory-template.md](references/inventory-template.md) |

---

## Phase 7: Verify completeness

Run the self-check in [verification-checklist.md](references/verification-checklist.md). Every command,
setting, menu, view node, debugger, task, and code-only feature must appear exactly once, with a source
layer and (where relevant) its exact `contextValue`/`when` clause. Report any gaps instead of hiding them.

---

## Outputs

| Artifact | Contents |
|----------|----------|
| `INVENTORY.md` | Normalized, migration-ready feature catalog (see template) |
| Source ref record | Repo + exact commit SHA the inventory was taken from |
| Orphan/dead list | NLS keys / contributions with no backing behavior |
| Telemetry usage | Per-feature real usage (external users, Succeeded/Failed/Canceled, last-seen) from one generic query, each with an advisory Migrate/Drop suggestion; an extension-wide usage summary + roll-up deeplink. Falls back to links-only when telemetry is unreachable. Verdict left to the human. |

---

## References

- [Source Acquisition](references/source-acquisition.md)
- [Manifest Surfaces](references/manifest-surfaces.md)
- [Code Surfaces](references/code-surfaces.md)
- [Reconciliation](references/reconciliation.md)
- [Telemetry Usage](references/telemetry-usage.md)
- [Inventory Template](references/inventory-template.md)
- [Verification Checklist](references/verification-checklist.md)
