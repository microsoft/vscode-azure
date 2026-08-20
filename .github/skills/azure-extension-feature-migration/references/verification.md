# Verification

Three independent checks: **artifacts** (did the process record survive?), **parity** (did every inventoried
feature get handled per its signed disposition?) and **conformance** (does the new code meet the monorepo's
standards?). Report gaps honestly — do not hide an incomplete slice.

## Artifact check (run this first)

The process artifacts are deliverables, not scratch. A PR with feature code but no artifacts is incomplete
no matter how much code landed.

- [ ] `docs/migrations/<service>/INVENTORY.md` exists and is **tracked** (`git ls-files` shows it), with raw
      telemetry numbers redacted.
- [ ] `docs/migrations/<service>/TRIAGE.md` exists, is tracked, and carries the sign-off header.
- [ ] `docs/migrations/<service>/MIGRATION-PLAN.md` exists, is tracked, and every task is tagged with a
      `TRIAGE.md` ID.
- [ ] All three landed **before any feature code** in the PR's commit history.
- [ ] No process artifact exists only in a session/scratch directory or in chat.
- [ ] If the branch has rebased or merged from `main`, `MIGRATION-PLAN.md` has a drift-log entry for each one.

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
- [ ] The node's icon resolves — either an existing `azureIcons/<logicalType>.svg` was reused, or (only when none matched) a new SVG was added to the **azutils** package. Its name equals `<logicalType>.toLowerCase()+'.svg'`.
- [ ] `DataProvider`/`ViewProvider` are registered **before** the generic fallback in `registerTrees.ts`.
- [ ] **Layering is clean in both directions:** the view provider does not mutate data, and no `DataProvider`
      or data-layer resource carries a display label, description, tooltip, icon id, or `contextValue`.

## Shared-primitive check

- [ ] Every new helper, utility, service, wizard step, command, and test fixture has a recorded sweep result
      in its mapping record ("reused `<symbol>`" or "searched `<terms>`, none exists").
- [ ] Spot-check the sweep: grep `packages/utils/src`, `packages/azutils/src`,
      `extensions/vscode-azure/src`, and both testing barrels for each new symbol's concept. No product-local
      duplicate of a shared primitive survives (workspace folder/file pickers, URL-opening commands, browse
      website, file existence, caseless collections, shell task creation, process termination, workspace
      scanning, paged mock trees).
- [ ] Where a shared symbol was close but not general enough, it was **extended additively** rather than
      forked into the product folder.
- [ ] Drift: for each rebase/merge from `main`, already-landed slices were re-swept and any newly-shared
      primitive was adopted.

## Ownership-boundary check

- [ ] No code authors, templates, patches, or parses `azure.yaml` outside `GenerateAzureYamlStep`.
- [ ] No `contributes.configuration` setting stores project/deployment configuration (paths, build commands,
      service topology) that belongs in `azure.yaml`.
- [ ] No scaffolding or build-preset generation that azd already performs.
- [ ] No call to, dependency on, or compatibility shim for the extension being retired — no `azureFunctions.*`
      / `azure<Service>.*` command invocations, no `extensionDependencies` entry, no reading its settings or
      state, no preserved contribution ids.

## Activation-budget check

- [ ] Every new `activationEvents` entry has a one-line justification in the mapping record.
- [ ] No unbounded `workspaceContains:**/...` glob; any glob that remains is depth-bounded and justified.
- [ ] No `onDebugDynamicConfigurations` / `onDebugInitialConfigurations` / `onDebugResolve:*` carried over
      without an explicit human decision recorded in `TRIAGE.md`.
- [ ] No eager CLI-presence check, CLI version check, auth/`getSession` call, or workspace scan runs at
      activation; each happens on first use of a product command.
- [ ] A user who never touches this product sees no new startup work, prompt, or warning.

## External-fact check

- [ ] Every version gate, file/schema name, URL, package name, and "this asset already exists" claim names the
      source it was verified against.
- [ ] Version gates cite the release that introduced the capability, not the current release.
- [ ] No invented asset: any added SVG/template/schema was preceded by a directory listing showing nothing
      correct already ships.

## Wizard check (create/deploy)

