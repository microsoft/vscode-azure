# Azure Virtual Machines -- Feature Inventory

Source: `microsoft/vscode-azurevirtualmachines` @ `main` (`8bd7051624c452963ae0aec5a2fff0ce835f9dcc`, 2026-10-15), v0.6.12-alpha.0 (last release tag v0.6.11), publisher `ms-azuretools`, extension id `ms-azuretools.vscode-azurevirtualmachines`, `preview: true`.
Method: reconcile `package.json` + `package.nls.json` + code (`activate()` / `registerCommands.ts` / `src/**`) + published docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: collected from `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt` (window: 90d; collected 2026-10-22; 14 emitted event names). Per the repo's telemetry policy the **raw counts are not committed** -- this file carries a qualitative band plus an advisory suggestion. The full-number working copy lives in the session artifacts dir (see [Section 9](#9-usage-summary-telemetry)). Roll-up deeplink: [all events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WSTUskQQyG7%2F0rylN1w4zsVWT2Ii4M7CziqBeRJVZltKA%2BJEn3jOKPN9093eCyl6lbvcn7JKlKRDF4ELMyNvESPlpCKSXyeceueByVLpC0EBO415CR7WUV1bYP2Ze9Oi9%2B%2BMvKxZYFqbbeC8bRbZtzDwLPwFjbh%2B2VStcHUfUW9tcdZuFZrD7N%2FhUJzRapQ7oLCVkgvZmfBl5KPdZq5ix1YOZQ8h9IaFarfoY5KIWFQn6pb6i8IUlAfrSBwUnoQNSEfW371JgzHVuoRateblMCCh9YGT3r3BU3JLPeVsaVNkvdLIZgX50yxHtGYg36IRp29TjOZnyntV%2BYNa%2FzmNs3uYPIeGRM%2BqmMvt0jYts6h%2BjR95epRyX8d35CbuMwtELsbLVH1i8I8Qg6lTVaJ9AVZIcz6iTQZJ1Qv4Fli5gn1K5QAvmrK4Wi%2B1EnONT%2FrEuzMPZdz3KzWXoFDZzndzNsW78r%2BtGFPNIgfvtGj%2ByqL%2FNtVXwPAwAA)

Counts: **12 commands** (10 contributed `A+B`, 2 code-only `B`, 0 contributed-without-handler), **2 settings**, **1 concrete node class** (`VirtualMachineTreeItem`, + 2 OS context-value variants, + 2 legacy unused tree classes), **2 `AzureWizard` flows** (create with basic/advanced modes, delete) (+ 2 non-wizard interactive flows: `addSshKey`, `openInRemoteSsh`), **9 `view/item/context` entries**, **1 `x-azResources` branch + 1 create command + 1 `onFetch` activation**, **1 exported API method**, **3 dead NLS keys**.
Explicitly zero: **0 views / viewsContainers** (the extension grafts onto the Azure Resources host tree), **0 submenus**, **0 `commandPalette` menu entries** (so every contributed command is palette-visible), **0 debuggers**, **0 taskDefinitions**, **0 problemMatchers**, **0 jsonValidation**, **0 keybindings**, **0 languages/grammars**, **0 walkthroughs**, **0 viewsWelcome**, **0 `enablement` gates**, **0 `activationEvents`**, **0 `capabilities`**, **0 webviews / file system providers / task providers / debug providers**, **0 telemetry suppressions** (`suppressIfSuccessful` / `suppressAll`), **0 build presets**, **0 framework detectors**.

---

## 0. Extension-level shape

- extensionDependencies: `ms-azuretools.vscode-azureresourcegroups`.
- `extensionKind` (A): `ui`, `workspace`. `categories`: `Azure`. `engines.vscode`: `^1.104.0`. Entry point `./main.js` (esbuild bundle).
- activationEvents (A): `[]` -- the extension is activated by the host's `x-azResources.activation.onFetch` and by VS Code's implicit command activation.
- capabilities: none declared (no `virtualWorkspaces` / `untrustedWorkspaces`); command gates in use: none (no `enablement`).
- x-azResources (A, under `contributes`):
  - `azure.branches`: `[{ "type": "VirtualMachines" }]`.
  - `activation.onFetch`: `["microsoft.compute/virtualmachines"]`.
  - `commands`: `[{ "command": "azureVirtualMachines.createVirtualMachine", "title": "%azureVirtualMachines.createVirtualMachine%", "type": "VirtualMachines", "detail": "%azureVirtualMachines.createVirtualMachineDetail%" }]` (detail: "For any workload or a remote dev box.").
