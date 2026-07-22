# Pattern Mapping Playbook

For each feature the human dispositioned **Migrate**, **Adapt**, or **Reuse**, pick its target pattern and exact file
location here. This is the translation table from "source feature kind" to "monorepo implementation". Pair
it with [target-patterns.md](target-patterns.md) (concrete paths + snippets) and
[does-not-map.md](does-not-map.md) (why the shape changes).

## The mapping table

| Source feature kind | Target pattern | Where it lands | Notes / gotchas |
|---------------------|----------------|----------------|-----------------|
| `registerCommand` callback acting on a node | `ManagedCommand` class with static `ContextValue` | `commands/<product>/<Name>.ts` + `registerCommands.ts` + `package.json` menu with regex `when` | Use `IResourceSelector` for "node-or-pick"; telemetry/errors are automatic |
| Palette-only command | `ManagedCommand` (no `ContextValue`) | `commands/<product>/<Name>.ts` + `registerCommands.ts` + `package.json` command | Add `category` for palette grouping |
| One command, several fixed variants | one `ManagedCommand` + `prefixArgs` | multiple `registerManagedCommand(..., arg)` calls | e.g. per `AzdJob`, per mode |
| Create / deploy / provision command | azd+Bicep wizard | `commands/<product>/Create<Product>.ts` + steps + Bicep template | **Adapt** — see [does-not-map.md](does-not-map.md) #1; register twice (`createNew`/`deploy`) |
| Tree parent/leaf node type | `DataProvider` branch + `ViewProvider` branch + type guard | `tree/resources/<product>/` (`<Product>DataProvider.ts`, `<Product>ViewProvider.ts`, `<Product>.ts`) | Register in `registerTrees.ts` specific-before-generic |
| Computed / grouping node (e.g. "App Settings") | **virtual node** in `DataProvider.getChildren` | same `DataProvider` | View provider renders it; give it a stable virtual key + own `contextValue` |
| Node `contextValue` string(s) | assembled via `combineContextValues(...)` from command `ContextValue`s | `ViewProvider.getTreeItem` | Re-derive **fresh** `ContextValue`s from the command set (do **not** reuse source literals — see naming policy below); gate each in `package.json` with `\b...\b` regex |
| Status/`invalid*` node variants | conditional `contextValue` + icon in `ViewProvider` | `ViewProvider.getTreeItem` | Inventory lists exact variants; preserve the *set of states* (re-derive fresh strings) so every `when` clause still has a match |
| Node icon | `logicalType`-named SVG | `packages/azutils/resources/azureIcons/<logicalType>.svg` | Filename must be `<logicalType>.toLowerCase()+'.svg'` or it silently vanishes |
| Direct `@azure/arm-*` client use | azutils client wrapper | `packages/azutils/src/rest/clients/<Product>Client.ts` (+ re-export, + factory in `extension.ts`) | Consumers import from `@microsoft/vscode-azure-azutils`, never `@azure/*` |
| App settings / connection strings | **Migrate** — rebuild against the Functions app-settings precedent (no shared package yet) | product's settings client + app-settings virtual node | Rebuild against the precedent; don't port source, and it's **not** wire-only Reuse. See [does-not-map.md](does-not-map.md) #5 |
| Sign-in / accounts / subscriptions / filtering | **Reuse** existing account provider + `Select Subscriptions` | `extension.ts` wiring only | Don't rebuild |
| "Open in portal" / resource-group grouping | **Reuse** generic commands + `AzureResourceDataProvider`/`GenericAzureViewProvider` | `combineContextValues(OpenInPortal.ContextValue, ...)` | Add the generic `ContextValue`s to your view items |
| Setting (`configuration`) | `package.json` `contributes.configuration` + read via config service | `package.json` + consuming code | Migrate only settings whose feature is kept; localize `description`/enum labels |
| Wizard prompt step (source `AzureWizardPromptStep`) | `PromptStep` subclass | `commands/<product>/steps/PickXStep.ts` | Check hydration flags (`hasInfra`) to skip when IaC exists; `@injectable`, resolved from container |
| Wizard execute step (ARM work) | azd execute step (Generate*/Azd*) | `azd/wizard/` (reuse) | **Adapt** — no hand-written ARM; see [does-not-map.md](does-not-map.md) #1 |
| Framework detection / build presets | azd detection or a create-wizard `PromptStep` | `commands/<product>/steps/` or drop | Judgment call in triage |
| Debug provider / `debuggers` contribution | keep / adapt / drop | `package.json` + provider | Judgment call; confirm platform doesn't own it |
| Task provider / `taskDefinitions` / `problemMatchers` | keep / adapt / drop | `package.json` + provider | Keep only if the workflow still needs it |
| CLI process lifecycle / emulators | workspace-view emulator model or drop | `tree/workspace/...` | Map to `EmulatorsWorkspaceDataProvider` shape or drop |
| Exported extension API (e.g. `RemoteRepoApi`) | usually **Drop**/**Defer** | — | Only migrate if a monorepo consumer needs it |
| Orphan/dead NLS key or contribution | **Drop** | — | Never migrate |

## Per-feature mapping record

For each Migrate/Adapt feature, capture a short record (feeds `MIGRATION-PLAN.md`):

```
Feature:        <inventory id/name>
Disposition:    Migrate | Adapt | Reuse   (from signed triage)
Pattern:        <row from the table above>
Target file(s): <exact paths>
Precedent:      <file to copy the shape of>
Tree contract:  <contextValue(s) + package.json when clause>   (if applicable)
Wizard:         <ordered prompt/execute steps + AzdJob + Bicep template>  (if applicable)
Client:         <azutils wrapper + SDK types to re-export>      (if applicable)
Reuse:          <existing symbol/command to wire> + <where it's wired> + <how to verify it's wired>   (required for Reuse rows)
Open questions: <anything to confirm with the human>
```

## Defining the tree contract precisely

Because `contextValue` -> `when` is the command/node binding, get it exact:
1. From the inventory, list every `contextValue` a node carries (incl. status + `invalid*` variants).
2. For each command acting on that node, create/confirm its static `ContextValue`.
3. `ViewProvider.getTreeItem` sets `item.contextValue = combineContextValues(...)`.
4. `package.json` menu entry gates with `viewItem =~ /\b<contextValue>\b/i` (word boundaries — required).
5. Verify the regex matches the *assembled* value, not the source's literal string.

### contextValue naming policy (do NOT preserve source literals)

The monorepo **assembles** a node's `contextValue` from the static `ContextValue` of each command that acts
on it (via `combineContextValues`), plus any node-intrinsic values. It does **not** reuse the source
extension's literal contextValue strings (e.g. `azureStaticWebApp`, `azureStaticWebAppEnvironment`).

- The new extension ships a **new manifest**, so there is **no back-compat requirement** to keep old strings.
- Name new `ContextValue`s to fit monorepo convention, driven by the *command set*, not the old literal.
- Use the inventory's source contextValues only to reconstruct the **`when`-clause matrix** (which commands
  appear on which node, incl. status/`invalid*` variants) — then re-derive fresh values. Preserve the
  *shape* (the set of behaviors per node state), not the exact strings.
- The one thing to carry verbatim is the **word-boundary regex discipline** in `package.json`.
