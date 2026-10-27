# Features That Don't Map 1:1

The target extension is a redesign. These source patterns must be **adapted**, not ported. When you see one
during triage, recommend **Adapt** (or **Reuse** / **Drop**) and cite the reason here. This list is the
antidote to the instinct to copy source code.

---

## 1. Deployment & provisioning -> azd + Bicep

**Source shape:** a "Create / Deploy" command opens an `AzureWizard` whose execute steps build ARM
templates or call ARM resource clients directly to create the resource, then poll ARM for completion.

**Target shape:** deployment and provisioning are delegated to the **Azure Developer CLI (`azd`)** with
**Bicep** infrastructure-as-code. There is **no hand-written ARM deployment**.

What changes:
- The command becomes a `ManagedCommand` that assembles an azd wizard and is registered **twice** with
  `prefixArgs` — once per `AzdJob` (`'createNew'` vs `'deploy'`). See `docs/resource-creation.md`.
- Prompt steps become the shared azd steps (`SelectIacFolderStep`, `HydrateAzdInfoStep`,
  `HydratableChooseSubscriptionStep`, `HydratableChooseLocationStep`, `ProjectNameStep`) **plus** your
  resource-specific prompt steps (framework, SKU, runtime, etc.). Resource-specific steps check hydration
  flags (`hasInfra`) to skip when IaC already exists.
- Execute steps become `GenerateBicepStep` (copies a bundled template directory + writes `main.parameters.json`),
  `GenerateAzureYamlStep`, `CreateAzdEnvStep`, `AzdProvisionStep`, and (for the deploy job) `AzdDeployStep`
  + `ShowEndpointUrlStep`. You do **not** write ARM-deploy execute steps.
- Infrastructure follows the mandatory [AVM-first decision process](avm-provisioning.md): search the
  current AVM repository before authoring Bicep. A single-resource topology may use a suitable AVM
  resource module; a topology with supporting resources requires a suitable AVM pattern module.
- When no suitable AVM module exists, bundle exactly two Bicep entry points: one AVM-shaped local module
  that owns the topology and one thin consumer that invokes it. `GenerateBicepStep` copies the whole
  selected template directory, preserving module-relative paths. Use its existing factory contract.

**Outputs change too.** The source wizard's output (a live ARM resource + maybe a `.vscode` config) becomes
IaC files in the workspace (`azure.yaml`, `infra/main.bicep`, `main.parameters.json`) plus an azd
environment, and provisioning runs as a foreground VS Code task. The scenario matrix (Fresh / Post-clone /
Bootstrapped) governs which prompts and steps run — mirror it, don't reinvent it.

**Deployment tracking:** `AzdProvisionStep` sets `AZD_DEPLOYMENT_ID_FILE`; azd writes ARM deployment IDs as
JSONL; polling registers them with the ARM-deployment data provider so progress shows in the **Activity
view**. Reuse this — do not build a custom progress/notification path.

**GitHub / repo bootstrap is a separate human decision.** Some source create flows bundle non-provisioning
work into the wizard: creating a GitHub repo, pushing, wiring a deploy workflow, and polling a GitHub Action
after create. `azd` owns *provisioning*, not this repo/CI bootstrap. Do **not** silently carry the source's
GitHub bootstrap into the azd wizard, and do **not** silently drop it either. In triage, surface it as an
explicit decision: keep it (as a separate Git/GitHub service step outside provisioning), defer it, or drop
it in favor of an azd-first UX. Flag it as an open question in the feature's mapping record.

### Prompt budget

A wizard's prompt count is a UX cost, and the azd+Bicep target is supposed to *reduce* it. A migrated wizard
whose step list survived nearly intact is a signal the adaptation never happened.

- **Ask only for what cannot be defaulted or detected.** Everything else gets a sensible default written into
  the generated Bicep, which advanced users edit afterwards. Editable IaC replaces an interrogation.
- **No "advanced" command variant.** One create command. Do not contribute a second "... (Advanced)" command,
  a mode flag, or a basic-vs-advanced branch, even if the source had one — the source's advanced deltas become
  Bicep parameters, not extra prompts.
- **Express conditionality with `shouldPrompt` / `shouldExecute` on the step**, never by assembling different
  step arrays per mode. The step list is static; each step decides whether it applies.
