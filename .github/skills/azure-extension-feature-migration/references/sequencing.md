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
7. Wizards                AVM search/selection + Bicep consumer (or two-file fallback) + azd steps per AzdJob
8. Manifest               package.json contributions + package.nls.json strings (+ new icon in azutils only if none matches)
9. Reuse wiring           app-settings / auth / generic commands hooked up in extension.ts
10. Tests                 unit (+ integration where the precedent has them)
```

Rationale: commands reference `ContextValue`s that view providers render; view providers read data
providers; data providers use client wrappers; everything resolves through DI set up in `extension.ts`.
The manifest `when` clauses must match the assembled `contextValue`s, so contribute the manifest after the
view layer exists.

## Slice the work vertically where you can

Prefer a **thin vertical slice per resource type** over doing all data providers, then all view providers,
then all commands. One shippable slice = "the resource node shows up in the tree with its icon (reused from
azutils) and one working command". That keeps each step buildable and reviewable. A good first slice:

> resource type + guard -> client wrapper -> data provider -> view provider -> register -> one read-only
> command (e.g. open-in-portal reuse) -> manifest -> build/lint/test.

Then add commands, virtual children, and the create/deploy wizard as subsequent slices.

## MIGRATION-PLAN.md

Emit an ordered, checkboxed plan. Every task is tagged with its **`TRIAGE.md` ID** (and, through that ID,
its inventory feature) plus a target pattern, so parity is auditable against the signed decisions. Template:

```markdown
# <Product> Migration Plan

Source: <repo> @ <commit-sha>   Inventory: <path>   Triage: <path (signed, committed)>
Target: extensions/vscode-azure (+ packages/azutils)   Precedent: <product>
Monorepo phase: <n>

## Slice 0 — Foundations
- [ ] Add resource type + guards `tree/resources/<product>/<ResourceModel>.ts`  <- SWA-0xx (tree nodes)
- [ ] Add `<Product>Client` wrapper + re-export + factory binding               <- SWA-0xx (SDK usage)
- [ ] Constants (ARM type, logicalType)                                         <- SWA-0xx (resource types)

## Slice 1 — Resource node in the tree
- [ ] `<Product>DataProvider.getChildren` (resource + virtual categories) <- SWA-0xx (tree hierarchy)
- [ ] `<Product>ViewProvider.getTreeItem` (icon, contextValue)            <- SWA-0xx (node contextValues)
- [ ] Register both in `registerTrees.ts`                                 <- —
- [ ] Icon: reuse existing `azureIcons/<logicalType>.svg`; add to azutils only if missing  <- SWA-0xx (node icons)
- [ ] Reuse open-in-portal command on the node                           <- SWA-0xx (browse/openInPortal)

## Slice 2 — Commands
- [ ] `<Command>` ManagedCommand + ContextValue + register + manifest when-clause  <- SWA-0xx (<cmd id>)
- [ ] ... one row per Migrate/Adapt command ...

## Slice 3 — Create / Deploy (azd + Bicep)   [Adapt]
- [ ] Record provisioning topology and AVM search evidence; select a pinned resource/pattern module, or justify fallback  <- SWA-0xx (create wizard)
- [ ] Add the AVM-backed consumer, or the AVM-shaped local module + consumer fallback; update the generation abstraction as needed  <- SWA-0xx (create wizard)
- [ ] Resource-specific PromptSteps `commands/<product>/steps/`                          <- SWA-0xx (wizard steps)
- [ ] Register Create<Product> per AzdJob (createNew / deploy)                           <- SWA-0xx (create/deploy cmds)

## Slice 4 — Reuse wiring
- [ ] App settings (implement one `SettingsAdapter`; the shared framework supplies the rest)   <- SWA-0xx (app settings)
- [ ] Auth / subscription filtering (if product-specific)  <- SWA-0xx (sign-in)

## Slice N — Settings & manifest cleanup
- [ ] `contributes.configuration` for kept settings + nls  <- SWA-0xx (settings)
- [ ] Debuggers / tasks / problemMatchers (per triage)     <- SWA-0xx (debuggers/tasks)
- [ ] Product doc `docs/products/<product>.md`; framework docs get at most a link  <- —

## Deferred (tracked, not built now)
- [ ] <feature> — reason, target phase                     <- SWA-0xx (Defer)

## Dropped (for the record)
- <feature> — reason                                        <- SWA-0xx (Drop)
```

Rules:
- Every **Migrate/Adapt** feature appears as a checkbox. Every **Defer** appears under Deferred. Every
  **Drop** is listed for the record. **Reuse** appears as a wiring task. Nothing from `TRIAGE.md` is
  silently absent — every ID appears somewhere, which is what makes verification possible.
- Tag each task with its `TRIAGE.md` ID (`<- SWA-0xx`) so Phase 6 can trace it back to a signed disposition.
- Save `MIGRATION-PLAN.md` in the tracked `docs/migrations/<service>/` folder alongside the signed
  `TRIAGE.md`, and **commit both before any feature code**. They are the migration PR's first commit; a PR
  with feature code but no plan/triage/inventory is incomplete. Print both paths.

## Branch drift protocol (long-lived migrations)

A feature migration takes weeks, and `main` moves underneath it. The most common way a migration goes stale is
that the monorepo grows the exact shared primitive a slice hand-rolled earlier — and nobody goes back.

After **every** rebase or merge from `main`:

1. **Read what arrived.** `git log --oneline <old-base>..main -- packages/utils/src packages/azutils/src
   extensions/vscode-azure/src` plus the same for the two testing barrels. Skim for new shared services,
   commands, wizard steps, utilities, and fixtures.
2. **Re-run the [shared-primitive sweep](implementation.md#before-you-write-the-shared-primitive-sweep) over
   already-landed slices**, not just the next one. Adopting a newly-shared primitive is in scope for the
   migration; leaving a product-local duplicate behind is a review blocker.
3. **Re-check the unbuilt slices.** A new shared primitive can turn a **Migrate** task into a **Reuse** wiring
   task. If it changes a disposition, edit `TRIAGE.md` and re-confirm with the human — never re-decide
   silently in-flight.
4. **Log it in `MIGRATION-PLAN.md`** so a reviewer can see it happened:

```markdown
## Drift log
- <date> rebased onto <sha> — adopted `getWorkspaceFolder` (replaces local helper in `steps/`); no other new shared surfaces.
```

A migration that has never logged a drift sweep, on a branch that has rebased, has not done this step.
