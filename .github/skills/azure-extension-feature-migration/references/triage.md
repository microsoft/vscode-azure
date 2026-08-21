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

The inventory (from the feature-inventory skill) carries **collected** per-feature usage — external adoption
(`IsInternal == false`), the Succeeded/Failed/Canceled split, last-seen, and an **advisory** suggestion
(`lean Migrate` / `candidate Drop` / `needs a human` / `no data — verify`). Treat those numbers and the
suggestion as **input to the human's decision**, not a verdict: a low count is context, never an automatic
Drop, and the guardrails still apply — a suppressed or renamed event reads as near-zero without being unused,
high `Failed` is a fix signal, high `Canceled` is a friction signal. If the human wants fresh or deeper
numbers (a different window, a version/platform breakdown), first confirm the user is on the corporate VPN;
the telemetry cluster is unreachable otherwise. Then prefer the Azure MCP server's `kusto` tool and its
`kusto_query` command with `cluster-uri`, `database`, `query`, and the corporate `tenant`. If Azure MCP or
that command is unavailable, fall back to the inventory skill's direct `az` token + ADX REST procedure; if
telemetry is unreachable, emit the matching ADX deeplink. The triage decision remains the human's. **Raw
counts stay in the session/working copy** — a committed `TRIAGE.md` cites telemetry only qualitatively (see
the decision-artifact section below).

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
| **Reuse** | Already provided by a shared monorepo package/service; wire it up, don't rebuild | Auth/sign-in, generic "open in portal", resource-group grouping |
| **Drop** | Do not migrate | Dead/orphan NLS keys, deprecated features, source-only plumbing, things superseded by the platform |
| **Defer** | Keep, but a later migration phase | Depends on infra not yet in the monorepo; tracked in `MIGRATION-PLAN.md` |

## Recommendation heuristics (you propose, human disposes)

Use these to pre-fill the **recommended** column. They are defaults, not decisions.

- **Deployment / provisioning / "create resource" commands** -> **Adapt** to azd+Bicep. Never recommend porting ARM-deploy code. See [does-not-map.md](does-not-map.md).
- **Application settings / connection strings** -> **Reuse** the shared settings framework: implement one `SettingsAdapter` and bind it; the framework supplies the tree node, the JSONC editor, and the edit command. Never rebuild a product-specific settings UI or per-setting commands. See [does-not-map.md](does-not-map.md) #5 and `docs/settings.md`.
- **Sign-in / account / subscription / tenant filtering** -> **Reuse** the existing auth + account providers.
- **"Open in portal", resource-group grouping** -> **Reuse** generic commands/providers already in the tree.
- **Tree nodes** -> **Migrate** as `DataProvider` + `ViewProvider`, but the *construction* is Adapt-shaped (no per-node classes). Flag in [does-not-map.md](does-not-map.md).
- **Dead / orphan NLS keys and unused contributions** (inventory marked DEAD) -> **Drop**.
- **Code-only / exported-API surfaces** (e.g. a `RemoteRepoApi`) -> usually **Drop** or **Defer** unless a monorepo consumer needs them; call out explicitly.
- **Debuggers, task providers, problem matchers, framework detectors, CLI lifecycle** -> **judgment call** — these are the features most likely to be **Adapt** or **Drop** depending on whether the platform now owns them. Never silently assume; present the tradeoff. Their **activation cost** is part of the tradeoff: a debug provider or `workspaceContains` glob charges every user of the extension, including those who never touch this product.
- **Anything that writes, parses, or scaffolds a file another tool owns** (`azure.yaml`, azd templates, build presets) -> **Drop** / **Defer**, or an upstream contribution. See [does-not-map.md](does-not-map.md) #8.
- **Anything that only works by calling into the extension being retired** -> **Defer**, naming the capability the monorepo is missing. Never **Migrate** a dependency on an extension we are deleting.
- **Commands whose value is incidental** (uninstall-the-CLI, reveal-in-tree, refresh-this-node, help links the platform already offers) -> **Drop** by default. "The source shipped it" is not a rationale; state what the user actually loses without it and let the human decide.
- **Settings** -> **Migrate** the ones that back a kept feature; **Drop** settings whose feature is dropped. A setting that stores project/deployment configuration is a **Drop** even if its feature is kept — that data belongs in `azure.yaml`.

## The draft triage table

One row per inventory feature. Keep it exhaustive — every inventory line gets a row, so nothing is silently
lost. Group by inventory section (Commands, Settings, Tree, Wizards, Integrations, Debuggers/Tasks, Dead).

Give every row a **stable feature ID** (`<PRODUCT>-NNN`, e.g. `SWA-001`) in the first column. That ID is
the join key the rest of the migration uses: `MIGRATION-PLAN.md` tasks, code comments, and the parity report
all reference decisions by ID, so they never re-litigate a disposition.

```
| ID | Feature (from inventory) | Kind | Src layer | Recommended | Rationale / 1:1? |
|--------|--------------------------|------|-----------|-------------|------------------|
| SWA-001 | createStaticWebApp      | cmd+wizard | A+B | Adapt | Deploy -> azd+Bicep; wizard steps change |
| SWA-002 | browse                  | cmd  | A+B | Reuse | Generic open-in-portal already exists    |
| SWA-003 | revealResource (orphan) | nls  | -   | Drop  | Dead NLS key, no behavior                 |
| ...     |                          |      |     |       |                                          |
```

Rules for the table:
- **IDs are permanent.** Assign them once and never renumber — downstream artifacts point at them. If a
  feature is split or merged after sign-off, allocate new IDs; don't recycle old ones.
