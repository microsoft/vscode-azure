# Sequencing & Plan

Order the mapped features so each slice compiles on top of the last, then emit `MIGRATION-PLAN.md`.

## Dependency order

Build bottom-up. A feature can't be wired before the things it depends on exist:

```
1. Constants & types      constants, ARM type + logicalType constants, resource type + guards
2. Client wrappers        packages/azutils/src/rest/clients/<Product>Client.ts (+ re-export + factory)
3. Data providers         <Product>DataProvider (getChildren + virtual nodes + enrich)
4. View providers         <Product>ViewProvider (getTreeItem, icons, contextValue)
5. Tree registration      registerTrees.ts (specific before generic)
6. Commands               ManagedCommand classes + static ContextValue + registerCommands.ts
7. Wizards                azd prompt/execute steps + Bicep template + register per AzdJob
8. Manifest               package.json contributions + package.nls.json strings + icons
9. Reuse wiring           app-settings / auth / generic commands hooked up in extension.ts
10. Tests                 unit (+ integration where the precedent has them)
```

Rationale: commands reference `ContextValue`s that view providers render; view providers read data
providers; data providers use client wrappers; everything resolves through DI set up in `extension.ts`.
The manifest `when` clauses must match the assembled `contextValue`s, so contribute the manifest after the
view layer exists.

## Slice the work vertically where you can

Prefer a **thin vertical slice per resource type** over doing all data providers, then all view providers,
then all commands. One shippable slice = "the resource node shows up in the tree with its icon and one
working command". That keeps each step buildable and reviewable. A good first slice:

> resource type + guard -> client wrapper -> data provider -> view provider -> register -> one read-only
> command (e.g. open-in-portal reuse) -> manifest -> build/lint/test.

Then add commands, virtual children, and the create/deploy wizard as subsequent slices.

## MIGRATION-PLAN.md

Emit an ordered, checkboxed plan. Every task links back to (a) an inventory feature and (b) a target
pattern, so parity is auditable. Template:

```markdown
# <Product> Migration Plan

Source: <repo> @ <commit-sha>   Inventory: <path>   Triage: <path (signed)>
Target: extensions/vscode-azure (+ packages/azutils)   Precedent: <product>
Monorepo phase: <n>

## Slice 0 — Foundations
- [ ] Add resource type + guards `tree/resources/<product>/<Product>.ts`  <- inventory: tree nodes
- [ ] Add `<Product>Client` wrapper + re-export + factory binding        <- inventory: SDK usage
- [ ] Constants (ARM type, logicalType)                                   <- inventory: resource types

## Slice 1 — Resource node in the tree
- [ ] `<Product>DataProvider.getChildren` (resource + virtual categories) <- inventory: tree hierarchy
- [ ] `<Product>ViewProvider.getTreeItem` (icon, contextValue)            <- inventory: node contextValues
- [ ] Register both in `registerTrees.ts`                                 <- —
- [ ] Icon `azureIcons/<logicalType>.svg`                                 <- inventory: node icons
- [ ] Reuse open-in-portal command on the node                           <- inventory: browse/openInPortal

## Slice 2 — Commands
- [ ] `<Command>` ManagedCommand + ContextValue + register + manifest when-clause  <- inventory: <cmd id>
- [ ] ... one row per Migrate/Adapt command ...

## Slice 3 — Create / Deploy (azd + Bicep)   [Adapt]
- [ ] Bicep template `resources/templates/<resource>.bicep` + BicepTemplateName union  <- inventory: create wizard
- [ ] Resource-specific PromptSteps `commands/<product>/steps/`                          <- inventory: wizard steps
- [ ] Register Create<Product> per AzdJob (createNew / deploy)                           <- inventory: create/deploy cmds

## Slice 4 — Reuse wiring
- [ ] App settings (`contextValuesToAdd: ['<product>']`)   <- inventory: app settings
- [ ] Auth / subscription filtering (if product-specific)  <- inventory: sign-in

## Slice N — Settings & manifest cleanup
- [ ] `contributes.configuration` for kept settings + nls  <- inventory: settings
- [ ] Debuggers / tasks / problemMatchers (per triage)     <- inventory: debuggers/tasks

## Deferred (tracked, not built now)
- [ ] <feature> — reason, target phase                     <- signed triage: Defer

## Dropped (for the record)
- <feature> — reason                                        <- signed triage: Drop
```

Rules:
- Every **Migrate/Adapt** feature appears as a checkbox. Every **Defer** appears under Deferred. Every
  **Drop** is listed for the record. **Reuse** appears as a wiring task. Nothing from the inventory is
  silently absent — that's what makes verification possible.
- Save `MIGRATION-PLAN.md` alongside the signed `TRIAGE.md`. Print both paths.
