# Reconciliation

Merge the manifest (`A`), code (`B`), NLS, and docs (`C`) into one truth. This is where inventories that
only read `package.json` — or only read the docs — go wrong.

## 1. Assign a source layer to every feature

For each feature, set:
- `A` — declared in `package.json` only (rare for anything with behavior; usually pure schema/validation).
- `B` — exists only in code (no manifest entry).
- `A+B` — declared in the manifest **and** backed by a code handler (most commands).

Procedure: take the manifest `commands` list and the `registerCommands.ts` id list and diff them.
- id in both → `A+B`.
- id in manifest, no handler → **broken/placeholder**, flag it.
- id in code, not in manifest → `B` code-only feature (e.g. a tree click command or help command).

## 2. Confirm orphan / dead strings

For each NLS key not referenced by the manifest (from Phase 2), grep the source for the key and for the
command id it implies:

```powershell
Select-String -Path "$src\src\**\*.ts" -Pattern '<key-or-id>'
```

- No manifest use **and** no code reference → **DEAD. Flag it; do not migrate.**
  (In the SWA dogfood, `revealResource` and `deleteConfirmation*` were dead NLS leftovers.)
- Referenced only via `localize('<key>', ...)` in code → it's a live **`B`** string, keep it.

## 3. Capture the command → node contract

For every `view/item/context` menu entry, record the exact `when` clause and pair it with the tree node
`contextValue`(s) it targets. Note:
- Status-variant targeting (a command that only appears on `...Completed` or `...InProgress`).
- `enablement` gates on the command (`!isWeb`, `!virtualWorkspace`).
- `commandPalette` `when: never` → command is context-menu/programmatic only (don't list it as a palette
  feature).
- `group` ordering and `inline` group (inline action icons).

This mapping is the highest-value output for migration: it tells the migrator which node each command
acts on and under what conditions.

## 4. Docs layer (`C`) — supplementary only

Fetch the published docs (start at `https://code.visualstudio.com/docs/azure/overview` and follow to the
service page) **only** to enrich intent, naming, and workflows. Rules:
- Docs are **not** an inventory source of record. They omit context-menu commands, internal settings, and
  most tree behavior, and pages may be missing (e.g. a service subpage returning 404).
- Never let docs *remove* a feature you found in code/manifest. Use them only to add description/intent
  and to sanity-check user-facing names.
- Mark any doc-only concept `C` and clearly note it is unverified against code.

## Result

A single deduplicated feature set where each entry has: category, id/name, resolved title, **source
layer**, exact `contextValue`/`when` (where applicable), behavior summary, dependencies, and a
migration-notes slot. Feed this into the template.
