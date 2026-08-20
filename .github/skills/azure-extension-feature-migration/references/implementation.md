# Implementation Loop

Build one slice at a time from `MIGRATION-PLAN.md`. For each slice, copy the **shape** of the precedent
product (never the source extension's code), conform to conventions, then validate before moving on.

## Before you write: the shared-primitive sweep

**Mandatory, once per slice, before any new helper, utility, service, wizard step, wrapper, or test fixture.**
The monorepo already owns most cross-cutting concerns, and it keeps growing new ones while a migration branch
is open. Search first:

| Search here | For |
|-------------|-----|
| `packages/utils/src` | generic primitives: workspace/file helpers, file existence, caseless collections, async iterables, settings, events |
| `packages/azutils/src` | Azure primitives: client wrappers, auth, portal/resource URLs, paging |
| `extensions/vscode-azure/src` | product-level shared code: generic commands (open-url, open-in-portal, browse, delete), shared wizard/pick steps, the workspace scanning service + workspace index, process/task services, the shared settings framework |
| `packages/utils/test/testing.ts`, `packages/azutils/test/testing.ts` | fixtures: entity `make*` factories, mock trees (incl. paged), mock VS Code, paging drains |

Search by **concept, not by the name you were about to use** — the shared symbol is rarely named what the
source extension called it. Grep at least two synonyms plus the domain noun (`exists` / `stat` / `fileExists`;
`walk` / `scan` / `index`; `openUrl` / `openExternal`; `shellTask` / `spawn` / `ProcessExecutor`).

Record the outcome in the feature's mapping record, so a reviewer can check the search happened:

```
Shared-primitive sweep: reused <symbol> from <package>  |  searched <terms>, none exists -> new <symbol> at <path>
```

Rules:
- If the concept exists, **use it** — even if adapting your slice costs more than hand-rolling.
- If it exists but is not general enough, **extend it additively** in the shared package (optional parameter,
  optional override, thin wrapper beside it). Do not fork a product-local copy.
- If it genuinely does not exist and a second product would want it, put the new symbol in the **shared**
  package, not in the product folder.
- Process termination, shell task creation, workspace scanning, URL-opening commands, workspace file/folder
  pickers, and "browse the resource's website" are all shared concerns by default — never product-local.

## Per-slice loop

1. **Open the precedent.** Read the matching precedent file(s) from [target-patterns.md](target-patterns.md)
   (e.g. `AcrDataProvider.ts` for a data provider). You are mirroring structure, DI wiring, and idioms —
   not copying logic from the source extension.
2. **Write the file(s)** for the slice, in dependency order. Every file gets:
   - the Microsoft copyright header;
   - `import type` for type-only imports; DI interfaces (`IVsCode`, `IOutputChannel`, ...) instead of raw `vscode`;
   - `@injectable()` on classes that are DI-constructed; `@inject(<token>)` constructor params;
   - `this.code.l10n.t(...)` for user-facing strings; bracketed `IOutputChannel` logs for developer output;
   - `stringifyError()` in catch clauses; `void`-prefixed fire-and-forget promises;
   - case-insensitive-vs-constant comparisons for ARM `type`/`logicalType`;
   - the **minimum public surface**: members are `private` unless something outside the class calls them.
3. **Wire it up:**
   - Commands -> `registerManagedCommand(container, 'vscode-azure/<product>/<name>', Cmd[, ...prefixArgs])`.
   - Providers -> add to the correct `dataProviders`/`viewProviders` array in `registerTrees.ts`, **before**
     the generic fallback.
   - Client wrappers -> re-export from `packages/azutils/src/index.ts`; bind the factory in `extension.ts`.
   - Wizard steps -> resolved from the container in the command; implement the provisioning choice recorded
     during mapping. For an AVM module, add the consumer template descriptor and pinned registry reference.
     For the two-file fallback, extend the generation abstraction to copy both the consumer and AVM-shaped
     local module with their relative paths intact. See [avm-provisioning.md](avm-provisioning.md).
4. **Contribute to the manifest:** add commands/menus/settings/debuggers to `package.json`, strings to
   `package.nls.json` (`%key%`). Every new `activationEvents` entry must clear the **activation budget** below.
   For the node icon, **reuse the matching SVG already in
   `packages/azutils/resources/azureIcons/`**; only when none matches, add a new SVG **to the azutils
   package** named `<logicalType>.toLowerCase()+'.svg'`. Confirm each menu `when` uses
   `viewItem =~ /\b<contextValue>\b/i` and matches the **assembled** `contextValue`.
5. **Validate** (smallest scope that covers the slice):
   - `pnpm --filter <package> run lint -- <changed paths>` (add `--cache` to iterate faster).
   - `pnpm --filter <package> run build` (or use the watch task while iterating).
   - `pnpm --filter <package> run test` for the touched package.
   - Escalate to repo-wide `pnpm run lint|build|test` only when a slice touches shared surfaces or targeted
     runs pass but you need a final green.
6. **Tick the checkbox** in `MIGRATION-PLAN.md` and move to the next slice. Keep the plan honest — if a
   slice reveals new work, add a task rather than silently expanding an existing one.

> Migrations are long-lived branches. After every rebase or merge from `main`, run the
> [drift protocol](sequencing.md#branch-drift-protocol-long-lived-migrations) — the shared primitive you
> needed last month may exist now.

## Activation budget

Every user of the extension pays for what one product adds to activation, including the users who never touch
that product. Activation is a budget, not a list.

- **Default to no new `activationEvents` entry.** A command contributed in `package.json` already activates
  the extension when it is invoked. Any entry you do add is justified in the mapping record, in one line.
- **`workspaceContains:` globs are the expensive ones.** Never add an unbounded `**/...` glob. If a glob is
  genuinely required, bound its depth and state what work cannot wait for a user gesture.
- **Do not carry over the source's debug activation** (`onDebugDynamicConfigurations`,
  `onDebugInitialConfigurations`, `onDebugResolve:*`) — those activate the whole extension for debugging that
  has nothing to do with the product. They need an explicit human decision, recorded in triage.
- **No eager probes.** CLI-presence checks, CLI version checks, auth/`getSession` calls, and workspace scans
  do not belong at activation. Defer each to the first product command that needs it, and report a missing CLI
  or a failed sign-in *there* — never as an unsolicited startup warning to a user who does not use the product.
- Anything that must run at activation registers cheaply (a provider, a lazily-constructed service) and does
  its real work on first use.

## External facts must be verified

Anything the migration writes as authority about the world outside this repo must be checked against a real
source before it is written, and the source recorded in the mapping record.

**The citation travels with the claim.** A source recorded only in a scratch mapping record does not help the
reader or the reviewer. When an external fact lands in something that ships — a committed doc, a PR
description, a code comment, an error message — link the authoritative source next to it. A true claim with no
citation still costs a review round-trip, because the reviewer's only move is to ask.

| Claim | Verify against |
|-------|----------------|
| A CLI minimum-version gate | the tool's release notes / changelog / repo history for the release that actually introduced the subcommand or flag — not the current version |
| A config-file or schema name (`azure.yaml`, a workflow file) | the owning tool's docs or repo |
| A package name, registry id, or module path | the registry entry |
| A URL in a command, doc, or error message | fetch it |
| "An asset for this already exists" | list the directory and confirm the file |

**Never invent an asset.** Before adding an SVG, template, or schema, list the directory it would live in and
confirm nothing correct already ships — resource icons in particular are almost always already present in
`packages/azutils/resources/azureIcons/`. Add a version gate only when a real lower bound was found; an
unverified gate blocks users for no reason and is worse than no gate.

## Documentation output

- **Product documentation goes in `docs/products/<product>.md`.** Do not create a new top-level `docs/` file
  for a migrated product.
- **Framework docs stay framework-level.** `docs/architecture.md`, `docs/dependency-injection.md`,
  `docs/conventions.md`, `docs/resource-creation.md`, `docs/tree-views.md` and friends describe patterns, not
  products. At most add a one-line link to the product doc; never append a product-specific section, service,
  or example to them.
- **Prefer links over inlined detail.** Symbol lists, service tables, and copied code snippets drift the
  moment the code moves. Link to the file or the pattern doc instead of restating it.
- **When you touch an existing doc, delete the stale prose** instead of appending a correction beside it, and
  do not add lines that restate what the surrounding text already says
  (`.github/copilot-instructions.md`, comment/doc hygiene).

## Tests

Test the behavior a slice adds. `.github/copilot-instructions.md` and `docs/testing.md` are the contract; the
shapes below are the ones migrations produce most often, and they are rejected:

| Banned shape | Why |
|--------------|-----|
| Manifest-completeness / contribution-inventory tests ("every command is registered", "every menu exists") | wiring does not regress accidentally; the test just restates `package.json` |
| DI-registration and product-registrar wiring tests ("the container resolves X", "the registrar registered Y") | asserts the framework, not the feature |
| Constant-vs-constant (`expect(SomeConst).to.equal('literal')`) and snapshot-style literal object/array shapes | fails only when someone deliberately edits the value |
| `contextValue` string assertions | same — the contract is exercised by the commands that consume it |
| Tests asserting removed behavior stays removed | passes trivially forever and keeps the deleted concept alive |

The narrow exception is a genuine **cross-boundary consistency check** that reads *both* sides and compares
them (a `package.json` command id vs. its registration; an icon filename vs. its `logicalType`). Two
independent sources can drift; an assertion against a hardcoded literal cannot.

- Mirror the precedent's test style. Label root `describe` blocks with `(unit)` / `(integration)` **after**
  the name.
- **Reuse existing test helpers** before hand-rolling — the sweep above applies to fixtures too. Entity
  fixtures: `make*` factories from `@microsoft/vscode-azure-azutils/testing`. Tree/provider fixtures:
  `createMock*DataItemTree` (including the paged variant — do not write a local `singlePage` helper),
  `createMockViewItemTree`, `createMockAccountDataProvider`. VS Code/context: `createMockVsCode()` /
  `createMockCodeContext()`. Paging drains: `collectPages` / `collectPageItems` / `collectAsync`. Settings:
  `withSettings(...)`. Use real `ActionExecutor` + `NullTelemetryReporter` and real `createActionContext()`.
- Prefer Node's `mock` framework (`mock.fn()`, `mock.method()`); assert via `.mock.calls`; `mock.restoreAll()`
  in `afterEach`.
- Test Azure SDK clients with `MockHttpClient` injected via the client's `create()` options.
- Never widen a member from `private` to make a test reach it — test through the public entry point.

## Dependencies

If a slice needs a new dependency: shared across packages -> add to the `catalog:` in `pnpm-workspace.yaml`
and reference with `"catalog:"`; single-package -> a direct version in that `package.json`. Then
`pnpm install` and rebuild.

## Discipline

- **No source-code copy-paste.** If you find yourself pasting a class from the source extension, stop and
  re-derive it against the precedent.
- **One slice green before the next.** Don't accumulate broken intermediate states across many files.
- **Stay inside the disposition.** Only build what the signed triage said to build; surface anything new to
  the human instead of quietly adding scope.
- **Expose the minimum surface.** Fields and methods are `private` unless a caller outside the class needs
  them. Exposing an internal cache, tree handle, or enrichment promise "for convenience" is a review blocker.
- **Prefer platform and shared error types.** Throw `CancellationError` for user cancellation — telemetry
  already classifies it — instead of inventing an outcome enum or a bespoke result union to signal it.
- **Name by what differs.** Do not ship parallel helpers whose names don't say how they differ
  (`resolveClient` / `getClient` / `resolveEnvironment`). Collapse them into one, or rename so the distinction
  is in the name.
- **Generalize shared contracts symmetrically.** When a slice widens a shared type, context, or interface that
  an already-migrated product also uses, make the new member **required** and update that product in the same
  change. No previously migrated product may stay the implicit default case behind an optional field.
