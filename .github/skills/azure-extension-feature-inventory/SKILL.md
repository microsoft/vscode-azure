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
> 5. **TELEMETRY** — Derive each feature's telemetry EventName and emit a ready-to-run usage query + one-click link (as a **triage aid** — never run them or infer usage).
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

Read the code that the manifest can't express. Parallelize independent areas with `explore` subagents.

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

## Phase 5: Telemetry usage links (triage aid)

Give the human a one-click way to check real usage per feature so **they** can weigh Migrate vs Drop later.
Generate links; **do not** run the queries and **do not** infer or state usage.

| # | Action | Reference |
|---|--------|-----------|
| 1 | For each instrumented feature, derive `EventName` = `<extensionId>/<callbackId>` (lowercased). Mark non-instrumented surfaces (settings, menu containers, orphan strings) as "no telemetry event". | [telemetry-usage.md](references/telemetry-usage.md) |
| 2 | Build the canonical per-feature usage query (28d window; `Invocations`/`Users`/`ExternalUsers` via `IsInternal == false`/`Failures`) and one extension-wide `by EventName` roll-up query. | [telemetry-usage.md](references/telemetry-usage.md) |
| 3 | Generate the Azure Data Explorer deeplink for each query with the gzip→base64→URL-encode script (one batch pass, not one process per feature). Fall back to a raw fenced query if a link can't be produced. | [telemetry-usage.md](references/telemetry-usage.md) |

---

## Phase 6: Emit the inventory

| # | Action | Reference |
|---|--------|-----------|
| 1 | Write `INVENTORY.md` following the template's section order and tables. Include the per-feature `Telemetry` links + the top-of-file usage roll-up link. | [inventory-template.md](references/inventory-template.md) |
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
| Telemetry usage links | Per-feature ADX query + one-click deeplink, plus an extension-wide usage roll-up (a triage aid; not executed) |

---

## References

- [Source Acquisition](references/source-acquisition.md)
- [Manifest Surfaces](references/manifest-surfaces.md)
- [Code Surfaces](references/code-surfaces.md)
- [Reconciliation](references/reconciliation.md)
- [Telemetry Usage](references/telemetry-usage.md)
- [Inventory Template](references/inventory-template.md)
- [Verification Checklist](references/verification-checklist.md)
