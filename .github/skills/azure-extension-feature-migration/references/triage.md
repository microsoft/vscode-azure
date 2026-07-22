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

## Usage data is a triage input (not the skill's call)

The inventory (from the feature-inventory skill) includes a **telemetry usage link** per instrumented
feature plus an extension-wide roll-up link. Encourage the human to open the ones they're unsure about —
**external** adoption (`IsInternal == false`) and failure rate are strong Migrate-vs-Drop signals. The agent
must **not** run those queries or assert usage; a low count is context for the human, never an automatic Drop.

## Feature granularity (what counts as one row)

The inventory mixes granular rows (one command) with dense prose (activation wiring, integrations, wizard
substeps). Normalize to **one row per independently-dispositionable feature** using this rule:

- **One row per:** contributed command; setting; tree node **type** (each distinct `contextValue`, including
  each status / `invalid*` variant, is its own row so its `when`-clause stays auditable); wizard **flow**
  (a create/delete/config flow is one row; its notable prompt substeps are rows only if they can be
  independently kept/dropped — e.g. a build-preset step); each distinct integration surface (a client, a
  provider, a parser, an exported API); each debugger/task/problemMatcher; each orphan/dead key.
- **Don't** split one command into separate rows for its handler, telemetry, and menu entry — that's one row.
- **Don't** collapse several commands into one row to shorten the table.

State your granularity choice at the top of the table so the count is reproducible. Two reasonable analysts
should land within a few rows of each other.

## Exported extension APIs (special case)

Source extensions sometimes export an API object (e.g. a `RemoteRepoApi`) for other extensions to consume.
These are **not** user features, so they need a deliberate call:

1. Search the monorepo (and known sibling extensions) for a consumer of that API.
2. **No consumer found ->** recommend **Drop** (note the search was done).
3. **Consumer found ->** recommend **Defer** (or **Migrate**) and name the consumer + what contract it needs.
4. Never silently port an exported API "in case someone needs it" — record the decision + evidence.

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
- **App-settings / connection-strings features** -> **Reuse** by mirroring the Functions app-settings precedent (no shared package yet; the inventory's contextValues like `applicationSettings.*<product>` are the tell). See [does-not-map.md](does-not-map.md) #5.
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

Give every row a **stable feature ID** (`<PRODUCT>-NNN`, e.g. `SWA-001`) in the first column. That ID is
the join key the rest of the migration uses: `MIGRATION-PLAN.md` tasks, code comments, and the parity report
all reference decisions by ID, so they never re-litigate a disposition.

```
| ID | Feature (from inventory) | Kind | Src layer | Recommended | Rationale / 1:1? | Decision |
|--------|--------------------------|------|-----------|-------------|------------------|----------|
| SWA-001 | createStaticWebApp      | cmd+wizard | A+B | Adapt | Deploy -> azd+Bicep; wizard steps change | (await human) |
| SWA-002 | browse                  | cmd  | A+B | Reuse | Generic open-in-portal already exists    | (await human) |
| SWA-003 | revealResource (orphan) | nls  | -   | Drop  | Dead NLS key, no behavior                 | (await human) |
| ...     |                          |      |     |       |                                          |                |
```

Rules for the table:
- **You fill every column except the last.** The last column is the human's.
- **IDs are permanent.** Assign them once and never renumber — downstream artifacts point at them. If a
  feature is split or merged after sign-off, allocate new IDs; don't recycle old ones.
- Put a clear **"does not map 1:1"** note in the rationale whenever behavior/UX changes, and link the
  reason to [does-not-map.md](does-not-map.md).
- Do not collapse or omit rows to shorten the table. Completeness is the point.

## Running the gate

1. Present the full table and **stop for explicit human sign-off** — request the decision through an
   interactive prompt (e.g. the `ask_user` tool) rather than free-text narration, so the answer is captured.
2. Record the human's decision + any rationale they give, **verbatim**, in the table's last column.
3. If they change dispositions, re-render and re-confirm.
4. Only when the human explicitly signs off ("approved", "go", etc.) do you write the decision artifact.

## The decision artifact (`TRIAGE.md`) — commit it

The signed-off table is not a scratch note; it is the **committed source of truth** for the whole migration.
The moment the human signs off, write it to `TRIAGE.md` (alongside `INVENTORY.md` / `MIGRATION-PLAN.md`) and
**commit it as its own change**, separate from any feature code. Treat it like a decision record (ADR): it is
read-only to every later phase, and the only way to change a disposition is to edit `TRIAGE.md` and re-confirm
with the human — never silently in-flight while implementing.

`TRIAGE.md` contract:

- **Header block:** source repo + commit SHA the inventory was taken from, the granularity rule used, who
  signed off, and the date. This makes the decision reproducible and auditable.
- **One row per feature**, carrying the **stable ID**, the **final** disposition (Migrate / Adapt / Reuse /
  Drop / Defer — not "recommended"), the rationale, and whether usage data was consulted.
- **Every inventory feature appears exactly once.** A row with no disposition is a bug — the gate isn't done.
- **Defer rows** name the blocking phase/infra so `MIGRATION-PLAN.md` can track them.

Downstream, this artifact is authoritative:

- **Phase 3 (Map)** only maps rows whose disposition is Migrate / Adapt / Reuse; it reads dispositions from
  `TRIAGE.md`, it does not re-decide them.
- **Phase 4 (Sequence)** references each task back to a `TRIAGE.md` ID.
- **Phase 6 (Verify)** traces every landed feature — and every intentional omission — back to a `TRIAGE.md`
  row by ID. Any feature with no `TRIAGE.md` row, or any Migrate/Adapt row with no landed code (or tracked
  Defer), is a reported gap.