- [ ] Registered per `AzdJob` (`createNew` and/or `deploy`) via `prefixArgs`.
- [ ] Uses shared azd steps + resource-specific `PromptStep`s; **no** hand-written ARM execute steps.
- [ ] **Prompt budget:** every retained prompt is justified in the mapping record; anything defaultable is a
      Bicep default the user can edit, not a question.
- [ ] There is **one** create command — no "advanced" variant, mode flag, or basic-vs-advanced branch.
- [ ] Conditionality lives in `shouldPrompt`/`shouldExecute`, not in conditionally assembled step arrays.
- [ ] Mapping records the AVM repository path searched, candidate suitability, pinned registry version,
      and parameter/output mapping.
- [ ] A resource module is used only for a single-resource topology; any topology with supporting resources
      uses a pattern module.
- [ ] If no suitable AVM module exists, the generated infrastructure contains exactly one AVM-shaped local
      module plus one consumer, with the module boundary preserved by the generation step.
- [ ] The `GenerateBicepStep` template selection mechanism declares everything it must copy: an AVM-backed
      consumer template containing a pinned `br/public:avm/...:<version>` reference, or both fallback files
      with source/destination mappings that preserve the local module's relative path.
- [ ] The Bicep consumer builds successfully and resolves its pinned remote module or bundled local module.
- [ ] Resource-specific steps skip correctly when `hasInfra` (Post-clone / Bootstrapped scenarios).

## Conformance check (conventions)

- [ ] Copyright header on every new `.ts`/`.js` file.
- [ ] No raw `vscode` value import outside `extension.ts`; DI interfaces used throughout; `import type` for types.
- [ ] All user-facing strings via `l10n.t`; `package.json` strings via `%key%` present in `package.nls.json`.
- [ ] Logs use `IOutputChannel` with bracketed subsystem prefixes; **no PII/secrets** logged.
- [ ] Azure SDK types re-exported from the azutils wrapper; **no** `@azure/*` imports in the extension.
- [ ] ARM `type`/`logicalType` compared case-insensitively against constants.
- [ ] `stringifyError()` in catch clauses; `void`-prefixed fire-and-forget promises.
- [ ] Migrated classes expose the **minimum surface** — no public field or method without an external caller,
      and nothing widened just to let a test reach it.
- [ ] User cancellation throws `CancellationError` rather than a bespoke outcome enum or result union.
- [ ] No parallel helpers whose names don't state how they differ (`resolveX` / `getX` / `resolveY`).
- [ ] Any widened shared type/context makes its new member **required**, and every already-migrated product
      was updated — none left as the implicit default case behind an optional field.

## Test check

- [ ] Tests labelled `(unit)`/`(integration)`; existing test helpers reused (no re-hand-rolled fixtures,
      no local paging/`singlePage` helper where `createMockPagedDataItemTree` exists).
- [ ] **None of the banned shapes are present:** manifest-completeness / contribution-inventory tests,
      DI-registration or product-registrar wiring tests, constant-vs-constant assertions, snapshot-style
      literal object/array shapes, `contextValue` string assertions, or tests asserting removed behavior
      stays removed.
- [ ] Any test that looks like one of the above is a genuine **cross-boundary consistency check** that reads
      *both* sides and compares them — not an assertion against a hardcoded literal.
- [ ] Each remaining test exercises behavior the slice added, and would fail if that behavior broke.

## Documentation check

- [ ] Product-specific documentation lives in `docs/products/<product>.md` — not a new top-level `docs/` file.
- [ ] Framework docs (`architecture`, `dependency-injection`, `conventions`, `resource-creation`,
      `tree-views`, ...) gained no product-specific section, service, or example; at most a link.
- [ ] Edits to existing docs **deleted** stale prose rather than appending a correction next to it, and added
      no line that restates the surrounding text.
- [ ] New doc content prefers links over inlined symbol lists and code snippets.

## Build gates

- [ ] `pnpm run lint` clean (or per-filter for touched packages).
- [ ] `pnpm run build` succeeds.
- [ ] `pnpm run test` passes for touched packages.

## Final report

Produce a short report containing: the artifact check, the parity coverage table, any gaps/deferrals, and the
build-gate results. If anything is incomplete, say so explicitly and point to the tracking task — a partial
migration reported honestly is correct; a partial migration reported as done is not.
