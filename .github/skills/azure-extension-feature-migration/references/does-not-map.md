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
- You **add a Bicep template** to `extensions/vscode-azure/resources/templates/<resource>.bicep` and add
  its name to the `BicepTemplateName` union in `GenerateBicepStep.ts` (resolved via a factory binding).

**Outputs change too.** The source wizard's output (a live ARM resource + maybe a `.vscode` config) becomes
IaC files in the workspace (`azure.yaml`, `infra/main.bicep`, `main.parameters.json`) plus an azd
environment, and provisioning runs as a foreground VS Code task. The scenario matrix (Fresh / Post-clone /
Bootstrapped) governs which prompts and steps run — mirror it, don't reinvent it.

**Deployment tracking:** `AzdProvisionStep` sets `AZD_DEPLOYMENT_ID_FILE`; azd writes ARM deployment IDs as
JSONL; polling registers them with the ARM-deployment data provider so progress shows in the **Activity
view**. Reuse this — do not build a custom progress/notification path.

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
  (e.g. an "App Settings" grouping under a resource). No rendering here.
- **`ViewProvider<T>`** — `canHandle()` + `getTreeItem()` + `getChildren()` + `getParent()`. Renders labels,
  icons, and `contextValue` (via `combineContextValues(...)`). Must **not** mutate data.
- Both are registered in `registerTrees.ts`, **specific before generic**, so dispatch order matters.
- `contextValue` is no longer authored on a node class — it is assembled from each acting command's static
  `ContextValue`, and gated in `package.json` by a **regex `when`** with word boundaries.

So a source node type does not become "a node class". It becomes: a resource type guard, a branch in a
`DataProvider`, a branch in a `ViewProvider`, and (per action) a `ManagedCommand` with a `ContextValue`.

**Icons** resolve by convention from the resource's `logicalType` — a filename mismatch silently shows no
icon (`docs/tree-views.md`, Resource Icons). Don't port the source's icon-path wiring.

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

## 5. App settings, auth, "open in portal", resource groups -> Reuse

These are already solved generically in the monorepo. If the source has them, **wire up the existing
implementation** rather than rebuilding:

- **Application settings / connection strings** — shared app-settings package (base contextValues +
  `contextValuesToAdd: ['<product>']`).
- **Sign-in, accounts, tenants, subscriptions, subscription filtering** — the account data provider +
  `Azure: Select Subscriptions`.
- **Open in portal, copy resource id, resource-group grouping** — generic commands + `AzureResourceDataProvider` /
  `GenericAzureViewProvider`.

---

## 6. Debuggers, tasks, framework detection, CLI lifecycle -> judgment

These are the least mechanical. For each, decide **with the human** whether the platform/monorepo now owns
it, whether it should be re-implemented, or dropped:

- **Debug providers / `debuggers` contributions** — often superseded by generic debugging; confirm intent.
- **Task providers / `taskDefinitions` / `problemMatchers`** — keep only if the workflow still needs them.
- **Framework detectors / build presets** — may fold into azd's own detection or a create-wizard prompt step.
- **CLI process lifecycle** (spawn/kill on debug start/stop, emulators) — map to the workspace view's
  emulator model or drop if the platform provides it.

Never assume — surface the tradeoff in triage.

---

## 7. Dead / orphan surfaces -> Drop

Anything the inventory marked DEAD (orphan NLS keys, contributions with no backing behavior, deprecated
commands) is a **Drop**. Do not migrate it "just in case".
