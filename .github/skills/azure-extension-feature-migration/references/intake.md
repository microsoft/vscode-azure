# Intake

Load the inputs the migration depends on, and confirm scope before touching any code.

## 1. The source inventory (required — hard stop)

This skill is driven by an `INVENTORY.md` produced by the `azure-extension-feature-inventory` skill.

- The inventory must be **committed and tracked** at `docs/migrations/<service>/INVENTORY.md`. Confirm with
  `git ls-files docs/migrations/<service>/INVENTORY.md` — an untracked file, a session artifact, or a copy
  pasted into chat does not satisfy this. Those evaporate, and the migration is then unverifiable.
- If none exists, **run the inventory skill first and commit its output**. Do not attempt to migrate directly
  from the source extension's code — the inventory is what the migration is verified against.
- `TRIAGE.md` (Phase 2) and `MIGRATION-PLAN.md` (Phase 4) land in that same folder and are the migration PR's
  first commit, before any feature code.
- Record the source repo + **exact commit SHA** the inventory was taken from. The migration is pinned to
  that snapshot; if the source has moved on, note it.

From the inventory, extract the working set:

| Bucket | What you need from the inventory |
|--------|----------------------------------|
| Commands | id, title, source layer (A/A+B/B), `contextValue`/`when` contract, palette vs menu |
| Settings | id, type, default, enum labels, scope |
| Tree | node hierarchy, exact `contextValue` strings (incl. status + `invalid*` variants), icons, click commands |
| Wizards | ordered prompt/execute steps, basic-vs-advanced deltas, validation |
| Integrations | CLI lifecycle, task/debug providers, framework detectors, build presets, config-file scaffolding, SDK/API clients, git/GitHub/auth |
| Debuggers / tasks | `type`, `taskDefinitions`, `problemMatchers` |
| Dead / orphan | NLS keys / contributions the inventory marked DEAD — candidate `Drop` |

## 2. The target monorepo patterns (required)

Read these before mapping anything. They are the contract every migrated feature must satisfy:

- `docs/commands.md` — `ManagedCommand`, `registerManagedCommand`, `prefixArgs`, static `ContextValue`.
- `docs/tree-views.md` — data layer (`DataItemTree` / `DataProvider`) vs view layer (`ViewItemTree` / `ViewProvider`), `registerTrees.ts` dispatch order, virtual nodes, selectors.
- `docs/wizard.md` — `PromptStep` / `ExecuteStep`, back-nav, dynamic steps, reusable Azure pick steps.
- `docs/resource-creation.md` — `AzdJob` (`createNew` vs `deploy`), azd+Bicep step sequence, scenario matrix, "Adding a New Resource Type".
- `docs/dependency-injection.md` — service identifiers (`I`-prefix), container composition, factory bindings, multi-binding for providers.
- `docs/azure-clients.md` — azutils client wrappers, factory functions, re-export rules.
- `docs/conventions.md` — DI interfaces, `l10n.t`, logging, copyright header, ARM type comparison, context-value regex.

## 3. Confirm the target + a precedent

- **Target package:** `extensions/vscode-azure` (feature code) plus `packages/azutils` (Azure SDK client wrappers). New tree views are almost never needed — reuse the existing Resources / Workspace / Activity views.
- **Precedent product:** pick the already-migrated product whose shape most resembles the source and mirror its file layout. See [target-patterns.md](target-patterns.md) for the map of what each precedent demonstrates:
  - `acr` — resource tree with virtual child categories + resource-scoped commands.
  - `functions` — full create wizard via azd+Bicep + workspace-view detection + the settings-adapter precedent (the settings framework itself is shared; the product supplies only the adapter).
  - `deploy` — azd deploy job wiring + deployment tracking in the Activity view.
  - `auth` — account/tenant/subscription and sign-in flows.

## 4. Scope check (ask the human)

Before triage, confirm with the user:
- Which source extension + inventory snapshot.
- Which monorepo migration **phase** this targets (see `docs/monorepo-migration.md`) — affects whether a
  feature is `Migrate` now or `Defer`:
  - **Phase 0 (internal):** MVP of the unified "Azure" extension on the internal marketplace.
  - **Phase 1 (beta):** standalone "Azure" extension; disables itself if Azure Resources is installed.
  - **Phase 2 (opt-in):** Azure Resources yields to "Azure"; users choose. Target: after feature-complete.
  - **Phase 3 (GA):** Azure Resources becomes an extension-pack stub; per-service extensions deprecated.
  - **Phase 4 (cleanup):** Azure Resources deprecated.
  A pre-GA target means feature-parity gaps are acceptable and non-core features can be `Defer`; a GA/parity
  target raises the bar for what must be `Migrate` now.
- Whether any features are explicitly out of scope up front.
