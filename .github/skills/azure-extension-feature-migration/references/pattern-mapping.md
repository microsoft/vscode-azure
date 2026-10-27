# Pattern Mapping Playbook

For each feature the human dispositioned **Migrate**, **Adapt**, or **Reuse**, pick its target pattern and exact file
location here. This is the translation table from "source feature kind" to "monorepo implementation". Pair
it with [target-patterns.md](target-patterns.md) (concrete paths + snippets) and
[does-not-map.md](does-not-map.md) (why the shape changes).

## Ownership and capability gate

Before designing a retained feature, identify what VS Code, the owning language extension,
the product CLI/Core Tools, azd, and this extension each own (mark non-applicable owners).
Verify relevant capabilities against the **supported upstream version**, using its docs,
source/release history, or a reproducible probe. Record the version and evidence before
designing around an assumed gap; a source extension's implementation is not proof of one.

Delegate existing upstream build, scaffolding, deployment, debug/setup, and configuration
workflows to their owners. Use the extension only for the missing integration/value it
actually owns, reusing monorepo primitives. If required capability is unavailable, record
the gap and seek a human decision on adaptation, deferral, or upstream work rather than
silently adding a replacement orchestrator.

## UX and behavioral contract

For **every retained feature**, including Reuse, compare the source contract to the proposed
target contract, not just command names. Record entry points; availability guards; local/cloud
side effects; result semantics; failure and cancellation behavior; and approved adaptations.
Check semantic distinctions such as invoking an admin endpoint versus an HTTP route,
deletion on package-backed/read-only resources, and an actionable link versus informational
text. Surface any difference outside signed triage for explicit human approval before coding.