- Use the [UX and behavioral contract](pattern-mapping.md#ux-and-behavioral-contract) to justify each
  retained prompt and specify persistence, precedence, cancellation/back behavior, and write timing.

---

## 2. Tree views -> DataProvider / ViewProvider registries

**Source shape:** an `AzExtParentTreeItem` / `AzExtTreeItem` class hierarchy where each node class knows how
to fetch its own children (`loadMoreChildrenImpl`), render itself, and carries its own `contextValue`.

**Target shape:** the tree is split into a **data layer** and a **view layer**, each a registry of
providers dispatched by `canHandle()` (`docs/tree-views.md`). The workspace view and the Azure resource
view are conceptually the same as the source (a local view + an Azure view) but are built completely
differently:

- **`DataProvider<T>`** — `canHandle()` + `getChildren()` (+ optional `enrich()` for background hydration).
  Fetches and caches; returns plain resource objects, including **virtual nodes** for computed categories
  (e.g. a "Settings" grouping under a resource). No rendering here.
- **`ViewProvider<T>`** — `canHandle()` + `getTreeItem()` + `getChildren()` + `getParent()`. Renders labels,
  icons, and `contextValue` (via `combineContextValues(...)`). Must **not** mutate data.
- **The boundary runs both ways.** The view layer must not mutate data, *and* the data layer must not carry
  presentation. A data provider may carry intrinsic domain data and compute **state** (ARM `name`, status
  values, flags, counts), but it must not compute a formatted/derived display string, tree-item
  description/tooltip text, icon id, or `contextValue`, or stash one on a resource for the view to read.
  Turning state into words or pixels is the view provider's job.
- Resource providers are registered through `ProductRegistrar`; `registerProducts.ts` orders products
  **specific before generic**. Workspace/activity providers use `registerTrees.ts` arrays.
- `contextValue` is no longer authored on a node class — it is assembled from each acting command's static
  `ContextValue`, and gated in `package.json` by a **regex `when`** with word boundaries.

So a source node type does not become "a node class". It becomes: a resource type guard, a branch in a
`DataProvider`, a branch in a `ViewProvider`, and (per action) a `ManagedCommand` with a `ContextValue`.

**Icons** resolve by convention from the resource's `logicalType` — a filename mismatch silently shows no
icon (`docs/tree-views.md`, Resource Icons). Don't port the source's icon-path wiring. **First check whether
the correct icon already ships in `packages/azutils/resources/azureIcons/`** (a shared library keyed by ARM
namespace, e.g. `microsoft.web`, `microsoft.storage`) and reuse it — most resource types are already
covered. **Only add a new SVG when no correct icon exists**, and add it to the **azutils** package (not the
extension), named `<logicalType>.toLowerCase()+'.svg'`. Do not add an icon just because the source shipped
one.

---

## 3. Commands -> ManagedCommand classes

**Source shape:** `registerCommand('ext.doThing', async (context, node) => { ... })` callbacks, often with
the logic inline.

**Target shape:** an `@injectable()` class implementing `ManagedCommand`, dependencies via `@inject`,
a static `ContextValue` if it acts on a tree item, contributed with `registrar.registerCommand(...)`. Telemetry
and error handling are automatic (the registry wraps `execute`). Resource selection uses `IResourceSelector`
(key from the tree, or prompt from the palette) — don't hand-roll the "node or pick" branch.

---

## 4. Azure SDK usage -> azutils client wrappers

**Source shape:** the extension imports `@azure/arm-*` clients directly throughout its code.

**Target shape:** every Azure SDK client is wrapped in `packages/azutils/src/rest/clients/<Product>Client.ts`
with an `I<Product>Client` interface, an `I<Product>ClientProvider` factory service identifier, and a static
`create()`. Consumers **never** import `@azure/*` directly — the wrapper re-exports any SDK types it exposes,
and the extension imports from `@microsoft/vscode-azure-azutils`. The client is provided per-subscription via
`ProductRegistrar.registerAzureClientProvider(...)` in the product's registration function.
Don't re-vendor the source's client code.

---

## 5. Solved generically (auth, "open in portal", resource groups, application settings -> Reuse)

These are solved generically in the monorepo. If the source has them, **wire up the existing
implementation** rather than re-vendoring the source's code:

- **Application settings** — there **is** a shared settings framework (`docs/settings.md`). Do **not**
  build product-specific settings trees, commands, or an editor. Implement a single `SettingsAdapter`
  (`label` / `canHandle` / `read` / `write`) in
  `extensions/vscode-azure/src/settings/adapters/`, bind the concrete adapter in that product's
  registrar, and pass it to `getSettingsNodes(resource, adapter)` from the product data provider.
  The settings virtual-node behavior, JSONC editor, and edit command are shared. Local configuration
  synchronization belongs to azd or the product's deployment workflow, not this framework.
  - There is one command and one surface: a resource's settings are edited as a single document.
    There are no per-setting add/edit/rename/delete commands, and no values are shown in the tree.
- **Sign-in, accounts, tenants, subscriptions, subscription filtering** — the account data provider +
  `Azure: Select Subscriptions`.
- **Open in portal, resource-group grouping** — generic commands + `AzureResourceDataProvider` /
  `GenericAzureViewProvider`.

> All of the above are true **Reuse**: wire straight to an existing generic command, provider, or
> extension point. For application settings the product adds the adapter and thin resource-provider
> composition, not a settings UI. Say so in the mapping record, so the implementer does not rebuild
> a settings UI that already exists.

> **Tree dispatch caveat.** `ProviderRegistry` dispatches to the first `canHandle` match, so a
> product `DataProvider` that claims a resource owns all of its children. It composes settings
> explicitly with `getSettingsNodes(resource, adapter)`; providers are never aggregated. Its
> corresponding view provider must render the resource as expandable.

---

## 6. Debuggers, tasks, framework detection, CLI lifecycle -> judgment

These are the least mechanical. Never assume — for each, apply this decision matrix **with the human** and
record the outcome + rationale in triage:

| Source surface | Recommend **Drop** when... | Recommend **Adapt** when... | Recommend **Defer** when... |
|----------------|----------------------------|-----------------------------|-----------------------------|
| Debug provider / `debuggers` contribution | generic VS Code debugging already covers the scenario | product needs a bespoke launch/resolve flow that still applies | it depends on a workspace/emulator model not yet in the monorepo |
| Task provider / `taskDefinitions` / `problemMatchers` | the task workflow is obsolete or platform-owned | the workflow is still needed but must use monorepo process/service patterns | it depends on a deferred debug/CLI feature |
| Framework detectors / build presets | azd's own detection replaces it | it usefully feeds a create-wizard `PromptStep` or task generation | the create wizard it feeds is deferred |
| CLI process lifecycle (spawn/kill on debug, emulators) | the platform provides the emulator/runtime | it maps onto the workspace view's emulator model | the emulator model isn't ready |

Default posture: these product-specific dev-loop features are usually **Adapt** (rebuild on monorepo
patterns) or **Drop** (platform owns it) — rarely a straight **Migrate**. Because they are the highest-risk
product calls, they **always** need explicit human confirmation, not a silent recommendation.

---

## 7. Dead / orphan surfaces -> Drop

Anything the inventory marked DEAD (orphan NLS keys, contributions with no backing behavior, deprecated
commands) is a **Drop**. Do not migrate it "just in case".

---

## 8. Ownership boundaries — what we don't own

Some source behavior is not ours to reimplement at all. Migrating it means owning code written against
someone else's contract, which then breaks when that contract moves. Recognize these during triage and
recommend **Drop**, **Defer**, or an upstream contribution.

Apply the [ownership/capability gate](pattern-mapping.md#ownership-and-capability-gate) before design:
check VS Code, the owning language extension, the supported product CLI/Core Tools, and azd rather
than assuming this extension must orchestrate build, scaffolding, debug/setup, or deployment.
Any new surface must provide incremental value beyond F5, ordinary file editing, or shared deployment.

**`azure.yaml` is azd's file.** Do not author, template, patch, or parse it. `GenerateAzureYamlStep` is the
one sanctioned writer, and it exists to hand azd a starting point — not to grow into a product-specific
`azure.yaml` editor. If a feature needs a service path, build hook, or host setting expressed there, the fix
is **a contribution to azd**, not a step in this repo that rewrites azd's file. If a feature cannot work
without reading `azure.yaml`, that is an open question for the human, not a parser you write.

**Product and deployment configuration belongs in `azure.yaml`, not VS Code settings.** App/API/output
locations, build commands, and service topology describe the *project*, so they belong in the IaC/azd layer
where every tool can see them. `contributes.configuration` is for *editor* preferences (verbosity, prompt
suppression, enable/disable) only. A source extension that stored project layout in workspace settings did so
because it had nowhere better; we do.

**Scaffolding belongs to its upstream owner.** Build presets, framework-specific project templates, and
config-file generation already supplied by azd, the product CLI/Core Tools, or the language extension
default to **Reuse** / **Drop** / **Defer**, according to verified capability and signed triage.
Framework detection stays only where it feeds a decision we own (a wizard default, a Bicep parameter)
and goes through the monorepo's workspace scanning service and workspace index, not a bespoke walker.

**Never depend on the extension being retired.** This monorepo replaces the per-service extensions, so
migrated code must not call their commands (`azureFunctions.*`, `azureStaticWebApps.*`, ...), list them in
`extensionDependencies`, read their settings or global state, or preserve compatibility with their
contribution ids and `contextValue` literals. If a source feature only works by calling into a sibling
extension, the capability must exist here or the feature is a **Defer** — record which capability is missing.
