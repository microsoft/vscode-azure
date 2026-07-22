# Triage — the human decision gate

> **This is the most important phase, and it is not yours to decide.** A human reviews the inventory and
> decides what is and is not migrated. Your job is to make that decision *easy and well-informed*: propose
> a recommended disposition per feature with a crisp rationale, surface the non-obvious tradeoffs, then
> **stop and wait** for explicit sign-off. Do not write feature code before the human has signed off.

## Why a human gate exists

The target extension is a **redesign**, not a re-host. Whole categories of source behavior are intentionally
dropped or replaced (hand-written ARM deploy, bespoke tree-item classes, vendored SDK code). Only a human
who understands the product direction can decide, per feature, between keep / change / drop. Getting this
wrong wastes the most effort, so it is gated up front.

## Dispositions

| Disposition | Meaning | Typical trigger |
|-------------|---------|-----------------|
| **Migrate** | Rebuild the feature with the same UX, using monorepo patterns | Straightforward commands, tree nodes, settings |
| **Adapt** | Rebuild with **changed** behavior/UX | Deploy/create -> azd+Bicep; anything in [does-not-map.md](does-not-map.md) |
| **Reuse** | Already provided by a shared monorepo package; wire it up, don't rebuild | App settings, auth/sign-in, generic "open in portal", resource groups |
| **Drop** | Do not migrate | Dead/orphan NLS keys, deprecated features, source-only plumbing, things superseded by the platform |
| **Defer** | Keep, but a later migration phase | Depends on infra not yet in the monorepo; tracked in `MIGRATION-PLAN.md` |

## Recommendation heuristics (you propose, human disposes)

Use these to pre-fill the **recommended** column. They are defaults, not decisions.

- **Deployment / provisioning / "create resource" commands** -> **Adapt** to azd+Bicep. Never recommend porting ARM-deploy code. See [does-not-map.md](does-not-map.md).
- **App-settings / connection-strings features** -> **Reuse** the shared app-settings package (the inventory's contextValues like `applicationSettings.*<product>` are the tell).
- **Sign-in / account / subscription / tenant filtering** -> **Reuse** the existing auth + account providers.
- **"Open in portal", "Copy resource ID", resource-group grouping** -> **Reuse** generic commands/providers already in the tree.
- **Tree nodes** -> **Migrate** as `DataProvider` + `ViewProvider`, but the *construction* is Adapt-shaped (no per-node classes). Flag in [does-not-map.md](does-not-map.md).
- **Dead / orphan NLS keys and unused contributions** (inventory marked DEAD) -> **Drop**.
- **Code-only / exported-API surfaces** (e.g. a `RemoteRepoApi`) -> usually **Drop** or **Defer** unless a monorepo consumer needs them; call out explicitly.
- **Debuggers, task providers, problem matchers, framework detectors, CLI lifecycle** -> **judgment call** — these are the features most likely to be **Adapt** or **Drop** depending on whether the platform now owns them. Never silently assume; present the tradeoff.
- **Settings** -> **Migrate** the ones that back a kept feature; **Drop** settings whose feature is dropped.

## The triage table (present this to the human)

One row per inventory feature. Keep it exhaustive — every inventory line gets a row, so nothing is silently
lost. Group by inventory section (Commands, Settings, Tree, Wizards, Integrations, Debuggers/Tasks, Dead).

```
| # | Feature (from inventory) | Kind | Src layer | Recommended | Rationale / 1:1? | Human decision |
|---|--------------------------|------|-----------|-------------|------------------|----------------|
| 1 | createStaticWebApp       | cmd+wizard | A+B | Adapt | Deploy -> azd+Bicep; wizard steps change | (await human) |
| 2 | browse                   | cmd  | A+B | Reuse | Generic open-in-portal already exists    | (await human) |
| 3 | revealResource (orphan)  | nls  | -   | Drop  | Dead NLS key, no behavior                 | (await human) |
| ...|                          |      |     |       |                                          |                |
```

Rules for the table:
- **You fill every column except the last.** The last column is the human's.
- Put a clear **"does not map 1:1"** note in the rationale whenever behavior/UX changes, and link the
  reason to [does-not-map.md](does-not-map.md).
- Do not collapse or omit rows to shorten the table. Completeness is the point.

## Running the gate

1. Present the full table (use the `ask_user` tool for the sign-off question, not free text).
2. Record the human's decision + any rationale they give, **verbatim**, in the table's last column.
3. If they change dispositions, re-render and re-confirm.
4. Only when the human explicitly signs off ("approved", "go", etc.) do you advance to Phase 3.

> Persist the signed-off table (e.g. `TRIAGE.md` alongside `MIGRATION-PLAN.md`). It is an input to
> verification: every feature must trace back to a signed disposition.