Justify each new command, editor, or prompt by its incremental value over F5, ordinary file
editing, and shared deployment. Prefer those existing surfaces when they already satisfy
the contract. For each prompt, specify whether the choice is launch-only or persisted,
where it lives if persisted, precedence over detection/config/defaults, cancellation/back
behavior, and exactly when writes occur. Persistence is a decision, not a requirement for
every prompt. Feed these contracts into [per-slice verification](verification.md#behavioral-contract-check-per-slice).

## The mapping table

| Source feature kind | Target pattern | Where it lands | Notes / gotchas |
|---------------------|----------------|----------------|-----------------|
| `registerCommand` callback acting on a node | `ManagedCommand` class with static `ContextValue` | `commands/<product>/<Name>.ts` + product registrar + `package.json` menu with regex `when` | Use `IResourceSelector` for "node-or-pick"; telemetry/errors are automatic |
| Palette-only command | `ManagedCommand` (no `ContextValue`) | `commands/<product>/<Name>.ts` + product registrar + `package.json` command | Add `category` for palette grouping |
| One command, several fixed variants | one `ManagedCommand` + `prefixArgs` | multiple `registrar.registerCommand(..., arg)` calls | e.g. per `AzdJob`, per mode |
| Create / deploy / provision command | azd+Bicep wizard + AVM-first module selection | `commands/<product>/Create<Product>.ts` + steps + Bicep consumer (and local module only as fallback) | **Adapt** — see [does-not-map.md](does-not-map.md) #1 and [avm-provisioning.md](avm-provisioning.md); register twice (`createNew`/`deploy`); obey the **prompt budget** — sensible defaults + editable Bicep, one command (no "advanced" variant) |
| Tree parent/leaf node type | `DataProvider` branch + `ViewProvider` branch + type guard | `tree/resources/<product>/` (`<Product>DataProvider.ts`, `<Product>ViewProvider.ts`, `<Product>.ts`) | Resource providers via product registrar, specific-before-generic; workspace/activity via `registerTrees.ts` |
| Computed / grouping node (e.g. "Settings") | **virtual node** in `DataProvider.getChildren` | same `DataProvider` | View provider renders it; give it a stable virtual key + own `contextValue`. For settings specifically, use the shared framework instead — see [does-not-map.md](does-not-map.md) #5 |
| Node `contextValue` string(s) | assembled via `combineContextValues(...)` from command `ContextValue`s | `ViewProvider.getTreeItem` | Re-derive **fresh** `ContextValue`s from the command set (do **not** reuse source literals — see naming policy below); gate each in `package.json` with `\b...\b` regex |
| Status/`invalid*` node variants | conditional `contextValue` + icon in `ViewProvider` | `ViewProvider.getTreeItem` | Inventory lists exact variants; preserve the *set of states* (re-derive fresh strings) so every `when` clause still has a match |
| Node icon | reuse existing `logicalType`-named SVG; add only if missing | `packages/azutils/resources/azureIcons/<logicalType>.svg` | **Reuse the icon already in azutils if one matches** — most do. Add a new SVG (to azutils) only when none exists; filename must be `<logicalType>.toLowerCase()+'.svg'` or it silently vanishes |
| Direct `@azure/arm-*` client use | azutils client wrapper | `packages/azutils/src/rest/clients/<Product>Client.ts` (+ re-export, + product `registerAzureClientProvider`) | Consumers import from `@microsoft/vscode-azure-azutils`, never `@azure/*` |
| Application settings / connection strings | **Reuse** — implement one `SettingsAdapter` and bind it; the shared settings framework supplies the tree, editor, and commands | `settings/adapters/<Product>SettingsAdapter.ts` + product `registerBinding` + `getSettingsNodes` composition | See [does-not-map.md](does-not-map.md) #5 and `docs/settings.md`; use the actual adapter contract |
| Sign-in / accounts / subscriptions / filtering | **Reuse** existing account provider + `Select Subscriptions` | generic Azure product registration | Don't rebuild |
| "Open in portal" / "browse website" / documentation link / resource-group grouping | **Reuse** the resource-generic commands already in the tree (open-in-portal, browse-website, open-url) | `combineContextValues(OpenInPortal.ContextValue, ...)` | Add the generic `ContextValue`s to your view items. Do not write a product-specific Browse or Show-Docs command |
| Setting (`configuration`) | `package.json` `contributes.configuration` + read via config service | `package.json` + consuming code | Only *editor* preferences belong here. Project/deployment configuration belongs in `azure.yaml` ([does-not-map.md](does-not-map.md) #8). Migrate only settings whose feature is kept; localize `description`/enum labels |
| Wizard prompt step (source `AzureWizardPromptStep`) | `PromptStep` subclass | `commands/<product>/steps/PickXStep.ts` | Gate with `shouldPrompt`/`shouldExecute` — never by conditionally assembling step arrays. Check hydration flags (`hasInfra`) to skip when IaC exists; `@injectable`, resolved from container. Reuse the shared workspace file/folder pick step instead of writing a product-specific one |
| Wizard execute step (ARM work) | azd execute step (Generate*/Azd*) | `azd/wizard/` (reuse) | **Adapt** — no hand-written ARM; see [does-not-map.md](does-not-map.md) #1 |
| Framework detection / build presets | azd detection, or a create-wizard `PromptStep` fed by the workspace scanning service | `commands/<product>/steps/` or drop | Judgment call in triage; azd owns scaffolding ([does-not-map.md](does-not-map.md) #8). Never walk the workspace directly — add a rule to the detector / use the workspace index |
| Config-file scaffolding or parsing (`azure.yaml`, tool config) | usually **Drop**/**Defer** | — | We do not author or parse files another tool owns; contribute upstream instead ([does-not-map.md](does-not-map.md) #8) |
| Debug provider / `debuggers` contribution | keep / adapt / drop | `package.json` + provider | Judgment call; confirm platform doesn't own it |
| Task provider / `taskDefinitions` / `problemMatchers` | keep / adapt / drop | `package.json` + provider | Keep only if the workflow still needs it |
| CLI process lifecycle / emulators | workspace-view emulator model or drop | `tree/workspace/...` | Map to `EmulatorsWorkspaceDataProvider` shape or drop. Spawning, shell-task creation, and process termination belong to the shared process/task service (`IProcessExecutor`, `createShellTask`) — never product-local |
| Exported extension API (e.g. `RemoteRepoApi`) | usually **Drop**/**Defer** | — | Only migrate if a monorepo consumer needs it |
| Orphan/dead NLS key or contribution | **Drop** | — | Never migrate |

## Per-feature mapping record

For each Migrate/Adapt/Reuse feature, capture a short record (feeds `MIGRATION-PLAN.md`):

```
Feature:        <inventory id/name>
Disposition:    Migrate | Adapt | Reuse   (from signed triage)
Ownership:      <relevant owner -> responsibility; supported version + capability evidence>
Contract:       <source -> target: entry point; guards; side effects; results; failures/cancellation>
Adaptations:    <approved differences + sign-off reference; unresolved decisions block affected work>
UX value:       <increment beyond F5, ordinary file editing, shared deployment>
Pattern:        <row from the table above>
Target file(s): <exact paths>
Precedent:      <file to copy the shape of>
Shared-primitive sweep: reused <symbol> from <package> | searched <terms>, none exists -> new <symbol> at <path>
Activation:     none | <activationEvents entry> + why the work cannot wait for a user gesture
External facts: <claim> verified against <source/URL>            (versions, file/schema names, URLs, assets)
Tree contract:  <contextValue(s) + package.json when clause>   (if applicable)
Prompts:        <need; launch-only/persisted + location; precedence; cancel/back behavior; write timing>
Wizard:         <ordered prompt/execute steps + AzdJob>   (if applicable)
Provisioning:   <topology; AVM search evidence; selected pinned module, or two-file fallback; parameter/output map>
Client:         <azutils wrapper + SDK types to re-export>      (if applicable)
Reuse:          <existing symbol/command to wire> + <where it's wired> + <how to verify it's wired>   (required for Reuse rows)
Verification:   <behavioral scenarios + automated coverage; remaining live scenarios; reuse conditions>
Open questions: <anything to confirm with the human>
```

Record non-applicable fields explicitly. Ownership/capability evidence and the behavioral contract
are required before design; sweep, activation, and external-fact evidence make the implementation
gates reviewable. A matching symbol alone is not evidence that the contract is satisfied.

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