- Put a clear **"does not map 1:1"** note in the rationale whenever behavior/UX changes, and link the
  reason to [does-not-map.md](does-not-map.md).
- Do not collapse or omit rows to shorten the table. Completeness is the point.

## Presenting the table for review

Choose the review surface by scale:

- **Roughly 40 rows or fewer:** an in-chat Markdown table is acceptable.
- **More than roughly 40 rows:** generate an Excel workbook (`.xlsx`). Do not dump a large table into chat
  or ask the human to edit pipe-delimited Markdown.
- **Small, high-stakes subset:** offer to walk through those rows with `ask_user` multiple-choice prompts.
  This pairs well with bulk-accepting the mechanical remainder in the workbook.

For a workbook, first save the complete draft Markdown table in session scratch. **Generate the workbook by
parsing that draft; never retype or separately re-emit its rows.** The parser must fail on duplicate IDs,
unknown recommendations, malformed rows, or a parsed row count that differs from the draft's computed count.
Compute disposition summaries from the parsed rows rather than copying hand-written totals. This keeps the
review surface and draft synchronized and catches counting errors before review.

Use `openpyxl` to generate and read the workbook. It is not present by default, so install it with
`pip install openpyxl` when needed. The workbook must have:

- A **How to use** sheet as the first tab. Explain that `DECISION` is pre-filled, changed decisions are
  highlighted, notes flow verbatim into `TRIAGE.md`, the file must be saved as `.xlsx`, and nothing is
  committed until sign-off.
- A **Triage** sheet with one parsed row per feature and columns for ID, inventory section, feature, kind,
  source layer, Recommended, `DECISION`, `Your notes (verbatim into TRIAGE.md)`, Judgment call, proposed
  rationale, and the relevant telemetry/ADX query.
- `DECISION` pre-filled from Recommended so the human edits only exceptions. Apply list data validation with
  exactly `Migrate`, `Adapt`, `Reuse`, `Drop`, and `Defer`; blanks and arbitrary text are invalid.
- Distinct disposition colors in both Recommended and `DECISION`, plus conditional formatting that
  highlights each row where `DECISION` differs from Recommended.
- A **Judgment calls** sheet grouping the product-specific rows that need genuine product judgment. Include
  the affected IDs, why the decision needs a human, and any relevant query link. Derive the groups for the
  current product; do not hardcode another migration's groups.
- Per-row hyperlinks to the telemetry/ADX query that informs the decision, plus a dedicated query sheet when
  several rows share named queries. Query links are allowed; raw telemetry results are not.
- Frozen panes, autofilters, readable column widths, wrapped long text, and a visually distinct header row.

The draft Markdown table, generator script, and workbook are **session scratch and must not be committed**.
Only the signed-off `TRIAGE.md` is a tracked migration artifact. If the workbook is open in Excel, it cannot
be overwritten: ask the human to close it or write a new file path.

## Running the gate

1. Present the full review surface and stop. For a workbook, give the human its path and ask them to save it
   and confirm when review is complete. For an in-chat table, request decisions through an interactive prompt
   such as `ask_user` rather than free-text narration.
2. Read the saved workbook back; do not rely on remembered chat decisions or the pre-review draft. Validate
   that every draft ID appears exactly once and every `DECISION` contains one of the five dispositions.
3. Preserve `Your notes` **verbatim** as the human rationale. If a changed decision has no note, ask for the
   rationale rather than inventing one.
4. Summarize the final dispositions from the reviewed data and request explicit human sign-off.
5. If the human changes dispositions, update the review surface and re-confirm.
6. Only after explicit sign-off ("approved", "go", etc.) generate `TRIAGE.md` from the reviewed data.

## The decision artifact (`TRIAGE.md`) — commit it

The reviewed data becomes the **committed source of truth** only through `TRIAGE.md`. The moment the human
signs off, write it to `TRIAGE.md` in the migration's **tracked artifacts folder** in the target repo —
`docs/migrations/<service>/`, the same folder as the committed `INVENTORY.md`. Then **commit it as its own
change**, separate from any feature code. Treat it like a decision record (ADR): it is read-only to every
later phase, and the only way to change a disposition is to edit `TRIAGE.md` and re-confirm with the human —
never silently in-flight while implementing.

`TRIAGE.md` contract:

- **Header block:** source repo + commit SHA the inventory was taken from, the granularity rule used, who
  signed off, and the date. This makes the decision reproducible and auditable.
- **One row per feature**, carrying the **stable ID**, the **final** disposition (Migrate / Adapt / Reuse /
  Drop / Defer — not "recommended"), the rationale, and whether usage data was consulted.
- **Rationale may cite telemetry qualitatively** ("dropped: low external adoption per telemetry", "high cancel
  rate suggests exploration, not use") but **must never paste raw counts, result tables, or exported rows** —
  those stay in the session/working copy only (see `.github/copilot-instructions.md`). A committable ADX
  **deeplink** (a query, not data) is fine so a reviewer can re-run it.
- **Every inventory feature appears exactly once.** A row with no disposition is a bug — the gate isn't done.
- **Defer rows** name the blocking phase/infra so `MIGRATION-PLAN.md` can track them.

Downstream, this artifact is authoritative:

- **Phase 3 (Map)** only maps rows whose disposition is Migrate / Adapt / Reuse; it reads dispositions from
  `TRIAGE.md`, it does not re-decide them.
- **Phase 4 (Sequence)** references each task back to a `TRIAGE.md` ID.
- **Phase 6 (Verify)** traces every landed feature — and every intentional omission — back to a `TRIAGE.md`
  row by ID. Any feature with no `TRIAGE.md` row, or any Migrate/Adapt row with no landed code (or tracked
  Defer), is a reported gap.