- Exported extension API (B): `activate()` returns `createApiProvider([{ revealTreeItem, apiVersion: '1.0.0' }])`.
  - `revealTreeItem(resourceId: string): Promise<void>` -- lower-cases the id (issue #70), calls `ext.rgApi.appResourceTree.findTreeItem(id, { loadAll: true })`, then `ext.rgApi.appResourceTreeView.reveal(node, { select: true, focus: true, expand: true })`. Telemetry callback id `api.revealTreeItem`. Typed by `src/vscode-azurevirtualmachines.api.d.ts` (`AzureVirtualMachinesExtensionApi { apiVersion; revealTreeItem }`).
- Activation wiring (B), in order, inside `callWithTelemetryAndErrorHandling('azureVirtualMachines.activate', ...)` (flagged `isActivationEvent = 'true'`, measures `mainFileLoad`):
  1. `ext.outputChannel = createAzExtOutputChannel('Azure Virtual Machines', 'azureVirtualMachines')` (timestamp behavior driven by the `enableOutputTimestamps` setting inside the library); `registerUIExtensionVariables(ext)`, `registerAzureUtilsExtensionVariables(ext)`.
  2. `registerCommands()` (Section 1).
  3. Gets the `ms-azuretools.vscode-azureresourcegroups` exports; `getApi<AzureHostExtensionApi>('0.0.1')` stored as `ext.rgApi`; throws `Could not find the Azure Resource Groups extension` if absent.
  4. `rgApi.registerApplicationResourceResolver(AzExtResourceType.VirtualMachines, new VirtualMachineResolver())` (ARM type `microsoft.compute/virtualmachines`).
  - No auth session at startup, no experimentation service, no task/debug/language providers, no URI schemes.
- Global error handling (B): `registerErrorHandler(c => c.errorHandling.suppressReportIssue = true)` -- the "Report Issue" button is suppressed on every error in favor of the `azureVirtualMachines.reportIssue` command (`registerReportIssueCommand`).
- Cross-extension reads (B): setting `azureResourceGroups.suppressActivityNotifications` (via `createActivityContext`), activity log registration via `ext.rgApi.registerActivity`, `ms-vscode-remote.remote-ssh` (activation + `opensshremotes.openEmptyWindow` command + `extension.open`).
- Telemetry (B): EventName convention `<extensionId>/<callbackId>` (lowercased). Custom properties: `os`, `location`, `size`, `image` (featured image label), `usedAzureKey`, `hadPassphrase`, `numOfResources`, `deleteVm`, `failedResources`, `cancelStep = 'installRemoteSsh'`, `dialogResult` (on `postCreateVM`). Per-feature usage is collected once via the generic query and shown in the Usage Summary and each feature's Telemetry cell.

---

## 1. Commands (A + B)

10 contributed + 2 code-only. Every contributed command has a handler in `src/commands/registerCommands.ts`. Registration is `registerCommandWithTreeNodeUnwrapping` for the 9 tree-node commands, and `registerReportIssueCommand` for `reportIssue`; the telemetry callback id equals the command id. No debounce args, no per-command `enablement`. The manifest has **no `commandPalette` entries**, so all 10 contributed commands are visible in the palette. When invoked without a node, the commands fall back in three different ways: the seven existing-VM commands (`startVirtualMachine`, `stopVirtualMachine`, `restartVirtualMachine`, `copyIpAddress`, `openInRemoteSsh`, `addSshKey`, `deleteVirtualMachine`) call `ext.rgApi.pickAppResource({ filter: { type: 'Microsoft.Compute/virtualMachines' } })` (`deleteVirtualMachine` also passes `suppressCreatePick: true`); both create commands instead pick a subscription via `ext.rgApi.appResourceTree.showTreeItemPicker(SubscriptionTreeItemBase.contextValue, context)`, so creating a VM never requires selecting an existing VM; and `reportIssue` has no node argument (it is framework-provided).

All `view/item/context` `when` clauses (except the two create commands) share the prefix `view =~ /(azureResourceGroups|azureFocusView)/ &&` -- abbreviated below as `view~VM &&`.

| Command id | Title | Layer | Telemetry (90d, external) | Notes / `when` / group |
|---|---|---|---|---|
| `azureVirtualMachines.createVirtualMachine` | Create Virtual Machine... | A+B | **high**; **Migrate + fix** [usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WRT0%2FDMAzF7%2F0UuaWV9ocrGuMyDakHEGLABXHwEm9EpAmK3W5DfHjcde0kxGW9RPHz%2B9l59cgK96zmSlc0hu86IcfoadKQiRa7SuMS1%2BArMB8uIOlZ5sW2QWARW%2Bt%2FXROTpOFPVc%2BUmk7VzXisIByUAe%2FXYD5LeyTuXLBxJ8DrKzvLjK%2BJMeXaWkbf7aOLiQWGNRDm%2BnW1kNJyz1J9gt2ywcA0FLMftftA2W%2BFqcH07CokhupL3SrYxrybVQxd4sBALoYHqORN8zaVs9iie4E4GeBc9JHSUz3qg2hZVFcVJPeNmZKvDE2UVoGS3ObKxDpwXoyOYjswBfAvhIlEtEfVbfLuBfddYKUdqZLK0PW24zfgCU%2BMVW0MokXbXvoBguAoS7qwzR9T%2FMLEDulNJ6Tas34vWooerPrEugPnT6BLWZ21By0gGBxQF4F6qy6OpPXh%2FFteJSU5JOOYLKZeOydokUz2C%2BlChOnPAgAA) | `view == azureResourceGroups && viewItem =~ /virtualmachines/i && viewItem =~ /azureResourceTypeGroup/i` @ `1@1`; icon `$(add)`; also the `x-azResources` create command. Cancel-dominated, and failures outnumber successes. |
| `azureVirtualMachines.createVirtualMachineAdvanced` | Create Virtual Machine... (Advanced) | A+B | low-moderate; needs a human | Same `when` as basic create, @ `1@2`. Sets `advancedCreation = true` on the same wizard. Cancel + failure shares together dominate; candidate to fold into one create command with an "advanced" prompt. |
| `azureVirtualMachines.deleteVirtualMachine` | Delete... | A+B | low-moderate; lean Migrate | `view~VM && viewItem =~ /virtualmachine(?!s)/i` @ `2@4`. Uses `node.deleteTreeItem` -> multi-resource delete wizard (Section 5.2). Cancel share is high (modal confirmation / empty selection). |
| `azureVirtualMachines.startVirtualMachine` | Start | A+B | **high**; lean Migrate | `view~VM && viewItem =~ /virtualmachine(?!s)/i` @ `2@1`. `virtualMachines.beginStartAndWait` inside `runWithTemporaryDescription('Starting...')`. Overwhelmingly successful. |
| `azureVirtualMachines.restartVirtualMachine` | Restart | A+B | moderate; lean Migrate | Same `when`, @ `2@2`. `beginRestartAndWait`, description `Restarting...`. Noticeable failure share. |
| `azureVirtualMachines.stopVirtualMachine` | Stop | A+B | moderate; lean Migrate | Same `when`, @ `2@3`. **Deallocates** (`beginDeallocateAndWait`), description `Deallocating...`; the title says "Stop". Mostly successful. |
| `azureVirtualMachines.copyIpAddress` | Copy IP Address | A+B | moderate-high; **Migrate + fix** | Same `when`, @ `1@2`. Copies the public IP of the first NIC's first IP configuration; throws if no NIC / no IP configuration / no public IP. Failures outnumber successes. |
| `azureVirtualMachines.openInRemoteSsh` | Connect to Host via Remote SSH | A+B | **high**; **Migrate + fix** | `view~VM && viewItem =~ /linuxVirtualMachine/` @ `1@1`. Highest-use command with a large failure share and a meaningful cancel share. See Section 7 for the flow. |
| `azureVirtualMachines.addSshKey` | Add SSH Key... | A+B | moderate-high; needs a human | `view~VM && viewItem =~ /linuxVirtualMachine/` @ `1@3`. Cancel-dominated (file-picker dismissal) and failures outnumber successes. See Section 7. |
| `azureVirtualMachines.reportIssue` | Report Issue... | A+B | very low; lean Migrate (framework-provided) | Registered via `registerReportIssueCommand`; palette only. Pairs with the global `suppressReportIssue` error handler. |

> Telemetry cell = collected usage for EventName `ms-azuretools.vscode-azurevirtualmachines/<commandId>` (lowercased): relative band, plus an **advisory** suggestion. Raw counts are in the session working copy only. The Migrate/Drop call is the human's.

Code-only commands (B, not in manifest):

| Command id | Telemetry | Invoked from / behavior |
|---|---|---|
| `azureVirtualMachines.showOutputChannel` | no data (verify: renamed? suppressed?) -- not suppressed; absent from the 90d window | `ext.outputChannel.show()`. Referenced as a markdown link `command:azureVirtualMachines.showOutputChannel` in the partial-delete warning (`DeleteVirtualMachineStep`). The only trigger is that link in an uncommon partial-failure path, so near-zero use is expected; absence here is not a drop signal. |
| `azureVirtualMachines.showRemoteSshExtension` | moderate-high; lean Migrate (travels with `openInRemoteSsh`) | `vscode.commands.executeCommand('extension.open', 'ms-vscode-remote.remote-ssh')`. Referenced as a markdown link in the "You must have the Remote - SSH extension installed" warning from `verifyRemoteSshExtension`. Every observed invocation succeeds. |

Orphan strings (flag, **DO NOT migrate**) -- NLS keys with no manifest use and no code reference:

- `azureVirtualMachines.openInPortal` -- "Open in Portal" (host-provided today).
- `azureVirtualMachines.viewProperties` -- "View Properties" (host-provided today; the node still exposes `viewProperties` for the host's command).
- `azureVirtualMachines.refresh` -- "Refresh" (only reference is the permanently-skipped `test/global.test.ts` setup that executes `azureVirtualMachines.refresh`, which is not registered).

Hygiene notes (carry into triage, not features): `contributes.menus.explorer/context` and `editor/context` are empty arrays.

---

## 2. Settings / Configuration (A)

One configuration section titled `Azure Virtual Machines`. No telemetry event for settings (no direct telemetry event).

| Setting id | Type | Scope | Default | Notes |
|---|---|---|---|---|
| `azureVirtualMachines.enableOutputTimestamps` | boolean | not declared | `true` | "Prepends each line displayed in the output channel with a timestamp." Not read by this extension's code directly; consumed by `createAzExtOutputChannel('Azure Virtual Machines', 'azureVirtualMachines')` in `@microsoft/vscode-azext-utils` via the `ext.prefix` section. |
| `azureVirtualMachines.promptForPassphrase` | boolean | not declared | `true` | "Prompts for a passphrase when creating a Linux Azure Virtual Machine." Read in `PassphrasePromptStep.shouldPrompt` via `getWorkspaceSetting('promptForPassphrase')`. Applies to Linux only; Windows always prompts for the admin password. |

Cross-extension setting read: `azureResourceGroups.suppressActivityNotifications` (activity context). No deprecated settings, no enums.

---

## 3. Tree view (A branch + B behavior)

- The extension contributes **no `views` / `viewsContainers`**. It is a branch data provider for the Azure Resources host: `x-azResources.azure.branches` type `VirtualMachines`, resolved by `VirtualMachineResolver` for ARM type `microsoft.compute/virtualmachines` (`matchesResource` compares lower-cased `resource.type`).
- Resolver (`resolveResource`, telemetry callback id `resolveResource`): creates a compute client, `virtualMachines.get(resourceGroup, name, { expand: 'instanceView' })`, returns `new VirtualMachineTreeItem(subContext, { ...resource, ...vm })`. Wrapped in `callWithTelemetryAndErrorHandling`.

### Hierarchy with exact contextValues

```
Azure Resources host tree
  Subscription / resource-group / "Virtual Machines" type group   (host-owned; menus match viewItem =~ /virtualmachines/i && /azureResourceTypeGroup/i)
    VirtualMachineTreeItem  (resolved app resource)   contextValuesToAdd: ['linuxVirtualMachine'] | ['windowsVirtualMachine']
      (no children)
```

### Per-node details -- `VirtualMachineTreeItem`

- Label: VM `name`. Description: power state from `instanceView.statuses` entry whose code contains `powerstate`, `displayStatus` with the leading "VM" removed (e.g. `deallocated`, `stopped`); **omitted when the state is `running`**.
- `id`: VM resource id **lower-cased** (issue #70); `resourceGroup` lower-cased from the id.
- contextValue(s): added by the node -- `linuxVirtualMachine` when `osProfile.linuxConfiguration` is set, otherwise `windowsVirtualMachine`. The host contributes the base value(s); menus rely on the substring `virtualmachine` (case-insensitive) with `(?!s)` to exclude the group node. Static members: `linuxContextValue = 'linuxVirtualMachine'`, `windowsContextValue = 'windowsVirtualMachine'`, `allOSContextValue = /VirtualMachine$/` (unused). No `invalid*` or status-variant context values.
- Icon: `resources/{light,dark}/Virtual-Machine.svg` via `treeUtils.getThemedIconPath('Virtual-Machine')`.
- Click command: none (host default). `collapsibleState`: leaf (no children).
- `viewProperties`: `{ data: virtualMachine, label: name }` (feeds the host's View Properties command).
- `getIpAddress(context)`: first NIC from `networkProfile.networkInterfaces[0]` -> `networkInterfaces.get` -> first `ipConfigurations[0].publicIPAddress` -> `publicIPAddresses.get` -> `ipAddress`. Throws `No network interfaces are associated with "{0}"` / `No IP configurations are associated with network interface "{0}"`; a missing public IP surfaces as a non-null assertion failure.
- `getUser()`: `osProfile.adminUsername` (non-null assert).
- `deleteTreeItemImpl`: runs the delete wizard (Section 5.2).
- Refresh / polling: `refreshImpl` re-reads power state (`virtualMachines.instanceView`), swallowing errors (state becomes `undefined`). **No pagination, no polling**; transient descriptions (`Starting...` / `Restarting...` / `Deallocating...`) via `runWithTemporaryDescription` during start/restart/stop.
- Legacy / unused classes: `AzureAccountTreeItem` and `SubscriptionTreeItem` (`src/tree/`) are only referenced by each other (a stub `loadMoreChildrenImpl` returns `[]`, `supportsAdvancedCreation = true`). Not registered anywhere. Do not migrate.
- Telemetry: the resolver emits the `resolveresource` event on every VM resolution -- by far the highest-volume event in the extension (tree expansion), a very low failure share. This is the tree's real usage signal.

### Menus (A) -- `view/item/context` (9 entries, verbatim `when`)

| Command | `when` | group |
|---|---|---|
| `azureVirtualMachines.createVirtualMachine` | `view == azureResourceGroups && viewItem =~ /virtualmachines/i && viewItem =~ /azureResourceTypeGroup/i` | `1@1` |
| `azureVirtualMachines.createVirtualMachineAdvanced` | `view == azureResourceGroups && viewItem =~ /virtualmachines/i && viewItem =~ /azureResourceTypeGroup/i` | `1@2` |
| `azureVirtualMachines.copyIpAddress` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /virtualmachine(?!s)/i` | `1@2` |
| `azureVirtualMachines.startVirtualMachine` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /virtualmachine(?!s)/i` | `2@1` |
| `azureVirtualMachines.restartVirtualMachine` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /virtualmachine(?!s)/i` | `2@2` |
| `azureVirtualMachines.stopVirtualMachine` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /virtualmachine(?!s)/i` | `2@3` |
| `azureVirtualMachines.deleteVirtualMachine` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /virtualmachine(?!s)/i` | `2@4` |
| `azureVirtualMachines.openInRemoteSsh` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /linuxVirtualMachine/` | `1@1` |
| `azureVirtualMachines.addSshKey` | `view =~ /(azureResourceGroups\|azureFocusView)/ && viewItem =~ /linuxVirtualMachine/` | `1@3` |

- The two create commands are scoped to `view == azureResourceGroups` only (not the focus view); every other entry also targets `azureFocusView`.
- The Linux-only gating (`openInRemoteSsh`, `addSshKey`) is expressed only through the `linuxVirtualMachine` context value. The `linuxVirtualMachine` regex has no `\b` and no `i` flag.
- No `inline` group entries, no `view/title` entries, no submenus, no `commandPalette` hides (nothing is `when: never`).
- Command -> node contract (pick steps): when invoked from the palette every tree-node command calls `ext.rgApi.pickAppResource` with `filter: { type: 'Microsoft.Compute/virtualMachines' }`. `addSshKey` / `openInRemoteSsh` then throw `Only Linux VMs are supported.` for non-Linux picks (the `expectedChildContextValue` filter is a commented-out TODO). `delete` passes `suppressCreatePick: true`. The create commands use `appResourceTree.showTreeItemPicker(SubscriptionTreeItemBase.contextValue)` to pick a subscription when no node is supplied.

---

## 4. Debugging + tasks (A + B)

None. 0 debuggers, 0 debug configuration providers, 0 task definitions / task providers, 0 problem matchers.

---

## 5. Wizards (B)

2 `AzureWizard` flows (create -- one wizard with basic and advanced modes -- and delete). Both register activity-log entries through `createActivityContext` (`ext.rgApi.registerActivity`; honors `azureResourceGroups.suppressActivityNotifications`). Create uses `withChildren: true` so every execute step shows as an activity child (`AzureWizardExecuteStepWithActivityOutput`).

### 5.1 Create virtual machine -- `azureVirtualMachines.createVirtualMachine` / `...Advanced`

Entry: `createVirtualMachine(context, node?)`; the advanced command re-enters it with `advancedCreation: true`. Telemetry callback ids are the command ids.

**Context defaults (set before prompting):**

| Value | Default |
|---|---|
| `size` | `Standard_D2s_v3` (`Standard_DS1_v2` on custom/Azure Stack clouds) |
| `addressPrefix` | `10.1.0.0/24` |
| `includeExtendedLocations` | `true` |
| Location list | subset from `getAvailableVMLocations(ctx)`, applied via `LocationListStep.setLocationSubset(ctx, ..., 'Microsoft.Compute')`. The function lists `resourceSkus` and keeps SKUs where `resourceType === 'virtualMachines'`, `name === size`, and `locations` is present, then keeps those whose `restrictions` is an empty array **or** contains at least one restriction whose `type` is not `'Location'`; the `locations` of the surviving SKUs are concatenated. A SKU whose `restrictions` is undefined is excluded, and a SKU that has both a `Location` restriction and any other restriction (for example `Zone`) still passes, so the subset is not guaranteed to exclude location-restricted regions. If no SKU survives, the concatenation (`reduce` without an initial value) throws. |

**Ordered prompt steps:**

| # | Step | Prompt / default / validation | Mode |
|---|---|---|---|
| 1 | `VirtualMachineNameStep` | Input box "Enter a name for the new virtual machine." Length 1-64; chars `[a-zA-Z0-9.-]` only; may not start/end with `.` or `-`; unique within the resource group *if one is already set*. Trims. Masks the name. Kicks off `generateRelatedName(name, resourceGroupNamingRules)` as `relatedNameTask` (used as the new resource group name). Skipped if `newVirtualMachineName` or `virtualMachine` is set. | both |
| 2 | `OSListStep` | Quick pick `Linux` / `Windows` ("Select an OS"). Skipped when `os` preset. Sub-wizard: if `Windows`, adds `ValidateWindowsNameStep` (modal warning offering the name with `.` removed, "Use"). | advanced only (basic presets `os = 'Linux'`) |
| 3 | `ImageListStep` | Quick pick "Select an image" of Marketplace featured images for the chosen OS; records telemetry `image = label`. Resolves the image in the background (`imageTask`) while later prompts run. Skipped when `image` or `imageTask` is set. | advanced only (basic presets `imageTask`) |
| 4 | `UsernamePromptStep` | Input box "Enter a username"; default `azureuser` on Linux, empty on Windows. Linux: 1-64 chars, `^[0-9\|-]\|[^a-zA-Z0-9_-]` rejected; Windows: 1-20 chars, `\/"[]:\|<>+=;,?*@&` rejected and may not end with `.`; reserved words rejected (`admin`, `administrator`, `root`, `test`, `user`). Masks the value. | advanced only (basic presets `adminUsername = 'azureuser'`) |
| 5 | `PassphrasePromptStep` | Password input. **Linux:** "(empty for no passphrase)"; empty allowed, otherwise >= 5 chars; skipped when `promptForPassphrase` is false. **Windows:** admin password, required, 12-123 chars, at least 3 of {lower, upper, digit, one of `!@#$%^&*`}; always prompted. Sub-wizard: when non-empty, adds `ConfirmPassphraseStep` ("The passphrases must match."). Masks the value. | both |
| 6 | `LocationListStep` (library) | Location pick over the SKU-filtered subset; extended locations (edge zones) included. | both |

Note: the resource group is **never prompted** in either mode (no `ResourceGroupListStep`); a new resource group is always created.

**Basic-vs-advanced deltas:** basic prompts only name, (Linux) passphrase, and location -- it hard-wires `os = 'Linux'`, `adminUsername = 'azureuser'`, and `imageTask = getDefaultImageReference()` (the featured image whose `legacyPlanId` matches `ubuntu-24_04-ltsserver`, else the first featured Linux image). Advanced adds OS, image, and username.

**Before execute:** `newResourceGroupName = await relatedNameTask`; `activityTitle = Create virtual machine "<name>"`.

**Ordered execute steps** (priority numbers, lowest first; `ResourceGroupCreateStep` and `VerifyProvidersStep` take their priorities from `@microsoft/vscode-azext-azureutils`, which was not read for this inventory -- the code pushes them first and last respectively):

| Priority | Step | Action |
|---|---|---|
| library-defined | `ResourceGroupCreateStep` | Creates the new resource group in the chosen location. |
| library-defined | `VerifyProvidersStep(['Microsoft.Compute', 'Microsoft.Network'])` | Registers the resource providers if needed. |
| 210 | `PublicIpCreateStep` | Public IP `<vm>-ip`: IPv4, `Static`, SKU `Standard` (`Basic` on custom clouds); supports `extendedLocation`; on failure in an edge zone rethrows "Failed to create Virtual Machine. This image may not be supported in Edge Zones." |
| 220 | `NetworkSecurityGroupCreateStep` | NSG `<vm>-nsg`, created in the parent region (the location is read without the extended-location flag; the code comment states NSGs cannot be created in edge zones). Linux rules (all `Tcp`, source/dest `*`, `Allow`, `Inbound`): `SSH` 22 @340, `HTTPS` 443 @320, `HTTP` 80 @300. Windows: `RDP` 3389 @300. |
| 230 | `VirtualNetworkCreateStep` | VNet named after the VM (`<vm>-vnet` when the VM name is 1 char); address space `[addressPrefix]`; supports `extendedLocation`. |
| 240 | `SubnetCreateStep` | Subnet `default`, prefix `addressPrefix`, attaches the NSG. |
| 250 | `NetworkInterfaceCreateStep` | NIC named first-20-chars-of-VM-name + 3 random digits (portal convention); one IP configuration (same name as NIC) referencing the public IP and subnet; supports `extendedLocation`. |
| 260 | `VirtualMachineCreateStep` | See provisioning record. Telemetry `os`, `location`, `size`. Shows "Created new virtual machine" toast with **View Output**; clicking it focuses the output channel; the dialog outcome is logged by the un-awaited `postCreateVM` telemetry callback (`dialogResult`). |

The network and VM steps run only when their result is missing from the context (`shouldExecute`), and each re-`get`s the created resource afterward (workaround for azure-sdk-for-js#20249).

**Provisioning record (source facts only; AVM selection is a migration-skill decision):**

- Deployment scope: subscription-level wizard that creates a **new resource group** per VM, then deploys all resources into it in **sequential imperative SDK calls** (no ARM/Bicep deployment). No tags applied. Name derivations: RG name from `generateRelatedName(vmName, resourceGroupNamingRules)`; every other resource name derives from the VM name (see table).
- Primary ARM resource: `Microsoft.Compute/virtualMachines` (`<vm>`), `hardwareProfile.vmSize = size`, `storageProfile.imageReference = image`, `storageProfile.osDisk { name: <vm>, createOption: 'FromImage', managedDisk.storageAccountType: 'Premium_LRS' ('Standard_LRS' on custom clouds) }`, `networkProfile.networkInterfaces = [NIC]`, `osProfile.computerName = <vm>`, `osProfile.adminUsername`, optional `extendedLocation`.
- Linux auth: `disablePasswordAuthentication: true` with one SSH public key at `/home/<adminUsername>/.ssh/authorized_keys`. Windows auth: `osProfile.adminPassword = passphrase`, empty `windowsConfiguration`.
- Supporting resources:

| ARM type | Name | Created by | Depends on |
|---|---|---|---|
| `Microsoft.Resources/resourceGroups` | `relatedNameTask` result | `ResourceGroupCreateStep` | -- |
| `Microsoft.Network/publicIPAddresses` | `<vm>-ip` | `PublicIpCreateStep` (210) | RG |
| `Microsoft.Network/networkSecurityGroups` | `<vm>-nsg` | `NetworkSecurityGroupCreateStep` (220) | RG |
| `Microsoft.Network/virtualNetworks` | `<vm>` or `<vm>-vnet` | `VirtualNetworkCreateStep` (230) | RG |
| `Microsoft.Network/virtualNetworks/subnets` | `default` | `SubnetCreateStep` (240) | VNet, NSG |
| `Microsoft.Network/networkInterfaces` | `<vm[0..20]>NNN` | `NetworkInterfaceCreateStep` (250) | public IP, subnet |
| managed OS disk (`Microsoft.Compute/disks`) | `<vm>` | implicit via VM `osDisk` | VM |
| `Microsoft.Compute/sshPublicKeys` | `<vm>` | `createSshKey` fallback only; created, key pair generated, then **deleted** | RG |

- Required inputs / defaults: VM name, location, OS, image reference, size, admin username, admin password (Windows) or SSH public key (Linux), address prefix.
- Outputs consumed after creation: `virtualMachine` (returned as a `VirtualMachineTreeItem`), `sshKeyName`, NIC/public IP (for `getIpAddress`), resource group.
- Not provisioned: tags, managed identity, boot diagnostics, VM extensions, marketplace plan (`plan`) purchase info, data disks, availability zones/sets, Windows update/patch settings, Azure Bastion.

**Image resolution (B):** `ImageListStep` calls `https://catalogapi.azure.com/catalog/curationgrouplisting?api-version=2018-08-01-beta&group=Marketplace.FeaturedItems&returnedProperties=operatingSystem.family,id,image,freeTierEligible,legacyPlanId` (5 s timeout), filters by OS family, then for the selection calls `https://euap.catalogapi.azure.com/view/offers/<legacyPlanId>` to find the plan matching the featured item id, downloads that plan's `createuidefinition` artifact, and reads `parameters.imageReference` as the VM image reference. Three sequential unauthenticated HTTP calls with 5 s timeouts, against an undocumented catalog API (`2018-08-01-beta`).

**SSH key generation (B, `utils/sshUtils.createSshKey`):** Linux only. Key name `azure_<vm>_rsa` (`azure_<vm>_<n>_rsa` if it already exists; gives up after 3 s and reuses the existing key). Writes into `~/.ssh` (`os.homedir()/.ssh`). Primary path: `ssh-keygen -t rsa -b 4096 -f <path> -N <passphrase>` (child process, shell). Fallback when `ssh-keygen` is not found on `PATH`: create an Azure `sshPublicKeys` resource, `generateKeyPair`, write public/private key files, delete the resource (passphrase is **ignored** with a log note; telemetry `usedAzureKey`, `hadPassphrase`). Wrapped in `callWithMaskHandling` so the passphrase is masked in logs.

**Post-execute:** `ext.rgApi.appResourceTree.refresh`; for Linux VMs `configureSshConfig(context, vm, '~/.ssh/<sshKeyName>')` appends a `Host` block to `~/.ssh/config` (Section 7).

### 5.2 Delete virtual machine -- `azureVirtualMachines.deleteVirtualMachine`

Entry: `deleteVirtualMachine` -> `node.deleteTreeItem(context)` -> `VirtualMachineTreeItem.deleteTreeItemImpl` builds the wizard.

**Prompt steps:**

1. `SelectResourcesToDeleteStep` -- multi-select quick pick "Select resources to delete". Items: the VM itself (picked by default), plus resources discovered by `getResourcesAssociatedToVm`: each NIC (from `networkProfile`), each NIC's public IP, the subnet's virtual network, the subnet's NSG (looked up via the subnet; errors swallowed), and the OS managed disk. Selecting nothing throws `UserCancelledError`.
2. `ConfirmDeleteStep` -- modal warning ("Are you sure you want to delete ...?" with the single resource or the quoted list), `DialogResponses.deleteResponse`. Telemetry: `numOfResources`, `deleteVm` (computed locally).

**Execute step:** `DeleteVirtualMachineStep` (priority 100): `deleteAllResources` deletes serially in the order VM -> NIC -> VNet, then the remaining resources (public IP, NSG, disk) in parallel; then, if the resource group is now empty (`resources.listByResourceGroup`), deletes the resource group too. Each deletion logs to the output channel and failures are collected rather than thrown. If anything failed and either the VM failed **or `!context.deleteVm`**, the step throws `Failed to delete the following resource(s): ...` with a **View Output** error button; otherwise it shows a warning toast linking `command:azureVirtualMachines.showOutputChannel`. Activity title: `Delete <list>...` / `Delete <type> "<name>"...`.

**Source defect to fix rather than port:** `IDeleteChildImplContext.deleteVm` is **never assigned** (only a same-named local in `ConfirmDeleteStep` and commented-out lines in `deleteVirtualMachine.ts`), so `!context.deleteVm` is always true and any partial failure always throws instead of degrading to a warning.

### 5.3 Non-wizard interactive flows

`addSshKey` and `openInRemoteSsh` -- see Section 7.

### 5.4 Detection logic / build presets

None (0 build presets, 0 framework detectors). The only "detection" is the Linux/Windows split from `osProfile.linuxConfiguration` and the `ssh-keygen` presence check.

---

## 6. Config-file features (A + B)

- `jsonValidation` (A): none.
- Scaffolding / parsing of project config files: none.
- User-level config files touched (B): `~/.ssh/config` (read with `ssh-config`, appended to) and `~/.ssh/*.pub` / private key files. `vsCodeConfig/settings.ts` is a generic settings helper (only `getWorkspaceSetting` is used); `vsCodeConfig/extensions.ts` is an unused `IExtensionsJson` type.

---

## 7. External integrations (B)

- **Azure SDK clients** (`utils/azureClients.ts`, lazy-loaded; `createAzureClient` from `@microsoft/vscode-azext-azureutils`):
  - `@azure/arm-compute` `ComputeManagementClient`: `virtualMachines.{get (expand instanceView), instanceView, beginStartAndWait, beginRestartAndWait, beginDeallocateAndWait, beginDeleteAndWait, beginCreateOrUpdateAndWait, list}`, `virtualMachineExtensions.{get, beginCreateOrUpdateAndWait}`, `resourceSkus.list`, `sshPublicKeys.{create, generateKeyPair, delete}`, `disks.beginDeleteAndWait`.
  - `@azure/arm-network` `NetworkManagementClient` (with `@azure/arm-network-profile-2020-09-01-hybrid` on custom clouds): `publicIPAddresses`, `networkSecurityGroups`, `virtualNetworks`, `subnets`, `networkInterfaces` (`beginCreateOrUpdateAndWait`, `get`, `beginDeleteAndWait`).
  - `@azure/arm-resources` `ResourceManagementClient` (hybrid profile on custom clouds): `resources.listByResourceGroup`, `resourceGroups.beginDeleteAndWait`.
  - Custom-cloud (Azure Stack) handling: `parseClientContext(context).isCustomCloud` switches the network/resource clients to 2020-09-01-hybrid profiles, size to `Standard_DS1_v2`, public IP SKU to `Basic`, OS disk to `Standard_LRS`.
- **Marketplace catalog REST calls:** `catalogapi.azure.com` / `euap.catalogapi.azure.com` via `sendRequestWithTimeout` (Section 5.1).
- **Remote - SSH (`ms-vscode-remote.remote-ssh`):**
  - `openInRemoteSsh` flow: `verifyRemoteSshExtension` (activate the extension; if missing, shows a warning with a `command:azureVirtualMachines.showRemoteSshExtension` link, records `cancelStep = installRemoteSsh`, suppresses the error display, then throws) -> ensure and parse `~/.ssh/config` -> `node.getIpAddress` -> find a `Host` entry whose `HostName` equals the VM's public IP -> if none, warn "Unable to find host ... in SSH config." with **Add new SSH config host** (which runs `addSshKey`) -> `executeCommand('opensshremotes.openEmptyWindow', { host })`.
  - `addSshKey` flow: pick a `.pub` file (default dir `~/.ssh`) -> get-or-create the `enablevmaccess` VM extension (publisher `Microsoft.OSTCExtensions`, type `VMAccessForLinux`, handler `1.4`, `autoUpgradeMinorVersion: true`) -> set `protectedSettings { ssh_key, username: adminUsername || 'azureuser' }` -> `beginCreateOrUpdateAndWait` under a notification progress -> `configureSshConfig` with the private-key path (the `.pub` path minus extension).
  - `configureSshConfig`: appends `Host <vm name>` (or `<vm>-N`, N from 2 up to 99, if that host already exists), `HostName <public IP>`, `User <adminUsername>`, `IdentityFile <private key path>` to `~/.ssh/config`.
- **Azure Resources host API** (`@microsoft/vscode-azext-utils/hostapi`): `registerApplicationResourceResolver`, `pickAppResource`, `appResourceTree.{findTreeItem, showTreeItemPicker, refresh}`, `appResourceTreeView.reveal`, `registerActivity`.
- **Child processes:** `cpUtils.executeCommand` (shell spawn; used for `ssh-keygen`); `which` for `ssh-keygen` detection.
- **Not present:** GitHub/Octokit, git, auth providers, webviews, file system providers, CLI tool lifecycle.
- Dead / unreferenced helpers (do not migrate): `commands/deleteNode.ts`, `getExtensionApi.ts`, `utils/openUrl.ts`, `utils/delay.ts`, `utils/treeUtils.getIconPath`, `vsCodeConfig/extensions.ts`, and the unused functions in `vsCodeConfig/settings.ts` (`updateGlobalSetting`, `updateWorkspaceSetting`, `getGlobalSetting`, `getWorkspaceSettingFromAnyFolder`), plus `vscode.proposed.*.d.ts`. `utils/randomUtils.ts` is used by tests only.

---

## 8. Docs layer (C) -- supplementary only

Consulted:
- `https://code.visualstudio.com/docs/azure/virtual-machines` -- **404. There is no VS Code docs page for this extension.**
- Repo `README.md` (the Marketplace page) -- the only user-facing documentation.
- Repo `CHANGELOG.md` -- used for intent and dating (e.g. 0.6.9 moved the default image to a more recent OS and moved the create flow to activity log v2 with per-step children).

Doc-derived intent (verified against code unless noted):
- README feature list: "View, create, delete, start, and stop Azure Virtual Machines" and "Add SSH key to existing Azure Virtual Machines"; "Remote into Azure VM via SSH"; both SSH features documented as **Linux-only** -- matches the `linuxVirtualMachine` menu gating.
- README says the new VM is **Standard D2s V3 with Ubuntu 18.04-LTS** -- size matches; **the image claim is stale** (code defaults to the featured Ubuntu Server 24.04 LTS, falling back to the first featured Linux image). Trust the code. (A code comment in `createVirtualMachine.ts` repeats the stale 18.04 wording.)
- README says the user types a name and a passphrase "or leave it empty"; it does not mention the location prompt, the advanced flow, OS/image/username prompts, Windows support, copy IP, restart, the delete-resource picker, the two settings, or the exported API.
- README says the SSH Config (`~/.ssh/config`) is updated after create / add-key -- matches `configureSshConfig`.
- Nothing in the docs describes the context-menu gating, the tree, or the telemetry. Docs removed **no** feature found in code/manifest.

---

## 9. Usage Summary (telemetry)

- Cluster / window / collected-on: `ddtelvscode`.`VSCodeExt`.`RawEventsVSCodeExt`; **90d**; **2026-10-22**. Query returned **14 distinct EventNames** (13 under the extension prefix -- 11 commands, the `resolveresource` resolver callback, and `postcreatevm` -- plus the framework `unhandlederror`). A 365d re-run returned the same rows and values, so the source appears to retain no more than ~90 days.
- **Raw counts are deliberately not committed** (repo policy). The ranked table with `ExternalUsers` / `Succeeded` / `Failed` / `Canceled` / `LastSeen` per event lives only in the session artifacts dir (`usage-90d.json`, `USAGE-working.md`).
- Reconciliation result: **every contributed command produced a telemetry row**, plus the code-only `showRemoteSshExtension`. Absent: `azureVirtualMachines.showOutputChannel` (code-only; invoked from a markdown link) and `api.revealTreeItem` (API-only, invoked by other extensions) -- both flagged **no data (verify)**, not "unused".
- **No callback sets `suppressIfSuccessful` or `suppressAll`**, so no count is artificially deflated (the `suppressReportIssue` / `suppressDisplay` flags only affect UI, not telemetry).
- No dev/test-only features were identified for exclusion from the telemetry review.
- Framework / plumbing rows with no user feature: `unhandlederror`. `resolveresource` is the resolver's callback (the tree's real usage; a very low failure share) -- not a command, but a live feature.
- Cross-checks worth carrying into triage:
  - `azureVirtualMachines.createVirtualMachine` -- cancel-dominant, failures exceed successes. Fix signal plus a UX question; not a drop.
  - `azureVirtualMachines.openInRemoteSsh` -- the most-used command, with a large failure share (a missing Remote - SSH extension throws by design after the warning, and missing public IP / SSH-key setup also fail). Migrate + fix.
  - `azureVirtualMachines.copyIpAddress` -- failures exceed successes (most likely no public IP / no NIC). Migrate + fix.
  - `azureVirtualMachines.addSshKey` -- cancel-dominant (users open the file picker and back out). Needs a human; likely belongs inside a single "connect" experience.
  - `azureVirtualMachines.createVirtualMachineAdvanced` -- far lower use than basic create, with cancel + failure dominating. Candidate to fold into the single create command.
  - `postCreateVM` -- the un-awaited "View Output" toast follow-up; very low use. A diagnostic of a toast button, not a user feature: candidate Drop / fold into the creation activity log.
  - `azureVirtualMachines.reportIssue` -- negligible, framework-provided.

Re-run the roll-up with the deeplink at the top of this file. Per-feature drill-down (edit the `feature` line):

```kusto
let ext = 'ms-azuretools.vscode-azurevirtualmachines';
let feature = 'azurevirtualmachines.createvirtualmachine';  // <-- any callbackId
let window = 90d;
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(window)
| where ExtensionName == ext
| where EventName == strcat(ext, '/', feature)
| summarize
    Invocations   = count(),
    ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
    Succeeded     = countif(tostring(Properties['result']) == 'Succeeded'),
    Failed        = countif(tostring(Properties['result']) == 'Failed'),
    Canceled      = countif(tostring(Properties['result']) == 'Canceled')
    by ExtensionVersion
| order by ExternalUsers desc
```

[Open the per-feature drill-down in ADX](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WRT0%2FDMAzF7%2F0UuaWV9ocrGuMyDakHEGLABXHwEm9EpAmK3W5DfHjcde0kxGW9RPHz%2B9l59cgK96zmSlc0hu86IcfoadKQiRa7SuMS1%2BArMB8uIOlZ5sW2QWARW%2Bt%2FXROTpOFPVc%2BUmk7VzXisIByUAe%2FXYD5LeyTuXLBxJ8DrKzvLjK%2BJMeXaWkbf7aOLiQWGNRDm%2BnW1kNJyz1J9gt2ywcA0FLMftftA2W%2BFqcH07CokhupL3SrYxrybVQxd4sBALoYHqORN8zaVs9iie4E4GeBc9JHSUz3qg2hZVFcVJPeNmZKvDE2UVoGS3ObKxDpwXoyOYjswBfAvhIlEtEfVbfLuBfddYKUdqZLK0PW24zfgCU%2BMVW0MokXbXvoBguAoS7qwzR9T%2FMLEDulNJ6Tas34vWooerPrEugPnT6BLWZ21By0gGBxQF4F6qy6OpPXh%2FFteJSU5JOOYLKZeOydokUz2C%2BlChOnPAgAA)

---

## Migration-relevant cross-cutting notes

- **Host-API dependence is total.** The extension has no view of its own: it is a resolver for `microsoft.compute/virtualmachines` plus commands gated on the host's `viewItem` context values. In the monorepo this becomes `DataProvider` / `ViewProvider` registrations in `registerTrees.ts` and `ManagedCommand`s with static `ContextValue` properties. Source regexes use bare substrings (`/virtualmachine(?!s)/i`, `/linuxVirtualMachine/`); the monorepo convention is `viewItem =~ /\bcontextValue\b/i` with one context value per OS (`linuxVirtualMachine`, `windowsVirtualMachine`) and one for the type group.
- **Shared-lib coupling to strip:** `@microsoft/vscode-azext-utils` (`AzureWizard`, `AzureWizardExecuteStepWithActivityOutput`, `IActionContext`, `registerCommandWithTreeNodeUnwrapping`, `callWithMaskHandling`, `UserCancelledError`, `DialogResponses`), `@microsoft/vscode-azext-azureutils` (`createAzureClient`, `LocationListStep`, `ResourceGroupCreateStep`, `VerifyProvidersStep`, `generateRelatedName`, `sendRequestWithTimeout`, `uiUtils.listAllIterator`), `@microsoft/vscode-azureresources-api`. Each has a monorepo counterpart (azutils clients, DI, `ActionExecutor`, wizard framework). The ARM calls in `utils/azureClients.ts` need wrappers in `packages/azutils/src/rest/clients/` with `@azure/arm-compute` / `@azure/arm-network` types re-exported.
- **Creation is imperative, not template-based.** The create flow issues seven-plus sequential SDK calls for the RG, public IP, NSG, VNet, subnet, NIC, and VM, with each step recording its output on the wizard context. The Section 5.1 provisioning record is the interface contract the migration skill should map against the monorepo's azd + Bicep creation path (AVM resource/pattern selection is deliberately left to that skill).
- **Per-VM resource group and name coupling:** every created resource name derives from the VM name (`-ip`, `-nsg`, `-vnet`, truncated NIC + 3 random digits), and a **new resource group is created per VM**. Delete mirrors this by discovering associated resources and deleting the RG when it becomes empty -- the two flows must stay consistent.
- **Remote - SSH is a hard soft-dependency.** `openInRemoteSsh` + `showRemoteSshExtension` + the `~/.ssh/config` writer are one cohesive feature with high usage and high failure share. It also touches the user's home directory via `fs-extra` and `os.homedir()`; the monorepo convention is `vscode.workspace.fs` + `vscode.Uri` (and `Uri.fsPath` only for child processes).
- **Local key generation:** `ssh-keygen` via a shell-spawned child process with the passphrase on the command line (`-N`), plus a fallback to Azure's `sshPublicKeys.generateKeyPair` that silently drops the passphrase. Both are security-relevant and worth a deliberate decision in triage.
- **Open network posture to flag in triage:** the NSG opens SSH (22), HTTP (80), HTTPS (443) (Linux) or RDP (3389) (Windows) to source `*`.
- **Undocumented Marketplace catalog API** (`catalogapi.azure.com` `2018-08-01-beta`, plus an `euap` host) drives the image list; three sequential unauthenticated calls with 5 s timeouts. A monorepo replacement (for example a curated image list or the ARM `vmImages` APIs) is a design decision.
- **Custom-cloud (Azure Stack) branches** (hybrid-profile clients, `Standard_DS1_v2`, Basic public IP, `Standard_LRS`) exist in source; whether they migrate is a scope decision.
- **Icons:** `resources/{light,dark}/Virtual-Machine.svg` is referenced by hand via `treeUtils.getThemedIconPath`. The monorepo resolves resource icons from `<logicalType>.toLowerCase() + '.svg'` under `packages/azutils/resources/azureIcons/`; `Microsoft.Compute/virtualMachines` needs a matching icon file.
- **Power-state description** (hide `running`, show others) and the transient `Starting...` / `Restarting...` / `Deallocating...` descriptions map onto the monorepo's enrichment (`DataProvider.enrich`) and view-provider description logic; `Stop` actually **deallocates**.
- **Deliberate non-migrations:** the 3 dead NLS keys, the legacy `AzureAccountTreeItem` / `SubscriptionTreeItem`, the unreferenced helpers listed in Section 7, `getExtensionApi.ts`, the unused `vscode.proposed.*` d.ts files, and the permanently-skipped nightly test setup that references the unregistered `azureVirtualMachines.refresh`.
- **Bugs to fix rather than port:** the never-assigned `deleteVm` flag (Section 5.2), `ConfirmDeleteStep`'s local `deleteVm` shadowing the context field, and the stale "Ubuntu 18.04" comment/README text (the real default is Ubuntu Server 24.04 LTS). The `numberOfPasswordComplexityRequirements` helper relies on `match()?.length`, which is always 0 or 1 per class (correct for the "3 of 4 classes" rule, but the idiom is misleading).
- **Exported API:** `revealTreeItem(resourceId)` has no manifest entry and no in-product caller; other Azure extensions may call it. Confirm external consumers before deciding whether the monorepo must keep an equivalent.
