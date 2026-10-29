# Sequencing & Plan

Order the mapped features so each slice compiles on top of the last, then emit `MIGRATION-PLAN.md`.

## Shared foundations and review boundaries

Before product implementation, identify shared changes independently reviewable from the feature
(for example process lifecycle, task execution, or a framework extension point). Record their
consumers/responsibility, dependency order, and proposed PR boundaries in the plan. Propose separate
PRs where that reduces coupled review, but obtain approval before creating additional PRs; a
separate PR is not mandatory for every helper.

Reuse existing shared primitives and adapt fixtures additively. New extraction needs an existing
second consumer or a genuinely framework-owned responsibility, not a hypothetical future product.
Keep product-specific orchestration local without that evidence. Plan this separation early rather
than treating broad generalization as a prerequisite to finishing each slice.

## Dependency order

Build bottom-up from each slice's actual imports and DI dependencies. A typical order is:

```
1. Constants & types      constants, ARM type + logicalType constants, resource type + guards
2. Client wrappers        packages/azutils/src/rest/clients/<Product>Client.ts (+ re-export + factory)
3. Reuse prerequisites    SettingsAdapter / existing auth and generic command contracts
4. Data providers         <Product>DataProvider (getChildren + virtual nodes + enrich)
5. Wizard prerequisites   contexts, prompt/execute steps, templates + azd steps per AzdJob
6. Commands               ManagedCommand classes + static ContextValue + product registerCommand
7. View providers         <Product>ViewProvider (getTreeItem, icons, contextValue)
8. Registration           product bindings/commands/resource providers; workspace/activity arrays
9. Manifest               package.json contributions + package.nls.json strings (+ new icon in azutils only if none matches)
```

Rationale: view providers reference the commands' `ContextValue`s and read data resources;
data providers use client wrappers. Product bindings and resource providers come through
`ProductRegistrar`; `registerTrees.ts` composes trees and workspace/activity entries.
The manifest `when` clauses must match the assembled `contextValue`s, so contribute the manifest after the
view layer exists.
Tests accompany each slice, not a separate final implementation stage.

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

## Shared foundations and review boundaries
- <shared change; actual consumers/framework owner; dependencies; proposed PR or same-PR slice>

## Slice 0 — Foundations
- [ ] Add resource type + guards `tree/resources/<product>/<ResourceModel>.ts`  <- SWA-0xx (tree nodes)
- [ ] Add `<Product>Client` wrapper + re-export + factory binding               <- SWA-0xx (SDK usage)
- [ ] Constants (ARM type, logicalType)                                         <- SWA-0xx (resource types)

## Slice 1 — Resource node in the tree
- [ ] `<Product>DataProvider.getChildren` (resource + virtual categories) <- SWA-0xx (tree hierarchy)
- [ ] `<Product>ViewProvider.getTreeItem` (icon, contextValue)            <- SWA-0xx (node contextValues)
- [ ] Register resource providers through the product registrar          <- —
- [ ] Icon: reuse existing `azureIcons/<logicalType>.svg`; add to azutils only if missing  <- SWA-0xx (node icons)
- [ ] Reuse open-in-portal command on the node                           <- SWA-0xx (browse/openInPortal)

## Slice 2 — Commands
- [ ] `<Command>` ManagedCommand + ContextValue + register + manifest when-clause  <- SWA-0xx (<cmd id>)
- [ ] ... one row per Migrate/Adapt command ...

## Slice 3 — Create / Deploy (azd + Bicep)   [Adapt]
- [ ] Record provisioning topology and AVM search evidence; select a pinned resource/pattern module, or justify fallback  <- SWA-0xx (create wizard)
- [ ] Bundle the AVM-backed consumer, or local module + consumer fallback; select the template directory through the Bicep step factory  <- SWA-0xx (create wizard)
- [ ] Resource-specific PromptSteps `commands/<product>/steps/`                          <- SWA-0xx (wizard steps)
- [ ] Register Create<Product> per AzdJob (createNew / deploy)                           <- SWA-0xx (create/deploy cmds)

## Slice 4 — Reuse wiring
- [ ] Shared settings framework (implement one `SettingsAdapter`; the framework supplies the rest)   <- SWA-0xx (application settings)
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
- Carry the mapping's behavioral contracts and approval references into each slice's acceptance
  criteria, including conditional Reuse and remaining live scenarios; tests are part of each slice.
- Save `MIGRATION-PLAN.md` beside the signed `TRIAGE.md` and **commit both before feature code**.
  The committed inventory precedes triage. Separate artifact commits or artifacts already on the
  base branch are valid; no first-commit layout is required. Print the paths.

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
