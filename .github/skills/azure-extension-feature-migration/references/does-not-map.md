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
- Execute steps become `GenerateBicepStep` (copies a bundled template + writes `main.parameters.json`),
  `GenerateAzureYamlStep`, `CreateAzdEnvStep`, `AzdProvisionStep`, and (for the deploy job) `AzdDeployStep`
  + `ShowEndpointUrlStep`. You do **not** write ARM-deploy execute steps.
- Infrastructure follows the mandatory [AVM-first decision process](avm-provisioning.md): search the
  current AVM repository before authoring Bicep. A single-resource topology may use a suitable AVM
  resource module; a topology with supporting resources requires a suitable AVM pattern module.
- When no suitable AVM module exists, bundle exactly two Bicep entry points: one AVM-shaped local module
  that owns the topology and one thin consumer that invokes it. Extend `GenerateBicepStep` (and its
  template descriptor/factory contract) to copy both files with their relative paths intact. Do not
  collapse the fallback into one monolithic file merely to work around the current generator's
  single-file limitation; extend the generator instead.

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
- Both are registered in `registerTrees.ts`, **specific before generic**, so dispatch order matters.
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
a static `ContextValue` if it acts on a tree item, registered with `registerManagedCommand(...)`. Telemetry
and error handling are automatic (the registry wraps `execute`). Resource selection uses `IResourceSelector`
(key from the tree, or prompt from the palette) — don't hand-roll the "node or pick" branch.

---

## 4. Azure SDK usage -> azutils client wrappers

**Source shape:** the extension imports `@azure/arm-*` clients directly throughout its code.

**Target shape:** every Azure SDK client is wrapped in `packages/azutils/src/rest/clients/<Product>Client.ts`
with an `I<Product>Client` interface, an `I<Product>ClientProvider` factory service identifier, and a static
`create()`. Consumers **never** import `@azure/*` directly — the wrapper re-exports any SDK types it exposes,
and the extension imports from `@microsoft/vscode-azure-azutils`. The client is provided per-subscription via
a DI factory binding in `extension.ts`. Don't re-vendor the source's client code.

---

## 5. Solved generically (auth, "open in portal", resource groups, app settings -> Reuse)

These are solved generically in the monorepo. If the source has them, **wire up the existing
implementation** rather than re-vendoring the source's code:

- **Application settings / connection strings** — there **is** a shared settings framework
  (`docs/settings.md`). Do **not** build product-specific settings trees, commands, or an editor.
  Implement a single `SettingsAdapter` (`canHandle` / `getCollections` / `getCapabilities` / `read` /
  `write`) in `extensions/vscode-azure/src/settings/adapters/`, bind it to `ISettingsAdapter` in
  `registerSettings.ts`, and stop. The collection tree node, the per-setting nodes, the JSONC editor,
  shared commands, and value masking all follow automatically from the `SettingsCapabilities` the
  adapter reports. Local configuration synchronization belongs to azd or the product's deployment
  workflow, not this framework.
  - Product differences are expressed as **capability flags** (`canAdd`, `canDelete`, `canRename`,
    `canWrite`, `valuesReadable`), never as branches on product identity. A product that forbids
    renaming returns `canRename: false`; a product whose service will not return values returns
    `valuesReadable: false` and gets sentinel preservation for free.
  - A collection whose entries carry side-channel data (e.g. a connection string's `type`) sets
    `structured: true` and puts that data in each entry's `metadata`.
  - (Note: the source likely uses the shared `@microsoft/vscode-azext-azureappsettings` package with
    `contextValuesToAdd: ['<product>']`. That azext package is **not** the monorepo pattern; the
    inventory should record which operations the product supports, which becomes its capability
    flags.)
- **Sign-in, accounts, tenants, subscriptions, subscription filtering** — the account data provider +
  `Azure: Select Subscriptions`.
- **Open in portal, resource-group grouping** — generic commands + `AzureResourceDataProvider` /
  `GenericAzureViewProvider`.

> All of the above are true **Reuse**: wire straight to an existing generic command, provider, or
> extension point. For app settings the only new code is the adapter itself. Say so in the mapping
> record, so the implementer does not rebuild a settings UI that already exists.

> **Tree dispatch caveat.** `ProviderRegistry` dispatches to the first `canHandle` match, so a
> product `DataProvider` that claims a resource in order to add its own children takes that resource
> away from the generic provider that would otherwise emit its settings node. Such a provider must
> compose `ISettingsDataProvider.getCollectionNodes(resource)` into what it returns. A product with
> no children beyond settings needs **no** data or view provider at all.

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
