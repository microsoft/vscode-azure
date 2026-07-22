# Implementation Loop

Build one slice at a time from `MIGRATION-PLAN.md`. For each slice, copy the **shape** of the precedent
product (never the source extension's code), conform to conventions, then validate before moving on.

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
   - case-insensitive-vs-constant comparisons for ARM `type`/`logicalType`.
3. **Wire it up:**
   - Commands -> `registerManagedCommand(container, 'vscode-azure/<product>/<name>', Cmd[, ...prefixArgs])`.
   - Providers -> add to the correct `dataProviders`/`viewProviders` array in `registerTrees.ts`, **before**
     the generic fallback.
   - Client wrappers -> re-export from `packages/azutils/src/index.ts`; bind the factory in `extension.ts`.
   - Wizard steps -> resolved from the container in the command; add the Bicep template name to the
     `BicepTemplateName` union.
4. **Contribute to the manifest:** add commands/menus/settings/debuggers to `package.json`, strings to
   `package.nls.json` (`%key%`), and the icon SVG named `<logicalType>.toLowerCase()+'.svg'`. Confirm each
   menu `when` uses `viewItem =~ /\b<contextValue>\b/i` and matches the **assembled** `contextValue`.
5. **Validate** (smallest scope that covers the slice):
   - `pnpm --filter <package> run lint -- <changed paths>` (add `--cache` to iterate faster).
   - `pnpm --filter <package> run build` (or use the watch task while iterating).
   - `pnpm --filter <package> run test` for the touched package.
   - Escalate to repo-wide `pnpm run lint|build|test` only when a slice touches shared surfaces or targeted
     runs pass but you need a final green.
6. **Tick the checkbox** in `MIGRATION-PLAN.md` and move to the next slice. Keep the plan honest — if a
   slice reveals new work, add a task rather than silently expanding an existing one.

## Tests

- Mirror the precedent's test style. Label root `describe` blocks with `(unit)` / `(integration)` **after**
  the name.
- **Reuse existing test helpers** before hand-rolling. Entity fixtures: `make*` factories from
  `@microsoft/vscode-azure-azutils/testing`. Tree/provider fixtures: `createMock*DataItemTree`,
  `createMockViewItemTree`, `createMockAccountDataProvider`. VS Code/context: `createMockVsCode()` /
  `createMockCodeContext()`. Paging drains: `collectPages` / `collectPageItems` / `collectAsync`. Settings:
  `withSettings(...)`. Use real `ActionExecutor` + `NullTelemetryReporter` and real `createActionContext()`.
- Prefer Node's `mock` framework (`mock.fn()`, `mock.method()`); assert via `.mock.calls`; `mock.restoreAll()`
  in `afterEach`.
- Test Azure SDK clients with `MockHttpClient` injected via the client's `create()` options.
- Don't test that constants equal their literals.

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
