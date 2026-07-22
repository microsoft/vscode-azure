# Verification

Two independent checks: **parity** (did every inventoried feature get handled per its signed disposition?)
and **conformance** (does the new code meet the monorepo's standards?). Report gaps honestly — do not hide
an incomplete slice.

## Parity check (against `TRIAGE.md`)

Walk `TRIAGE.md` **by ID**. Every ID must resolve to exactly one outcome:

- [ ] Every **Migrate** feature -> landed code (command/provider/wizard/setting present and wired).
- [ ] Every **Adapt** feature -> landed code with the intended behavior change (e.g. azd+Bicep, not ARM).
- [ ] Every **Reuse** feature -> the shared package/service is actually wired (not just assumed).
- [ ] Every **Defer** feature -> a tracked task under "Deferred" in `MIGRATION-PLAN.md`.
- [ ] Every **Drop** feature -> listed under "Dropped"; confirm no code was migrated for it.
- [ ] No ID is unaccounted for, and no landed feature lacks a `TRIAGE.md` ID. Count IDs in vs. outcomes
      resolved; they must match. Cross-check `TRIAGE.md` against the original `INVENTORY.md` so no inventory
      feature was dropped *before* triage either.

Build the coverage report (keyed by the stable ID):

```
| ID      | Feature            | Disposition (signed) | Outcome            | Evidence (path/symbol) |
|---------|--------------------|----------------------|--------------------|------------------------|
| SWA-001 | createStaticWebApp | Adapt                | landed (azd)       | commands/swa/CreateStaticWebApp.ts |
| SWA-002 | browse             | Reuse                | wired              | OpenInPortal.ContextValue on view item |
| SWA-003 | revealResource     | Drop                 | not migrated (dead)| — |
```

> Evidence paths are shorthand relative to the extension source root `extensions/vscode-azure/src/` (e.g.
> `commands/swa/CreateStaticWebApp.ts` -> `extensions/vscode-azure/src/commands/swa/CreateStaticWebApp.ts`).
> See [target-patterns.md](target-patterns.md) for the full-path convention.

## Tree contract check

For each migrated node type:
- [ ] The node's assembled `contextValue` (from `combineContextValues`) matches every `package.json` menu
      `when` regex that targets it (`viewItem =~ /\b<ctx>\b/i`, word boundaries present).
- [ ] Status / `invalid*` variants from the inventory are preserved and their `when` clauses still match.
- [ ] The icon file `azureIcons/<logicalType>.svg` exists and the name equals `<logicalType>.toLowerCase()+'.svg'`.
- [ ] `DataProvider`/`ViewProvider` are registered **before** the generic fallback in `registerTrees.ts`.

## Wizard check (create/deploy)

- [ ] Registered per `AzdJob` (`createNew` and/or `deploy`) via `prefixArgs`.
- [ ] Uses shared azd steps + resource-specific `PromptStep`s; **no** hand-written ARM execute steps.
- [ ] Bicep template exists in `resources/templates/` and is in the `BicepTemplateName` union.
- [ ] Resource-specific steps skip correctly when `hasInfra` (Post-clone / Bootstrapped scenarios).

## Conformance check (conventions)

- [ ] Copyright header on every new `.ts`/`.js` file.
- [ ] No raw `vscode` value import outside `extension.ts`; DI interfaces used throughout; `import type` for types.
- [ ] All user-facing strings via `l10n.t`; `package.json` strings via `%key%` present in `package.nls.json`.
- [ ] Logs use `IOutputChannel` with bracketed subsystem prefixes; **no PII/secrets** logged.
- [ ] Azure SDK types re-exported from the azutils wrapper; **no** `@azure/*` imports in the extension.
- [ ] ARM `type`/`logicalType` compared case-insensitively against constants.
- [ ] `stringifyError()` in catch clauses; `void`-prefixed fire-and-forget promises.
- [ ] Tests labelled `(unit)`/`(integration)`; existing test helpers reused (no re-hand-rolled fixtures).

## Build gates

- [ ] `pnpm run lint` clean (or per-filter for touched packages).
- [ ] `pnpm run build` succeeds.
- [ ] `pnpm run test` passes for touched packages.

## Final report

Produce a short report containing: the parity coverage table, any gaps/deferrals, and the build-gate
results. If anything is incomplete, say so explicitly and point to the tracking task — a partial migration
reported honestly is correct; a partial migration reported as done is not.
