# Azure Storage - Feature Inventory

Source: `microsoft/vscode-azurestorage` @ `main` (`8a3a34175543b1a7b93fa253e805416546a136a1`, 2026-10-15), v0.17.2, publisher `ms-azuretools`, extension id `ms-azuretools.vscode-azurestorage`.
Method: reconcile `package.json` + `package.nls.json` + code (`activate()` / `registerCommands.ts` / `src/**`) + published docs.
Code is authoritative for behavior; docs are supplementary.

Source layer legend: **A** = declarative (manifest), **B** = code-only/behavioral, **C** = docs/UX.

Telemetry usage: collected from `cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt` (window: 90d; collected 2026-10-22). Per the repo's telemetry policy the **raw counts are not committed** - this file carries a qualitative adoption band plus an advisory suggestion. Roll-up deeplink: [all events, external usage](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WSTWvDMAyG7%2F0V3skJtGXXUbpL6aCwjrFuu4wxVFttDY5dLCX9YD9%2BStIENnapb36l95GE5JEVHllNlS5oBOcyIcfoaVyRiRZbhTgm2KKeDLykH1yw8SCOu1s7GRhfEmPKtLWMvnXpfGyBYQ2EmX5fzUSaH1nUFzjMKwxMvTj4VocdJlQrTBWmV1dINSj26l7BNmZtrbzPEgcGcjE8QYFqOq1774MciZML2%2Bw5xT0mdkgf2hEYdhWwmLCurT9zdSPjcipRi5fKooDkzjhQ8hahiqZJJvlNlYll4CwfNsG6egrg3wgTSdA2UbfJ2nGWYHYu4MIO1YIWoc2tm9yAJ7wwOv1aRt3uBbEqjUG0aOtP16MQ%2Fp1ftlf6ZmiB6N6qL6wHcP4CupbVWjvQDILBHnUVqLN2qEcgXiGGDrWJqQD%2BkpNClvvICjhmf84lHyp9kjdaLkdWQA1nfVLNtdW3IouOyWJqxF9rtEjmB8NiJCwGAwAA)

Counts: **47 commands** (42 contributed `A+B` + 5 code-only `B`; 0 contributed-without-handler), **4 declared settings** (+ 1 code-read setting not declared, 3 foreign setting groups read, 2 README-only settings), **16 node classes** (+ 5 generic click-through child kinds, + 2 dynamic context-value variants on the attached account node), **11 `AzureWizard` flows** (+ the advanced variant of the account wizard; + ~14 non-wizard interactive flows), **2 `FileSystemProvider`s** (+ 1 `TextDocumentContentProvider`), **1 submenu**, **91 menu entries** (1 `view/title` + 2 `explorer/context` + 67 `view/item/context` + 17 `commandPalette` + 4 inside the submenu).
Explicitly zero: **0 views / viewsContainers** (the extension grafts onto the Azure Resources host tree), **0 debuggers**, **0 taskDefinitions**, **0 problemMatchers**, **0 jsonValidation**, **0 keybindings**, **0 languages/grammars**, **0 walkthroughs**, **0 `enablement` gates**, **0 orphan NLS keys** (`package.nls.json` is the empty object `{}`; the manifest uses literal strings and all user-facing code strings are inline `localize(...)` calls or literals).

---

## 0. Extension-level shape

- **extensionDependencies (A):** `ms-azuretools.vscode-azureresourcegroups`. The extension has no tree view of its own; it reaches the application tree, the workspace tree, the picker, and reveal behavior through the host API.
- **activationEvents (A):** `onFileSystem:azurestorage`, `onFileSystem:azurestorageblob`, `onView:azureWorkspace`. (Activation for the Azure resource tree is driven by `x-azResources.activation.onFetch` below.)
- **engines.vscode:** `^1.104.0`. **preview:** `true`. **main:** `main` (Node host only - there is **no** `browser` entry). **Build:** esbuild (`esbuild.mjs`); copies the platform AzCopy packages (`@azure-tools/azcopy-darwin|linux|win32|win64` are kept external).
- **capabilities (A):** `virtualWorkspaces = { supported: 'limited', description: 'In virtual workspaces, uploading files or folders to Azure Storage is not supported.' }`. `untrustedWorkspaces` not declared. Command gating in use: `!isWeb && !isLinux && !remoteName` on the five "Open in Storage Explorer" menu entries (section 3) and `!remoteName` on the palette entry for `openStorageAccount`.
- **x-azResources (A):**
  - `azure.branches`: `{ type: 'StorageAccounts' }`
  - `workspace`: `{ branches: [{ type: 'storageEmulator' }], resources: true }`
  - `activation.onFetch`: `microsoft.storage/storageaccounts`
  - `commands`: `azureStorage.createGpv2Account` - title "Create Storage Account...", `type: 'StorageAccounts'`, detail "For file storage and static file hosting."
- **Exported extension API (B):** `activate()` returns `createApiProvider([{ revealTreeItem, apiVersion: '1.0.0' }])`.
  - `revealTreeItem(resourceId: string): Promise<void>` - telemetry callback `api.revealTreeItem`.
  - `src/vscode-azurestorage.api.d.ts` declares `AzureStorageExtensionApi { apiVersion: string; revealTreeItem(resourceId: string): Promise<void> }`. `getApiExport<T>()` is a generic helper for reading other extensions' exports and is not part of this extension's surface.
- **Activation wiring (B)** - `activate()`, in order:
  1. `ext.context`, `ext.ignoreBundle`; `createAzExtOutputChannel('Azure Storage', ext.prefix)` (`ext.prefix = 'azureStorage'`); `registerUIExtensionVariables`, `registerAzureUtilsExtensionVariables`.
  2. Inside `callWithTelemetryAndErrorHandling('activate', ...)` (`isActivationEvent = 'true'`, `mainFileLoad` measurement):
     - Two `AzureStorageFS` instances (`ext.azureStorageFS`, `ext.azureStorageWorkspaceFS`).
     - `registerFileSystemProvider('azurestorage', AzureStorageFS, { isCaseSensitive: true })`.
     - `registerFileSystemProvider('azurestorageblob', BlobContainerFS, { isCaseSensitive: true })`.
     - `registerTextDocumentContentProvider('azurestorage', AzureStorageFS)`.
     - `registerErrorHandler(c => c.errorHandling.suppressReportIssue = true)` (globally suppresses the inline Report Issue button) + `registerReportIssueCommand('azureStorage.reportIssue')`.
     - `registerCommands()`.
     - Looks up `ms-azuretools.vscode-azureresourcegroups` exports and **throws `Could not find the Azure Resource Groups extension`** if absent. With the host API `0.0.1`: `registerApplicationResourceResolver(AzExtResourceType.StorageAccounts, new StorageAccountResolver())` and `registerWorkspaceResourceProvider('storageEmulator', new StorageWorkspaceProvider(rootTreeItem))`.
  3. The workspace provider's parent comes from `ext.rgApi.workspaceResourceTree._rootTreeItem` (private-field access behind an `eslint-disable`) - a host-coupling hazard.
- **Side-effect import:** `./tree/AttachedStorageAccountTreeItem` is imported in `extension.ts` for effect.
- **Telemetry (B):** EventName convention `<extensionId>/<callbackId>` (lowercased). All commands are registered via `registerCommandWithTreeNodeUnwrapping`, so the callback id equals the command id, **except** `azureStorage.deployStaticWebsite`, which sets `telemetry.eventVersion = 2` and therefore emits `...azurestorage.deploystaticwebsitev2`. Custom properties are called out per feature below.
- **Proposed API typings (unused):** `src/vscode.proposed.authLearnMore.d.ts`, `src/vscode.proposed.authenticationChallenges.d.ts` (no code references - do not migrate).

---

## 1. Commands (A + B)

47 commands: 42 contributed + 5 code-only. Every contributed command has a handler (`azureStorage.reportIssue` via `registerReportIssueCommand`; the rest via `registerCommandWithTreeNodeUnwrapping`). Category for every contributed command is `Azure Storage`. No `enablement` on any command.

Telemetry cell = **qualitative** external-user adoption band (very high / high / moderate / low / very low) over the 90d window, notable result-split flags, and an **advisory** suggestion (`lean Migrate` / `Migrate + fix` / `candidate Drop` / `needs a human`). Raw counts are intentionally not committed. The Migrate/Drop call is the human's.

| Command id | Title | Layer | Telemetry | Notes / enablement / when |
|---|---|---|---|---|
| `azureStorage.openInFileExplorer` | Open in Explorer... (`$(file-symlink-directory)`) | A+B | very high - lean Migrate | Blob container / file share only. Palette use: `pickAppResource` with `storageFilter`, `expectedChildContextValue: [BlobContainerTreeItem.contextValue, FileShareTreeItem.contextValue]`. Wizard `OpenBehaviorStep` -> `OpenTreeItemStep` (5.6). Emulated resources default to `OpenInNewWindow`. Also the click target of the `openInFileExplorer` generic child node. Menu: `navigation@3` + `inline`. |
| `azureStorage.refresh` | Refresh (`$(refresh)`) | A+B | very high - lean Migrate | `refreshTreeItem(actionContext, treeItem)`. Menu group `9_refresh` on group nodes, containers, shares, directories, attached root. |
| `azureStorage.configureStaticWebsite` | Configure Static Website... | A+B | low - high failure, notable cancel - Migrate + fix | `selectStorageAccountTreeItemForCommand({ mustBeWebsiteCapable: true, configureWebsite: false })` then `configureStaticWebsite`. Rejects attached accounts. |
| `azureStorage.disableStaticWebsite` | Disable Static Website | A+B | very low - mostly failing - candidate Drop (verify, small-N) | `{ mustBeWebsiteCapable: false, configureWebsite: false }` then `disableStaticWebsite`. |
| `azureStorage.browseStaticWebsite` | Browse Static Website | A+B | moderate - lean Migrate | `{ mustBeWebsiteCapable: true, configureWebsite: false }` then `browseStaticWebsite`. |
| `azureStorage.deployStaticWebsite` | Deploy to Static Website via Azure Storage... (`$(cloud-upload)`) | A+B | high - lean Migrate | Emits as `...deploystaticwebsitev2` (`eventVersion = 2`). Targets: palette, storage account node, `$web`-capable container node, or explorer folder URI (`explorer/context`). See 5.3. Telemetry props: `contextValue`, `hasPreDeployTask`, `deployAttempt`, `cancelStep`. |
| `azureStorage.copyUrl` | Copy URL | A+B | high - lean Migrate | `treeItem.copyUrl()` on any `ICopyUrl` node. Palette: never. |
| `azureStorage.openBlobContainer` | Open in Storage Explorer | A+B | moderate - high failure - Migrate + fix | `storageExplorerLauncher.openResource(accountId, subscriptionId, 'Azure.BlobContainer', containerName)`. Palette: never. |
| `azureStorage.openTable` | Open in Storage Explorer | A+B | high - high failure - Migrate + fix | Resource type `Azure.Table`. Palette: never. |
| `azureStorage.openFileShare` | Open in Storage Explorer | A+B | very low - mixed failure/cancel - candidate Drop (verify) | Resource type `Azure.FileShare`. Palette: never. |
| `azureStorage.openQueue` | Open in Storage Explorer | A+B | moderate - high failure - Migrate + fix | Resource type `Azure.Queue`. Palette: never. |
| `azureStorage.openStorageAccount` | Open in Storage Explorer | A+B | moderate - cancel-dominant - needs a human | Palette: `!remoteName` (the only palette-visible Open-in-Storage-Explorer command; `pickAppResource` with `storageFilter`). `initStorageAccount` then `openResource(accountId, subscriptionId)` (no resource type/name). |
| `azureStorage.copyPrimaryKey` | Copy Primary Key | A+B | low - high failure (consistent with shared-key access disabled) - Migrate + fix | `getKey()` then `copyAndShowToast(key, 'Primary key')`. |
| `azureStorage.copyConnectionString` | Copy Connection String | A+B | moderate - notable failure - Migrate + fix | `getConnectionString()` then `copyAndShowToast(cs, 'Connection string')`. |
| `azureStorage.createBlobContainer` | Create Blob Container... | A+B | high - lean Migrate | `createChildNode` on the blob container group; if emulated and Azurite is not installed, `warnAzuriteNotInstalled`. Wizard `BlobContainerNameStep` (5.5). |
| `azureStorage.deleteBlobContainer` | Delete Blob Container... | A+B | moderate - lean Migrate | `deleteNode(context, BlobContainerTreeItem.contextValue, treeItem)`. |
| `azureStorage.createBlockBlob` | Create Empty Blob... | A+B | low - needs a human (low volume) | Prompts for a blob path, creates missing virtual directories and an empty block blob, then runs `azureStorage.editBlob` on it. Palette: never. |
| `azureStorage.uploadFiles` | Upload Files... | A+B | high - lean Migrate | Wizard (5.7). |
| `azureStorage.uploadFolder` | Upload Folder... | A+B | moderate - notable cancel - lean Migrate | Wizard (5.7). |
| `azureStorage.downloadTreeItems` | Download... | A+B | high - lean Migrate | Multi-select aware (`treeItem`, `treeItems`). Wizard (5.7). Palette: never. |
| `azureStorage.downloadSasUrl` | Download by SAS Url... (`$(cloud-download)`) | A+B | moderate - cancel-dominant - needs a human | Workspace-submenu entry (`1_download@1`). Wizard with `SasUrlPromptStep`. |
| `azureStorage.createFileShare` | Create File Share... | A+B | low - high failure and cancel - Migrate + fix | Wizard (5.5). |
| `azureStorage.deleteFileShare` | Delete File Share... | A+B | very low - candidate Drop (verify) | `deleteNode(context, FileShareTreeItem.contextValue, treeItem)`. |
| `azureStorage.deleteStorageAccount` | Delete Storage Account... | A+B | low - needs a human (low volume) | `initStorageAccount` then `deleteNode` -> delete wizard (5.4). |
| `azureStorage.createDirectory` | Create Directory... | A+B | very low - candidate Drop (verify) | File-share root only; `treeItem.createChild({ childType: <directory> })`. Palette: never. |
| `azureStorage.createSubdirectory` | Create Subdirectory... | A+B | very low - candidate Drop (verify) | File-share directory node. Palette: never. |
| `azureStorage.deleteDirectory` | Delete... | A+B | moderate - lean Migrate | `deleteFilesAndDirectories` (multi-select); file-share directories **and** blob directories. Palette: never. |
| `azureStorage.createFile` | Create Empty File... | A+B | very low - candidate Drop (verify) | File share / file-share directory; creates an empty text file via a name prompt, then runs `azureStorage.editFile`. Palette: never. |
| `azureStorage.createGpv2Account` | Create Storage Account... (`$(add)`) | A+B | high - high cancel, notable failure - Migrate + fix | Basic creation wizard (5.1). Also listed in `x-azResources.commands`. |
| `azureStorage.createGpv2AccountAdvanced` | Create Storage Account... (Advanced) | A+B | low - high failure and cancel - Migrate + fix | Advanced wizard (5.1). |
| `azureStorage.deleteFile` | Delete... | A+B | high - lean Migrate | `deleteFilesAndDirectories`; file-share files **and** blob files. Palette: never. |
| `azureStorage.createTable` | Create Table... | A+B | low - needs a human (low volume) | `showInputBox`, not a wizard (5.5). |
| `azureStorage.deleteTable` | Delete Table... | A+B | low - needs a human (low volume) | `deleteNode(context, TableTreeItem.contextValue, treeItem)`. |
| `azureStorage.createQueue` | Create Queue... | A+B | moderate - lean Migrate | `showInputBox`, not a wizard (5.5). |
| `azureStorage.deleteQueue` | Delete Queue... | A+B | low - needs a human (low volume) | `deleteNode(context, QueueTreeItem.contextValue, treeItem)`. |
| `azureStorage.uploadToAzureStorage` | Upload to Azure Storage... | A+B | high - cancel-dominant - needs a human | `explorer/context` only (`isFileSystemResource == true`, group `zzzz_azurestorage@1`); palette: never. Multi-select of local URIs (5.7). |
| `azureStorage.attachStorageAccount` | Attach Storage Account... (`$(plug)`) | A+B | high - cancel-dominant, notable failure - needs a human | Workspace-submenu entry (`2_attach@1`) + context entry on `attachedStorageAccounts`. `ext.attachedStorageAccountsTreeItem.attachWithConnectionString`. |
| `azureStorage.detachStorageAccount` | Detach Storage Account | A+B | moderate - lean Migrate | Picker fallback: `workspaceResourceTree.showTreeItemPicker(AttachedStorageAccountTreeItem.baseContextValue)`. |
| `azureStorage.startBlobEmulator` | Start Blob Emulator | A+B | high - high failure (Azurite absent or slow) - Migrate + fix | Registered with `emulatorTimeoutMS = 3000`. Palette: never. Click target of the `startBlobEmulator` generic node. |
| `azureStorage.startQueueEmulator` | Start Queue Emulator | A+B | moderate - lean Migrate | As above (3000 ms). Palette: never. |
| `azureStorage.reportIssue` | Report Issue... | A+B | very low - framework-provided - lean Migrate (framework) | `registerReportIssueCommand('azureStorage.reportIssue')`. |
| `azureStorage.generateSasUrl` | Generate & Copy SAS Token and URL | A+B | moderate - notable failure - Migrate + fix | `V_RG` views only (not the workspace tree). Builds `${resourceUri}/${remoteFilePath}?${sasToken}`, copies it with toast label `SAS Token and URL`, returns the URL. Palette: never. |
| `azureStorage.editBlob` | *(not contributed)* | **B** | very high - lean Migrate | Click command of `BlobTreeItem`; 250 ms debounce. Azure accounts -> `BlobContainerFS.showEditor`; attached -> `AzureStorageFS.showEditor` (4b). |
| `azureStorage.editFile` | *(not contributed)* | **B** | moderate - lean Migrate | Click command of `FileTreeItem`; 250 ms debounce; `AzureStorageFS.showEditor`. |
| `azureStorage.showOutputChannel` | *(not contributed)* | **B** | low - needs a human (low volume) | `ext.outputChannel.show()`; target of "View Output" actions. |
| `azureStorage.startTableEmulator` | *(not contributed)* | **B** | moderate - lean Migrate | 3000 ms timeout; click target of the `startTableEmulator` generic node. Has no manifest entry (so it is also absent from the palette). |
| `azureStorage.showAzuriteExtension` | *(not contributed)* | **B** | moderate - lean Migrate | `commands.executeCommand('extension.open', 'Azurite.azurite')`; linked from the "install Azurite" warning through a `command:` URI. |

> **Code-only commands (B):** `azureStorage.editBlob`, `azureStorage.editFile`, `azureStorage.showOutputChannel`, `azureStorage.startTableEmulator`, `azureStorage.showAzuriteExtension`.
> **`commandPalette` `when: never` (context-menu/programmatic only, 16):** `copyUrl`, `openBlobContainer`, `createBlockBlob`, `downloadTreeItems`, `generateSasUrl`, `openTable`, `openFileShare`, `createDirectory`, `createSubdirectory`, `deleteDirectory`, `createFile`, `deleteFile`, `openQueue`, `startBlobEmulator`, `startQueueEmulator`, `uploadToAzureStorage`. Additionally `openStorageAccount` has `when: !remoteName`.
> **Reachable only from a submenu or explorer context rather than the tree context menus:** `downloadSasUrl`, `attachStorageAccount` (also on the attached-root node), `createGpv2Account` and `createGpv2AccountAdvanced` (workspace submenu; also on the resource-type group node), `uploadToAzureStorage` and `deployStaticWebsite` (explorer context).
> **Orphan strings (DO NOT MIGRATE):** none in NLS (the file is `{}`). Vestigial items are listed in sections 2 and 8.

---

## 2. Settings / Configuration (A)

Contribution title: `Azure Storage`. 4 declared settings:

| Setting id | Type | Scope | Default | Notes (deprecation, enum, code usage) |
|---|---|---|---|---|
| `azureStorage.showExplorer` | boolean | window | `true` | "Show or hide the Azure Storage Explorer". **Vestigial: nothing in `src/**` reads it.** Candidate DEAD - do not migrate unless the human confirms the host reads it. No telemetry event. |
| `azureStorage.storageExplorerLocation` | string | window | `/Applications/Microsoft Azure Storage Explorer.app` | "[Mac only] ..." Read and **written** (global target) by `MacOSStorageExplorerLauncher` when the user picks "Browse". |
| `azureStorage.preDeployTask` | string | **resource** | *(none)* | Name of a VS Code task to run before a static-website deploy. Read via `getConfiguration('azureStorage', Uri.file(deployFsPath))` in `runPreDeployTask`. |
| `azureStorage.deleteBeforeDeploy` | boolean | window | `true` | "Delete all existing blobs before deploying to static website." Read by `BlobContainerTreeItem.deployStaticWebsiteCore` via `getWorkspaceSetting`. |

**Settings read in code but not declared in the manifest (B):**

| Setting | Where | Notes |
|---|---|---|
| `azureStorage.deployPath` | `showWorkspaceFoldersQuickPick(..., configurationSettingsKeys.deployPath)` in `storageAccountActionHandlers.ts` (deploy source folder) and `downloadFiles/DestinationPromptStep.ts` (download destination) | **Undeclared** (no schema, no settings UI), read per workspace folder as a sub-path (`quickPickUtils.ts` reads `<prefix>.<key>` for each folder). |
| `azurite.*` (`blobHost`, `blobPort`, `queueHost`, `queuePort`, `tableHost`, `tablePort`, `cert`, `key`, `skipApiVersionCheck`) | `AttachedStorageAccountTreeItem.ts`, `utils/azuriteUtils.ts` | Owned by the Azurite extension. Defaults: host `127.0.0.1`, ports `10000` / `10001` / `10002`; protocol `https` only if both `cert` and `key` are set. `azurite.skipApiVersionCheck` is **written** by the "Enable Skip API Version Check" action. |
| `azureResourceGroups.suppressActivityNotifications` | `utils/activityUtils.ts` | Owned by the Azure Resources extension; controls `suppressNotification` on activity contexts. |

**README-only settings (C, unverified; no code and no manifest entry - treat as stale docs):** `azureStorage.file.showSavePrompt`, `azureStorage.blob.showSavePrompt`.

---

## 3. Tree view (A branch + B behavior)

- **Registered under:** the host's `azureResourceGroups` / `azureFocusView` (application resources) and `azureWorkspace` (attached accounts + emulator). No own views. Resolver: `StorageAccountResolver` for `AzExtResourceType.StorageAccounts` (`microsoft.storage/storageaccounts`).
- **Resolver behavior (B):**
  - Resource Graph query over `microsoft.storage/storageaccounts` and `microsoft.classicstorage/storageaccounts`; results cached by lowercase resource id for 3 seconds; paged with the Resource Graph `skipToken`. Falls back to ARM `storageAccounts.getProperties(resourceGroup, name)` when Resource Graph does not return the account.
  - Telemetry callback `resolveResource` (`isActivationEvent = 'true'`). The resolved object carries `label`, `root`, `storageAccount`, the static-website methods (`getActualWebsiteHostingStatus`, `setWebsiteHostingProperties`, `ensureHostingCapable`, `configureStaticWebsite`, `disableStaticWebsite`, `browseStaticWebsite`) and `kind: 'microsoft.storage/storageaccounts'`.
- **Workspace provider (B):** `StorageWorkspaceProvider` is registered as workspace-resource provider `storageEmulator`; `provideResources()` (telemetry `StorageWorkspaceProvider.provideResources`) returns the single `AttachedStorageAccountsTreeItem`.

### Hierarchy with exact contextValues

```
SubscriptionTreeItem                      (host node; isAncestorOf: everything except -attached / -attached-emulated)
 +- StorageAccountTreeItem                'azureStorageAccount'
     +- BlobContainerGroupTreeItem        'azureBlobContainerGroup'        label 'Blob Containers'
     |   +- BlobContainerTreeItem         'azureBlobContainer'
     |       +- [generic] 'openInFileExplorer'   (click: azureStorage.openInFileExplorer)
     |       +- BlobDirectoryTreeItem     'azureBlobDirectory'
     |       |   +- BlobTreeItem          'azureBlobFile'                  (click: azureStorage.editBlob)
     |       |   +- BlobDirectoryTreeItem (nested)
     |       +- BlobTreeItem              'azureBlobFile'
     +- FileShareGroupTreeItem            'azureFileShareGroup'            label 'File Shares'
     |   +- FileShareTreeItem             'azureFileShare'
     |       +- [generic] 'openInFileExplorer'
     |       +- DirectoryTreeItem         'azureFileShareDirectory'
     |       |   +- FileTreeItem          'azureFile'                      (click: azureStorage.editFile)
     |       |   +- DirectoryTreeItem (nested)
     |       +- FileTreeItem              'azureFile'
     +- QueueGroupTreeItem                'azureQueueGroup'                label 'Queues'
     |   +- QueueTreeItem                 'azureQueue'
     +- TableGroupTreeItem                'azureTableGroup'                label 'Tables'
         +- TableTreeItem                 'azureTable'

AttachedStorageAccountsTreeItem           'attachedStorageAccounts'        label 'Attached Storage Accounts'  (workspace tree)
 +- AttachedStorageAccountTreeItem        'azureStorageAccount-attached'          (a connection-string account)
 +- AttachedStorageAccountTreeItem        'azureStorageAccount-attached-emulated' (the always-present 'Local Emulator')
     +- BlobContainerGroupTreeItem, QueueGroupTreeItem, TableGroupTreeItem   (same node classes as above)
     +- FileShareGroupTreeItem                                               (NON-emulated accounts only)
```

Group nodes, when an emulated account refuses connections, surface a generic click-through child instead of items: `startBlobEmulator` / `startQueueEmulator` / `startTableEmulator` with labels `Start Blob Emulator` / `Start Queue Emulator` / `Start Table Emulator`, commands `azureStorage.start<Blob|Queue|Table>Emulator`, `includeInTreeItemPicker: false` (condition: `root.isEmulated` and connection error `ECONNREFUSED`). On an Azurite API-version mismatch (`/API version .* is not supported by Azurite/i`) the group node instead offers to enable `azurite.skipApiVersionCheck` (telemetry callback `azureStorage.skipApiVersionCheck`) and restarts Azurite (`azurite.close`, `azurite.start`).

### Per-node details

| Node | Label / description | Icon | Children source / pagination | Notes |
|---|---|---|---|---|
| `StorageAccountTreeItem` | ARM account `name` | storage-account icon | Static groups, only for endpoints present in `primaryEndpoints` (`blob`, `file`, `queue`, `table`). `hasMoreChildren = false`. | `contextValuesToAdd = ['azureStorageAccount']`. Uses `StorageAccountWrapper` (non-null `id/name/type/primaryEndpoints/location`). `createRoot()` builds an `IStorageRoot` whose Blob/Share/Queue/Table service-client factories try the shared-key client first when `allowSharedKeyAccess` is true (account key from `getKey()`, validated with a `getProperties()` call) and fall back to the storage-scoped OAuth credential from `subscription.createCredentialsForScopes(['https://storage.azure.com/.default'])` when shared key is not allowed or the key client fails; `getAccessToken()` returns a token from that same OAuth credential, and `generateSasToken` throws when shared-key access is disabled. ARM calls (`createStorageClient`) use the subscription credential separately. `getKey()` (telemetry `storageAccountTreeItem.getKey`) caches `key1`/`primaryKey` and rejects when shared-key access is disabled. `initStorageAccount` failure telemetry: `storageAccount.initAccountFailed`; `getData()` (used by `viewProperties`) wraps lazy account initialization (`initStorageAccount`) in telemetry event `getData.initSite` when the account has not been loaded yet. `getActualWebsiteHostingStatus()` reads blob-service properties (`getProperties()`) on every call and caches nothing. |
| `BlobContainerGroupTreeItem` | `Blob Containers` | blob-container icon | `listContainers().byPage` (attached) / ARM-plane listing (Azure account); continuation token; `maxPageSize = 50` | Telemetry `listAzureContainers`. Refresh clears the token. `createChildImpl` -> container wizard. `isAncestorOf` `azureBlobContainer`. |
| `BlobContainerTreeItem` | container name | blob-container icon; **static-websites icon** when it is `$web` with hosting enabled | shared `loadMoreBlobChildren` (`src/utils/blobUtils.ts`): `listBlobsByHierarchy('/')` with no prefix, one page per load (`byPage`, `maxPageSize` **50**, **500** for emulated accounts), continuation token kept on the node; `blobItems` become `BlobTreeItem`, `blobPrefixes` (virtual directories) become `BlobDirectoryTreeItem` | Implements `ICopyUrl`, `ITransferSrcOrDstTreeItem`. First child is the generic `openInFileExplorer` node (label `Open in Explorer...`). Hosts `deployStaticWebsite`, `createChildImpl` (directory or blob), `deleteTreeItemImpl`. `transferSasToken`: account SAS, services `b`, resource types `co`, permissions `rwl`, expiry now + 3 days. |
| `BlobDirectoryTreeItem` | directory path/name | folder icon | shared `loadMoreBlobChildren`: `listBlobsByHierarchy('/', { prefix: dirPath })` where `dirPath` always ends in `/`; same page sizes (50, or 500 emulated), blob items and `blobPrefixes` mapped as for the container; continuation token | `ICopyUrl`, `ITransferSrcOrDstTreeItem`; recursive delete (`DeleteBlobDirectoryStep`); SAS as above. |
| `BlobTreeItem` | blob name | file icon | leaf | Click `azureStorage.editBlob`. Telemetry: measurement `blobDownloadSize`, property `invalidBlobTypeForDownload`. Delete via `DeleteBlobStep`. |
| `FileShareGroupTreeItem` | `File Shares` | file-share icon | `ShareServiceClient.listShares().byPage`; page size 50 | `createChildImpl` -> share wizard (name + quota). `isAncestorOf` `azureFileShare`, `azureFileShareDirectory`, `azureFile`. |
| `FileShareTreeItem` | share name | file-share icon | `listFilesAndDirectories` (root); continuation token | First child generic `openInFileExplorer`. `createChildImpl` handles upload (`localFilePath` + `remoteFilePath`), empty file, or directory. SAS `rwl`, 3 days. |
| `DirectoryTreeItem` | directory name | folder icon | `DirectoryClient.listFilesAndDirectories().byPage` | Create file/subdirectory; recursive delete (`deleteDirectoryAndContents`). |
| `FileTreeItem` | file name | file icon | leaf | Click `azureStorage.editFile`. |
| `QueueGroupTreeItem` | `Queues` | queue icon | `listQueues().byPage`; page size 50 | `createChildImpl`: `showInputBox` (`Enter a name for the new queue`), validation `validateQueueName`, progress `Azure Storage: Creating queue '{name}'`. |
| `QueueTreeItem` | queue name | queue icon | leaf (no message browsing) | Delete only. |
| `TableGroupTreeItem` | `Tables` | table icon | `TableServiceClient.listTables().byPage`; page size 50 | `createChildImpl`: `showInputBox` (`Enter a name for the new table`), `validateTableName`. |
| `TableTreeItem` | table name | table icon | leaf (no entity browsing) | Delete only. |
| `AttachedStorageAccountsTreeItem` | `Attached Storage Accounts` | `ThemeIcon('plug')` | `getAttachedAccounts()`; `hasMoreChildren = false`; `childTypeLabel = 'Account'` | Persistence: global-state key `ms-azuretools.vscode-azurestorage.connectionStrings2` (JSON array of `{ fullId }`), connection strings in `context.secrets` under `<serviceName><fullId>`. **The emulator account is always appended at load and never persisted.** Load failure: `Failed to load persisted Storage Accounts. Accounts must be reattached manually.` Duplicate attach: `Storage Account "{0}" is already attached.` Attach prompt `Enter the connection string for your storage account`; accepted if `BlobServiceClient.fromConnectionString` parses it and it contains `DefaultEndpointsProtocol`, `AccountName`, `AccountKey` (else `Connection string must match format "DefaultEndpointsProtocol=...;AccountName=...;AccountKey=...;"`); attaching `UseDevelopmentStorage=true;` is rejected with `Local emulator is already attached.` Account name from `AccountName` (fallback `devstoreaccount1`). `isAncestorOf`: everything except `azureStorageAccount` and the subscription context value. |
| `AttachedStorageAccountTreeItem` | account name, or `Local Emulator` when emulated | storage-account icon | four groups (three for the emulator) | `id` = account name; `autoSelectInTreeItemPicker`; `AttachedStorageRoot` builds data-plane clients from the connection string (emulator: Azurite host/port settings + hard-coded `devstoreaccount1` key; 2-try retry policy). ARM/OAuth/subscription members throw `Cannot retrieve ... for an attached account.` (`AttachedAccountRoot`: `Cannot retrieve Azure subscription information for an attached account.`). Static-website status is read from blob service properties. |

Interfaces (migration contract): `IStorageRoot { storageAccountName, storageAccountId, tenantId, isEmulated, allowSharedKeyAccess, primaryEndpoints?, getAccessToken(), generateSasToken(values), getStorageManagementClient(ctx), createBlobServiceClient(), createShareServiceClient(), createQueueServiceClient(), createTableServiceClient() }`; `IStorageTreeItem { root }`; `ICopyUrl { getUrl?(), copyUrl() }`; `ITransferSrcOrDstTreeItem extends IStorageTreeItem { remoteFilePath, resourceUri, transferSasToken }`.

### Menus (A) - `view/item/context` (67 entries)

Abbreviations: `V_ALL` = `view =~ /azure(Workspace|ResourceGroups|focusView)/i && ...`; `V_RG` = `view =~ /(azureResourceGroups|azureFocusView)/ && ...`. The text after the prefix is the verbatim remainder of the `when`. The `||` tails on three entries bind looser than the view clause, so the second alternative is not view-restricted - preserved as authored.

| Command | View clause | `viewItem` / extra clause | Group |
|---|---|---|---|
| `createGpv2Account` | `view == azureResourceGroups` | `viewItem =~ /azureResourceTypeGroup/ && viewItem =~ /storageaccounts/i` | 1@1 |
| `createGpv2AccountAdvanced` | `view == azureResourceGroups` | `viewItem =~ /azureResourceTypeGroup/ && viewItem =~ /storageaccounts/i` | 1@2 |
| `openStorageAccount` | `V_RG` | `viewItem =~ /azureStorageAccount/ && !isWeb && !isLinux && !remoteName` | navigation@1 |
| `openInFileExplorer` | `V_ALL` | `viewItem == azureFileShare \|\| viewItem == azureBlobContainer` | navigation@3 |
| `openInFileExplorer` | `V_ALL` | `viewItem == azureFileShare \|\| viewItem == azureBlobContainer` | inline |
| `copyConnectionString` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 5_cutcopypaste@1 |
| `copyPrimaryKey` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 5_cutcopypaste@2 |
| `browseStaticWebsite` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 6_staticwebsites@1 |
| `deployStaticWebsite` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 6_staticwebsites@2 |
| `configureStaticWebsite` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 6_staticwebsites@3 |
| `disableStaticWebsite` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 6_staticwebsites@4 |
| `deleteStorageAccount` | `V_RG` | `viewItem =~ /azureStorageAccount/` | 7_modification |
| `createBlobContainer` | `V_ALL` | `viewItem == azureBlobContainerGroup` | 2_create |
| `refresh` | `V_ALL` | `viewItem == azureBlobContainerGroup` | 9_refresh |
| `openBlobContainer` | `V_ALL` | `viewItem == azureBlobContainer && !isWeb && !isLinux && !remoteName` | navigation@1 |
| `createBlockBlob` | `V_ALL` | `viewItem == azureBlobContainer` | 2_create@1 |
| `uploadFiles` | `V_ALL` | `viewItem == azureBlobContainer` | 2_create@2 |
| `uploadFolder` | `V_ALL` | `viewItem == azureBlobContainer` | 2_create@3 |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureBlobContainer` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureBlobContainer` | 5_cutcopypaste |
| `generateSasUrl` | `V_RG` | `viewItem == azureBlobContainer` | 5_cutcopypaste@2 |
| `browseStaticWebsite` | `V_ALL` | `viewItem == azureBlobContainer` | 6_staticwebsites@1 |
| `deployStaticWebsite` | `V_ALL` | `viewItem == azureBlobContainer` | 6_staticwebsites@2 |
| `configureStaticWebsite` | `V_ALL` | `viewItem == azureBlobContainer` | 6_staticwebsites@3 |
| `disableStaticWebsite` | `V_ALL` | `viewItem == azureBlobContainer` | 6_staticwebsites@4 |
| `deleteBlobContainer` | `V_ALL` | `viewItem == azureBlobContainer` | 7_modification |
| `refresh` | `V_ALL` | `viewItem == azureBlobContainer` | 9_refresh |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureBlobFile` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureBlobFile` | 5_cutcopypaste@1 |
| `generateSasUrl` | `V_RG` | `viewItem == azureBlobFile` | 5_cutcopypaste@2 |
| `deleteFile` | `V_ALL` | `viewItem == azureFile \|\| viewItem == azureBlobFile` | 7_modification |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureBlobDirectory` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureBlobDirectory` | 5_cutcopypaste@1 |
| `generateSasUrl` | `V_RG` | `viewItem == azureBlobDirectory` | 5_cutcopypaste@2 |
| `deleteDirectory` | `V_ALL` | `viewItem == azureFileShareDirectory \|\| viewItem == azureBlobDirectory` | 7_modification |
| `createFileShare` | `V_ALL` | `viewItem == azureFileShareGroup` | 2_create |
| `refresh` | `V_ALL` | `viewItem == azureFileShareGroup` | 9_refresh |
| `openFileShare` | `V_ALL` | `viewItem == azureFileShare && !isWeb && !isLinux && !remoteName` | navigation@1 |
| `createFile` | `V_ALL` | `viewItem == azureFileShare` | 2_create@1 |
| `createDirectory` | `V_ALL` | `viewItem == azureFileShare` | 2_create@2 |
| `uploadFiles` | `V_ALL` | `viewItem == azureFileShare` | 2_create@3 |
| `uploadFolder` | `V_ALL` | `viewItem == azureFileShare` | 2_create@4 |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureFileShare` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureFileShare` | 5_cutcopypaste@1 |
| `generateSasUrl` | `V_RG` | `viewItem == azureFileShare` | 5_cutcopypaste@2 |
| `deleteFileShare` | `V_ALL` | `viewItem == azureFileShare` | 7_modification |
| `refresh` | `V_ALL` | `viewItem == azureFileShare` | 9_refresh |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureFile` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureFile` | 5_cutcopypaste@1 |
| `generateSasUrl` | `V_RG` | `viewItem == azureFile` | 5_cutcopypaste@2 |
| `createFile` | `V_ALL` | `viewItem == azureFileShareDirectory` | 2_create@1 |
| `createSubdirectory` | `V_ALL` | `viewItem == azureFileShareDirectory` | 2_create@2 |
| `downloadTreeItems` | `V_ALL` | `viewItem == azureFileShareDirectory` | 3_download |
| `copyUrl` | `V_ALL` | `viewItem == azureFileShareDirectory` | 5_cutcopypaste@1 |
| `generateSasUrl` | `V_RG` | `viewItem == azureFileShareDirectory` | 5_cutcopypaste@2 |
| `refresh` | `V_ALL` | `viewItem == azureFileShareDirectory` | 9_refresh |
| `createQueue` | `V_ALL` | `viewItem == azureQueueGroup` | 2_create |
| `refresh` | `V_ALL` | `viewItem == azureQueueGroup` | 9_refresh |
| `openQueue` | `V_ALL` | `viewItem == azureQueue && !isWeb && !isLinux && !remoteName` | navigation@1 |
| `deleteQueue` | `V_ALL` | `viewItem == azureQueue` | 7_modification |
| `createTable` | `V_ALL` | `viewItem == azureTableGroup` | 2_create |
| `refresh` | `V_ALL` | `viewItem == azureTableGroup` | 9_refresh |
| `openTable` | `V_ALL` | `viewItem == azureTable && !isWeb && !isLinux && !remoteName` | navigation@1 |
| `deleteTable` | `V_ALL` | `viewItem == azureTable` | 7_modification |
| `attachStorageAccount` | `view == azureWorkspace` | `viewItem == attachedStorageAccounts` | 2_create |
| `detachStorageAccount` | `V_ALL` | `viewItem == azureStorageAccount-attached` | 7_modification |
| `refresh` | `V_ALL` | `viewItem == attachedStorageAccounts` | 9_refresh |

Command/node contract notes:
- Storage-account entries (static website, key/connection string, delete) use the **unanchored** regex `viewItem =~ /azureStorageAccount/` and are restricted to `V_RG` views, so they never appear in the `azureWorkspace` view where `-attached` accounts live. The code additionally throws `Static website commands are not supported for attached accounts.` if invoked on an attached node.
- `generateSasUrl` is `V_RG`-only (not offered in the workspace tree); the other copy/transfer entries use `V_ALL`.
- The emulated account (`azureStorageAccount-attached-emulated`) has **no** detach entry (its context value does not equal `azureStorageAccount-attached`).
- No `refresh` entry exists for `azureStorageAccount`, `azureBlobDirectory`, files, blobs, queues, or tables.

### Other menus

- **`view/title` (1):** submenu `azureStorage.submenus.workspaceActions` when `view == azureWorkspace`, group `navigation@5`.
- **`explorer/context` (2):** `deployStaticWebsite` when `explorerResourceIsFolder == true` (group `zzz_azuretools_deploy@3`); `uploadToAzureStorage` when `isFileSystemResource == true` (group `zzzz_azurestorage@1`).
- **`commandPalette` (17):** see section 1.

### Submenus (A)

`azureStorage.submenus.workspaceActions` - label `Azure Storage`, icon `resources/storageAccount.png` (light and dark), hosted in `view/title` of `azureWorkspace`. Members: `downloadSasUrl` (`1_download@1`), `attachStorageAccount` (`2_attach@1`), `createGpv2Account` (`3_create@1`), `createGpv2AccountAdvanced` (`3_create@2`).

---

## 4. Debugging + tasks (A + B)

None. 0 debuggers, 0 debug providers, 0 task providers or definitions, 0 problemMatchers. (The static-website deploy flow **consumes** a user task through `preDeployTask`; see 5.3.)

### 4b. Virtual file systems (B)

Two `FileSystemProvider`s let VS Code edit and browse remote blobs/files as local-looking documents and workspace folders. They underpin the click-to-edit commands and "Open in Explorer".

**`azurestorage` (`AzureStorageFS`)** - file shares (all accounts) and attached-account blob containers. Also a `TextDocumentContentProvider` for the same scheme (`readFile` -> string).
- URI: `azurestorage:///<root>/<path>?resourceId=<treeResourceId>` (`AzureStorageFS.idToUri`). `resourceId` identifies the tree root (`/File Shares/<share>`, `/Blob Containers/<container>` for attached, `/attachedStorageAccounts/<...>`; v1 and v2 Resource Groups ids supported). The query is cached per root name; ambiguous query-less URIs fail with `Cannot auto-detect resource path. For this functionality, re-load VS Code and only open one resource per workspace.` (other errors: `No URI query cache available.`, `Invalid uri. Cannot view or modify <uri>.`).
- Tree resolution: attached -> `ext.rgApi.workspaceResourceTree.findTreeItem`; Azure -> `ext.rgApi.appResourceTree.findTreeItem` after resolving the parent app resource.
- Operations: `watch` is a no-op; `stat` (properties; 404 -> `FileNotFound`; callback `stat`, **`suppressIfSuccessful`**); `readDirectory` (callback `readDirectory`, **`suppressIfSuccessful`**); `createDirectory` (name validation, nested); `readFile` (`downloadToBuffer`; `suppressDisplay`); `writeFile` (create/overwrite flags; out-of-sync check `Your Azure Storage file system is out of sync and must be refreshed.`; trailing slash rejected; progress `Saving file`/`Saving blob`/`Creating file`/`Creating blob`); `delete` (recursive only: `Azure storage does not support nonrecursive deletion of folders.`); `rename` (**unsupported**: `Moving folders or files is not supported.` / `Renaming folders or files is not supported.`); `copy` not implemented. Change events are coalesced for 5 ms (`fireSoon`); `fireCreateEvent`/`fireDeleteEvent` are invoked by tree items; deletes also refresh the workspace tree.
- Error-mapping helper `getFileSystemError` sets `telemetry.suppressAll = true`, `errorHandling.rethrow = true`, `suppressDisplay = true`.

**`azurestorageblob` (`BlobContainerFS`)** - Azure-account blob containers, including hierarchical-namespace (HNS / Data Lake) accounts.
- URI: `azurestorageblob:///<container>[/<blobPath>]?storageAccountId=<armId>` (`constructUri`, `idToUri`).
- Auth: subscription lookup `ext.rgApi.getSubscriptions(false)` (`Could not find subscription with ID "<id>"`); ARM `getProperties`; OAuth (storage-scoped credential, `https://storage.azure.com/.default`) is selected only when `allowSharedKeyAccess === false`; otherwise `key1`/`primaryKey` from `listKeys`. Missing endpoints/keys: `Unable to get blob endpoint.`, `Unable to get dfs endpoint.`, `Unable to get key credential.`
- Operations: `stat` (flat accounts probe `getProperties` then a prefix listing for virtual directories; HNS uses `hdi_isfolder` metadata; 403 -> `NoPermissions`); `readDirectory` (`listBlobsByHierarchy('/')`, page size 1000); `createDirectory` (HNS only via Data Lake; flat accounts: `Creating directories is not supported for non-HNS enabled storage accounts.`); `readFile`; `writeFile` (`uploadData`, content type from `mime.getType(uri.path)`); `delete` (recursive only; flat: batched deletes with `Promise.allSettled`, cancellation-aware; HNS: Data Lake `deleteIfExists`); `rename` (HNS only via `pathClient.move`; flat: `Rename is not supported in a flat namespace storage account.`; with `overwrite: true` an existing destination is still rejected with `FileExists`); `copy` not implemented.
- Callbacks: `azureStorageBlob.stat|readDirectory|createDirectory|readFile|writeFile|delete|rename`; none sets `suppressIfSuccessful` or `suppressAll`.
- **Attached-account blob containers are intentionally not served by `BlobContainerFS`** (`@todo: Support attached accounts in BlobContainerFS` in the source); they use `azurestorage`.

**Edit flow:** `azureStorage.editBlob` / `azureStorage.editFile` -> `showEditor`: reads properties, rejects files larger than `maxRemoteFileEditSizeBytes` (50 MB) with `Failed to open "<uri>". Cannot edit remote files larger than <N>MB.` plus a `Download file instead` action that invokes the download flow (then `UserCancelledError`); otherwise `workspace.openTextDocument` + `showTextDocument({ preserveFocus: false, preview: false })`. Saving writes back through the provider's `writeFile`.

---

## 5. Wizards (B)

**11 `AzureWizard` flows** (counting the basic/advanced account builder once), each listed with its entry command(s):

| # | Flow | Command(s) |
|---|---|---|
| 1 | Create storage account (basic or advanced variant of one builder) | `createGpv2Account`, `createGpv2AccountAdvanced` |
| 2 | Configure static website | `configureStaticWebsite` (and deploy/enable chains) |
| 3 | Delete storage account | `deleteStorageAccount` |
| 4 | Delete blob | `deleteFile` on `azureBlobFile` |
| 5 | Delete blob directory | `deleteDirectory` on `azureBlobDirectory` |
| 6 | Create blob container | `createBlobContainer` |
| 7 | Create file share | `createFileShare` |
| 8 | Open in file explorer | `openInFileExplorer` |
| 9 | Upload files | `uploadFiles`, `uploadToAzureStorage` |
| 10 | Upload folder | `uploadFolder`, `uploadToAzureStorage` |
| 11 | Download (tree items / SAS URL) | `downloadTreeItems`, `downloadSasUrl` |

Non-wizard interactive flows (~14): create queue, create table, create block blob, create file, create directory / subdirectory, attach storage account, detach, copy URL / key / connection string, generate SAS URL, deploy static website, upload-to-Azure-Storage selection handling, delete file/directory/share/queue/table/container through `deleteTreeItem` + modal confirmation, start emulator, open in Storage Explorer.

### 5.1 Create storage account (basic and advanced) - provisioning record

Source: `commands/createStorageAccount.ts`; shared steps from `@microsoft/vscode-azext-azureutils` (`StorageAccountNameStep`, `StorageAccountCreateStep`, `ResourceGroupCreateStep`, `ResourceGroupListStep`, `LocationListStep`, `VerifyProvidersStep`). The extension's own `tree/createWizard/storageAccountNameStep.ts` is **not referenced** (dead code) - do not migrate.

- Entry: `createStorageAccount(context, treeItem?)`. No tree item -> `appResourceTree.showTreeItemPicker(SubscriptionTreeItem.contextValue)`. Wizard context = `IStorageAccountWizardContext & ExecuteActivityContext` with `includeExtendedLocations = true` and `createActivityContext({ withChildren: true })`. Wizard title `Create storage account`; activity title `Create storage account "{0}"`.
- **Prompt steps (ordered):**
  1. `StorageAccountNameStep` (shared): `showInputBox` (`Enter the name of the new storage account.`), sync validation 3-24 chars (`storageAccountNamingRules`), lowercase letters and digits only, async `checkNameAvailability({ name, type: 'Microsoft.Storage/storageAccounts' })`; masks the value; starts a `relatedNameTask` that proposes a related resource-group name. Skipped if `newStorageAccountName` is already set.
  2. *Advanced only:* `ResourceGroupListStep` (pick or create a group), then `StaticWebsiteEnableStep` (quick pick `Would you like to enable static website hosting?` with `Yes`/`No`; its sub-wizard adds `StaticWebsiteIndexDocumentStep` + `StaticWebsiteErrorDocument404Step` when Yes; forced `false` on custom clouds).
  3. `LocationListStep` (provider filter `Microsoft.Storage` / `storageAccounts`; extended locations shown with description `Only supports Premium storage accounts`).
  4. `StartingResourcesLogStep` (activity info children + output lines `Using resource group "{0}".`, `Using location: "{0}".`).
- **Execute steps (runtime order):** the wizard registers them in a different order (`StorageAccountCreateStep`, `StorageAccountTreeItemCreateStep`, `StaticWebsiteConfigureStep`, `VerifyProvidersStep`, then `ResourceGroupCreateStep` in basic mode), but `AzureWizard.execute()` sorts by `priority` and runs the smallest value first. Steps with `shouldExecute() === false` are skipped.
  1. `VerifyProvidersStep(['Microsoft.Storage'])` (shared, priority 90): always runs.
  2. `ResourceGroupVerifyStep` (shared, 95): *advanced only*, added by the `ResourceGroupListStep` sub-wizard when `Create new resource group` is picked; runs only while no `resourceGroup` is set and the new name has not already been verified.
  3. `ResourceGroupCreateStep` (shared, 100): *basic* (always registered; creates the new group named from `relatedNameTask`) or *advanced when a new resource group is selected* (added by the `ResourceGroupListStep` sub-wizard). Skipped when `resourceGroup` is already set, including when `configureBeforeExecute` finds an existing group with that name. On an HTTP 403 it continues and adds `ResourceGroupNoCreatePermissionsSelectStep` (101) to select an existing group instead.
  4. `StorageAccountCreateStep` (shared, 130): ARM `storageAccounts.beginCreateAndWait(resourceGroup, name, params)`; skipped if `storageAccount` is already set.
  5. `StorageAccountTreeItemCreateStep` (170): always runs; builds the `StorageAccountTreeItem`, calls `initStorageAccount`, sets `activityResult` to `{ id, name, type }`.
  6. `StaticWebsiteConfigureStep` (200): runs only when `enableStaticWebsite` is true (always in basic mode except on custom clouds; the user's answer in advanced mode); writes blob-service `staticWebsite { enabled: true, indexDocument, errorDocument404Path }` through the data-plane client; refreshes the account node.
- **Basic-vs-advanced deltas:** basic auto-fills a **new** resource group and sets `enableStaticWebsite = true`, `indexDocument = 'index.html'`, `errorDocument404Path = '404.html'` (on custom clouds: `false`, `''`, `''`); advanced prompts for the resource group and the static-website choice (plus index/404 documents when enabled). Both use kind `StorageV2` (`Storage` on custom clouds), performance `Standard`, replication `LRS`.
- **Provisioning topology:**
  - Primary: `Microsoft.Storage/storageAccounts`. Deployment scope: resource group (ARM SDK call, not an ARM/Bicep deployment).
  - Prerequisites (run before the account is created): resource-provider registration verified for `Microsoft.Storage`, then `Microsoft.Resources/resourceGroups` (created in basic mode; selected or, when a new group is chosen, verified and created in advanced mode).
  - Post-create data-plane dependent step: blob-service static-website properties, written only when static website hosting is enabled (the `$web` container is later found/created through `getWebsiteCapableContainer`).
  - Request properties (from the shared `StorageAccountCreateStep`): `sku.name = <performance>_<replication>` = `Standard_LRS`; `kind`; `location`; `enableHttpsTrafficOnly = true`; `allowBlobPublicAccess = false`; `defaultToOAuthAuthentication = true`; `allowSharedKeyAccess = !context.disableSharedKeyAccess` (default: shared key allowed). No tags, network ACLs, minimum TLS, HNS, access tier, or encryption settings are set.
  - Required inputs: subscription, resource group, location, globally-unique account name (3-24 lowercase alphanumeric). Outputs consumed afterward: `storageAccount` (id, name, type, `primaryEndpoints`), the account tree item, `activityResult` (activity log link), `appResourceTree.refresh`, and `showEnableWebsiteHostingPrompt = false` (suppresses the enable-hosting prompt for deploy/browse chains).
- Source-of-truth caveat: the shared-step priorities, conditions, and the request-property list reflect `microsoft/vscode-azuretools` `azure/src/wizard/*.ts` and `utils/src/wizard/AzureWizard.ts` at `main` (no release tag exists for the pinned version); the extension locks `@microsoft/vscode-azext-azureutils@4.1.1` (`^4.1.1`) and `@microsoft/vscode-azext-utils@^4.1.0`, so these values should be re-confirmed against the published packages before migration.

### 5.2 Configure / disable / browse static website (`StorageAccountTreeItem`)

- **Configure prompts:** `StaticWebsiteIndexDocumentStep(oldIndex)` - `Enter the index document name`, default = current value (else `index.html`); length 3-255, must not contain `/` (`The index document path cannot contain a "/" character.`, `The index document path must be between 3 and 255 characters in length.`). `StaticWebsiteErrorDocument404Step(old404)` - `Enter the 404 error document path`, default = current value (else `404.html`); length 3-255, must not start or end with `/` (`The error document path start or end with a "/" character.`, `The error document path must be between 3 and 255 characters in length.`).
- **Configure execute:** `StaticWebsiteConfigureStep(account, previouslyEnabled)` (priority 200). Wizard title `Configure static website`. Activity labels `Enable static website hosting for storage account "{0}"` / `Update static website hosting config for storage account "{0}"`; progress `Configuring static website hosing for storage account "{0}"...` (sic); success `The storage account "{0}" has been enabled for static website hosting.` or `Static website hosting configuration updated for storage account "{0}".` followed by ` Index document: "{0}", 404 error document: "{1}"`.
- **Gating (`selectStorageAccountTreeItemForCommand`):** attached accounts rejected; resolves the account from an account or `$web`-container node; `ensureHostingCapable` (`Only general purpose V2 storage accounts support static website hosting.` / `This storage account does not support static website hosting.`); for deploy (`configureWebsite: true`) with hosting off and `showEnableWebsiteHostingPrompt`, shows a modal `Website hosting is not enabled on storage account "{name}".` with `Enable website hosting` before configuring.
- **Disable:** modal `Are you sure you want to disable static web hosting for the account '{0}'?` (button `Disable`), sets `staticWebsite.enabled = false`, shows `Static website hosting has been disabled for account {0}.`, refreshes the node; if already disabled: `Account '{0}' does not currently have static website hosting enabled.`
- **Browse:** when hosting is off (`Static website hosting is not enabled for this storage account.`) or no index document is set (`No index document has been set for this website.`) shows an error with a `Configure website hosting` action; otherwise opens the primary web endpoint (`Could not retrieve the primary web endpoint for {0}` if missing).

### 5.3 Deploy static website (`storageAccountActionHandlers.ts` + `BlobContainerTreeItem.deployStaticWebsite`)

1. Target disambiguation (`eventVersion = 2`): explorer folder `Uri` (scheme `azurestorage` is rejected: `Deploying an Azure resource from the Explorer is not supported.`), storage account node, `$web` container node, or palette.
2. Source folder: `showWorkspaceFoldersQuickPick('Select the folder to deploy', ..., 'deployPath')` if not provided.
3. Destination account via `selectStorageAccountTreeItemForCommand({ mustBeWebsiteCapable: true, configureWebsite: true })`; `$web` container via `getWebsiteCapableContainer` (error `Could not find $web blob container for storage account "{label}"`).
4. Pre-deploy task (`azureStorage.preDeployTask`): finds a task whose name equals the setting (case-insensitive) and whose workspace scope contains the source path, executes it, waits for exit code 0 (`Pre-deploy task "{name}" failed with exit code "{code}".`; not found: `Failed to find pre-deploy task "{task}". Modify your tasks or the setting "azureStorage.preDeployTask".`).
5. Deploy (`deployStaticWebsiteCore`): wrapped in `p-retry` (4 retries, 2 s minimum timeout, **retried only for `server failed to authenticate`**; `deployAttempt` telemetry). If `azureStorage.deleteBeforeDeploy` (default true) it lists existing blobs with `listAllBlobs()` (a flat `listBlobsFlat().byPage` loop, `maxPageSize` 5000, cancellation-aware) and, when any exist, shows a modal `The storage container "{account}/{container}" contains {N} files. Deploying will delete all of these existing files.  Continue?` with `Delete and Deploy` (cancel -> `cancelStep = 'AreYouSureYouWantToDeleteExistingBlobs'`), deletes them (`TransferProgress` `Deleting`), then uploads the folder with `uploadLocalFolder` (optionally into a destination blob folder) with progress and cancellation.
6. Success: logs the primary web endpoint and shows `Deployment complete. The primary web endpoint is {endpoint}` with a `Browse to website` button that runs `azureStorage.browseStaticWebsite`.

### 5.4 Delete flows

- **Delete storage account:** `StorageAccountTreeItem.deleteTreeItemImpl` -> `DeleteConfirmationStep` (`Are you sure you want to delete account "{0}" and all its contents?`, standard Delete/Cancel) -> `DeleteStorageAccountStep` (priority 100): ARM `storageAccounts.delete(resourceGroupName, name)`; progress `Deleting storage account "{0}"...`; success `Successfully deleted storage account "{0}".` (output channel + information message). Activity title `Delete storage account "{0}"`.
- **Delete blob:** confirm `Are you sure you want to delete the blob '{0}'?` (title `Delete blob "{0}"`) -> `DeleteBlobStep` (100) `blobClient.delete()`; `Successfully deleted blob "{0}".`; notification suppressed when `suppressNotification`.
- **Delete blob directory:** confirm `Are you sure you want to delete the blob directory '{0}' and all its contents?` (title `Delete directory "{0}"`) -> `DeleteBlobDirectoryStep` (100): recursive, children use `suppressMessage`; failures logged as `Cannot delete {blobPath}. {error}` with a `View Output` warning; success `Successfully deleted directory "{0}".`
- **Shared orchestration:** `deleteFilesAndDirectories` (multi-select; deletes the focused node even if it is not in the selection; tolerates already-deleted nodes); `deleteNode(context, expectedContextValue, node)` picks via `pickAppResource({ suppressCreatePick: true }, { filter: storageFilter, expectedChildContextValue })`. File-share, share, share-directory, queue, table, and container deletes use the tree item's `deleteTreeItemImpl` behind a modal confirmation. Recursive file-share directory delete callback: `deleteDirectoryAndContents`.

### 5.5 Create child flows

- **Create blob container (wizard):** `BlobContainerNameStep` - `Enter a name for the new blob container`; empty rejected; 3-63 chars; lowercase letters/digits/hyphens; no leading/trailing hyphen; no consecutive hyphens; existing names (loaded up front) rejected with `The blob container "{0}" already exists`. No execute step - `createChildImpl` creates the container and returns a `BlobContainerTreeItem`.
- **Create file share (wizard):** `FileShareNameStep` - `Enter a name for the new file share`; rules: `Share name cannot be empty`, `cannot contain spaces`, `must contain between {0} and {1} characters`, `can only contain lowercase letters, numbers and hyphens`, `cannot contain two hyphens in a row`, `cannot begin or end with a hyphen`, existing `The file share "{0}" already exists`. `StorageQuotaPromptStep` - `Specify quota (in GB, between {0} and {1}), to limit total storage size` (`Value must be a number`, `Value must be between {0} and {1}`). No execute step - `createChildImpl` creates the share with the quota.
- **Create queue / table (input box):** `Enter a name for the new queue` / `... table`; existing names pre-listed; `validateQueueName` / `validateTableName`; empty input -> `UserCancelledError`; progress `Azure Storage: Creating queue '{name}'`.
- **Create block blob (input box):** `getBlobPath` (`Enter a name for the new block blob`; `validateBlobName`: 1-1024 chars, must not end with `/`, `\`, or `.`; existing -> `A blob with this path and name already exists`), auto-creates intermediate virtual directories, creates an empty blob, then opens it in the editor.
- **Create directory / file (input box):** blob directories validate with `validateBlobDirectoryName` (`Directory name cannot be empty or contain '\'`); share directories/files validate with `validateFileOrDirectoryName` (1-255 chars, none of `" / \ : | < > ? *`: `Name cannot contain the following characters: ", /, \, :, |, <, >, ?, *`). `createFile` creates an empty text file then opens it with `azureStorage.editFile`.

### 5.6 Open in file explorer

`OpenBehaviorStep` (quick pick `Select how you would like to open this resource`: `Open in current window`, `Open in new window`, `Add to workspace`; skipped for `AlreadyOpen`/`DontOpen`; forced to `OpenInNewWindow` for emulated resources) -> `OpenTreeItemStep` (priority 250, `hideStepCount`): Azure blob container -> `BlobContainerFS.constructUri(container, accountId)`; Azure file share -> `azurestorage:///<name>?resourceId=<accountId>&name=<name>`; attached -> `AzureStorageFS.idToUri(fullId)`. `AddToWorkspace` -> `workspace.updateWorkspaceFolders(count, 0, { uri })` + `workbench.view.explorer` (falls back to current-window when no folders are open); otherwise `vscode.openFolder(uri, forceNewWindow)`. No explicit web/remote branch.

### 5.7 Upload / download (AzCopy)

- **Upload files** (`uploadFiles(context, treeItem?, selectedNodes?, uris?, cancellationToken?, destinationDirectory?)`): `GetFileDestinationDirectoryStep` (prompt) -> `UploadFilesStep` (priority 100). Activity title `Upload "{0}" to "{1}"` / `Upload {0} files to "{1}"`. **Upload folder:** `GetFolderDestinationDirectoryStep` -> `UploadFolderStep` (100). Both check destination conflicts and prompt for overwrite handling (`OverwriteChoice`, asked once per run) and refresh the destination. Targets: blob container or file share (palette: `pickAppResource` with `storageFilter` and expected child context values `azureBlobContainer` / `azureFileShare`).
- **`uploadToAzureStorage`** (explorer): picks the destination container/share via `pickAppResource`, prompts for a destination directory, rejects `azurestorage` URIs (`Cannot upload to Azure from an Azure resource.`), separates files/folders, drops nested selections already covered by a selected parent, checks overwrite once, runs folders then files under a cancellable notification progress, aggregates errors (a single error is rethrown; multiple become `multipleAzCopyErrorsMessage`).
- **Download** (`download(context, treeItems?)`): `DestinationPromptStep` (local folder via `showWorkspaceFoldersQuickPick(..., 'deployPath')`), plus `SasUrlPromptStep` for `downloadSasUrl` -> `GetAzCopyDownloadsStep` (200; builds `IAzCopyDownload { remoteFileName, remoteFilePath, localFilePath, isDirectory, resourceUri, sasToken }`) -> `DownloadFilesStep` (300). Title `Download Files`. Overwrite prompts per item with a once-per-run choice; nested items already covered by a selected folder are skipped; message `Downloaded to "{0}".`. The AzCopy download path is skipped when `ext.isWeb`.
- **AzCopy engine:** all uploads (files, folders, deploy) and downloads go through `azCopyTransfer` (lazy `import('./azCopy/azCopyTransfer.js')`) using `@azure-tools/azcopy-node` (`AzCopyClient`) with a per-OS native binary (esbuild copies `@azure-tools/azcopy-darwin|linux|win32|win64`; `scripts/setAzCopyPermissions.mjs` runs at `prepackage`). `ext.azCopyExePath = 'azcopy'`. An in-memory `CredentialStore` (map keyed `${service}-${account}`) enables OAuth with AzCopy. Credentials are SAS (`transferSasToken`, used when the root allows shared-key access) or OAuth/RBAC via `getAccessToken` (used when it does not; added in 0.17.1). Every transfer (upload and download) uses the same copy options, `{ fromTo, overwriteExisting: "true", recursive: true, excludePath: '.git/;.vscode/' }`: existing destination files are overwritten, directories are copied recursively, and any `.git/` or `.vscode/` paths are excluded. `followSymLinks` is not set in either direction (setting it fails downloads and does not work as expected for uploads, per Azure/azure-storage-azcopy issue 1174), and no other `ICopyOptions` field (for example a log level) is set. Custom clouds set `AZCOPY_DEFAULT_SERVICE_API_VERSION = '2019-02-02'`. Progress via `TransferProgress` (cancellable `withProgress`); failure text from the job error message or final transfer status.
- **Generate SAS URL:** see section 1; account SAS with permissions `rwl`, 3-day expiry; blob nodes use services `b`, resource types `co`.

### 5.8 Telemetry captured by wizards/flows

`deployStaticWebsite`: `contextValue`, `hasPreDeployTask`, `deployAttempt`, `cancelStep`; `selectStorageAccountTreeItemForCommand`: `cancelStep = 'StorageAccountWebSiteNotEnabled'`, `enableResponse`; Storage Explorer launchers: `storageExplorerNotFound`, `downloadStorageExplorer`; `askOpenInStorageExplorer`: `openInStorageExplorer = 'true'`; Azurite: `cancelStep = 'installAzuriteExtension'`; blob download: `blobDownloadSize`, `invalidBlobTypeForDownload`.

---

## 6. Config-file features (A + B)

None. No `jsonValidation`, no scaffolding/parsing commands, and no workspace config files beyond the user-owned VS Code `tasks.json` entry referenced by `azureStorage.preDeployTask` and the Azurite extension's `azurite.*` settings.

---

## 7. External integrations (B)

- **Azure SDKs:** `@azure/arm-storage` (account CRUD, keys, `checkNameAvailability`, `getProperties`), `@azure/arm-resourcegraph` (account listing), `@azure/arm-resources`, `@azure/arm-storage-profile-2020-09-01-hybrid` (custom-cloud profile), `@azure/storage-blob`, `@azure/storage-file-share`, `@azure/storage-queue`, `@azure/data-tables`, `@azure/storage-file-datalake` (HNS directory/rename/delete), `@azure/core-rest-pipeline`. Shared libs: `@microsoft/vscode-azext-utils`, `@microsoft/vscode-azext-azureutils`, `@microsoft/vscode-azureresources-api`. Other: `mime`, `p-retry`, `vscode-nls`, `winreg`.
- **Auth (four distinct paths):** (1) ARM management calls (`createStorageClient`, account `getProperties`/`listKeys`) use the Azure Resources subscription credential. (2) Data-plane clients on `StorageAccountTreeItem.createRoot()` try shared key first when `allowSharedKeyAccess` is true and fall back to the storage-scoped OAuth credential (`https://storage.azure.com/.default`) when shared key is disallowed or the key client fails. (3) `BlobContainerFS` uses OAuth only when `allowSharedKeyAccess === false`, otherwise the account key from `listKeys`. (4) AzCopy uses OAuth (`getAccessToken`) when the node's root has shared-key access disabled, otherwise an account SAS (`transferSasToken`). Attached accounts use the connection-string shared key only. OAuth-first would be a policy change for the migration, not existing behavior.
- **Azurite (emulator):** detection of the Azurite VS Code extension (`Azurite.azurite`) or the `azurite-blob|queue|table` CLI; start via `azurite.start_<type>` or by running the CLI (`cpUtils.executeCommand`) and waiting 3000 ms for an early failure, then refreshing the attached-accounts node. Missing both: `You must install the [Azurite extension](command:azureStorage.showAzuriteExtension) to perform this operation.` (error display suppressed; `cancelStep = 'installAzuriteExtension'`). API-version mismatch warning: `The installed Azure Storage SDK uses an API version not yet supported by Azurite. You can skip this check by enabling the "azurite.skipApiVersionCheck" setting. Azurite will be restarted to apply the change.` with action `Enable Skip API Version Check`.
- **Microsoft Azure Storage Explorer launcher:** URL `storageexplorer://v=1&accountid=<id>&subscriptionid=<id>&source=VSCODE-AzureStorage[&resourcetype=<type>&resourcename=<name>]`. Windows (`getStorageExplorerExecutableWindows`): reads registry `HKCR\storageexplorer\shell\open\command` through `winreg`; missing -> `Cannot find a compatible Storage Explorer. Would you like to download the latest Storage Explorer?` with `Download` (opens `https://go.microsoft.com/fwlink/?LinkId=723579`). macOS (`getStorageExplorerExecutableMac`): `azureStorage.storageExplorerLocation` + `/Contents/MacOS/Microsoft\ Azure\ Storage\ Explorer`; invalid -> `Cannot find Storage Explorer. Browse to existing installation location or download and install Storage Explorer.` with `Browse` / `Download`. Linux: unsupported (menu entries hidden with `!isLinux`; `askOpenInStorageExplorer` omits its action on Linux).
- **`askOpenInStorageExplorer`:** an error-recovery action (`Open resource in Storage Explorer`) used by failing operations; always ends in `UserCancelledError` after offering the action.
- **Report issue:** `azureStorage.reportIssue`, with the inline Report Issue button globally suppressed.
- **Activity log:** `createActivityContext` (`utils/activityUtils.ts`) with children for create-account, delete-account, and delete-directory; `suppressActivityNotifications` honored.

---

## 8. Docs layer (C) - supplementary only

Consulted:
- `https://code.visualstudio.com/docs/azure/storage` - **404. There is no VS Code docs page for this extension.**
- `https://code.visualstudio.com/docs/azure/overview` - lists Azure Storage only as a frontend/static-site option ("Azure Static Web Apps, Azure App Service, Azure Storage, and Azure Functions offer a streamlined workflow for developing, previewing, and deploying static websites and single-page applications").
- Repo `README.md` and `CHANGELOG.md` (used for intent and dating).

Doc-derived intent (unverified against code where noted):
- README advertises: explore/create/delete blob containers, file shares, queues, tables, storage accounts; create/edit/delete block blobs and files; upload/download blobs, files, folders; copy connection strings and primary keys; open in Storage Explorer for page/append blobs and heavy workloads; static-website deploy/configure/browse (with `build`, `out`, `dist` folder detection - consistent with the `deployPath` quick-pick behavior in code); settings `showExplorer`, `preDeployTask`, `storageExplorerLocation`, `deleteBeforeDeploy`.
- **README-only claims not backed by code or manifest (stale):** `azureStorage.file.showSavePrompt`, `azureStorage.blob.showSavePrompt`. `azureStorage.showExplorer` is declared but unread.
- Nothing in the docs describes the attached-account/emulator flow, the virtual file systems, AzCopy, SAS generation, or tree behavior. Docs removed **no** feature found in code/manifest.
- CHANGELOG highlights relevant to behavior: 0.17.1 OAuth/RBAC in AzCopy; 0.17.0 accounts load on expansion via Resource Graph, attached accounts use data-plane clients without Azure credentials, ARM clients for Azure blobs, `sharedKeyAccess` checks before key use; 0.16.5 activity children for create-account/delete-directory and Azurite listening settings.

---

## 9. Usage Summary (telemetry)

- Cluster / window / collected-on: `ddtelvscode`.`VSCodeExt`.`RawEventsVSCodeExt` - **90d** - **2026-10-22**. The generic query covered the non-activation events the extension emits. A 365d re-query of the lowest-volume features returned identical coverage, so effective telemetry retention is about 90 days and small-N caveats cannot be widened further.
- **Raw counts are deliberately not committed** (repo policy). The full ranked table (ExternalUsers / Succeeded / Failed / Canceled / LastSeen per event) lives only in the session artifacts dir as `USAGE-working.md` (plus the JSON result files).
- Qualitative picture:
  - **Highest adoption (very high external users):** tree/resource plumbing (workspace provider provide-resources, container listing, key retrieval), `azureStorage.editBlob`, `azureStorage.openInFileExplorer`, `azureStorage.refresh`, and the blob virtual-file-system operations (`azureStorageBlob.stat|readFile|readDirectory`, file-share `readFile`).
  - **High:** `azureStorage.copyUrl`, `uploadFiles`, `downloadTreeItems`, `deployStaticWebsite` (`...deploystaticwebsitev2`), `createBlobContainer`, `deleteFile`, `attachStorageAccount`, `uploadToAzureStorage`, `createGpv2Account`, `startBlobEmulator`, `openTable`, and the Windows Storage Explorer lookup.
  - **Moderate / low:** most remaining commands; queue and table create/delete are low. **File-share create/delete, file/directory creation, `disableStaticWebsite`, and `openFileShare` are very low** - the file-share authoring surface sees little external use even though share browsing through the virtual FS is common.
- Signals to carry into triage (suggestions, not verdicts):
  - **High failure share - Migrate + fix, not Drop:** Open-in-Storage-Explorer commands for tables, queues, and blob containers (launcher not installed/reachable), `copyPrimaryKey` / `copyConnectionString` / `generateSasUrl` (consistent with shared-key access being disabled), `configureStaticWebsite`, `createGpv2AccountAdvanced`, `startBlobEmulator`, `azureStorage.skipApiVersionCheck`, and `azureStorageBlob.readFile` / `azureStorageBlob.stat` (probing for missing blobs/directories yields expected `FileNotFound` failures - treat as noise, not defects).
  - **Cancel-dominant - needs a human:** `openStorageAccount`, `downloadSasUrl`, `uploadToAzureStorage`, `attachStorageAccount`, `createGpv2Account` (basic), and both Storage Explorer executable lookups (users dismiss the "not found / download" prompt). A UX question, not a failure.
  - **Suppression - non-adoption signals:** `stat` and `readDirectory` on the `azurestorage` provider set `suppressIfSuccessful`, so only failures are emitted and their failure share is an artifact of that suppression. `getFileSystemError` additionally sets `suppressAll` for converted errors.
  - **Candidate Drop / Defer (verify):** `disableStaticWebsite`, `openFileShare`, `deleteFileShare`, `createDirectory`, `createSubdirectory`, `createFile` (very low external adoption over the whole retention window, none suppressed). Confirm with the human before dropping; share browsing and editing through the virtual file system remains in use.
  - **No data - verify renamed/suppressed:** derived EventNames for `api.revealTreeItem` (exported API callback; may be invoked only by other extensions), `resolveResource`, and file-share `rename` returned no row. Absence is not proof of "unused".
  - **Framework/plumbing rows (not attributed to a user feature):** `unhandlederror`.
  - Usage is attributable to external users; no internal-only (dev/test) surfaces were identified to strip.
- `deployStaticWebsite` emits under a **versioned** name (`...deploystaticwebsitev2`); a query keyed on the plain command id will miss it.

Re-run the roll-up with the deeplink at the top of this file, or the KQL below. Per-feature drill-down (edit the `feature` line):

```kusto
let ext = 'ms-azuretools.vscode-azurestorage';
let window = 90d;
cluster('ddtelvscode').database('VSCodeExt').RawEventsVSCodeExt
| where ServerTimestamp > ago(window)
| where ExtensionName == ext
| where tostring(Properties['isactivationevent']) != 'true'
| summarize
    Invocations   = count(),
    ExternalUsers = dcountif(VSCodeMachineId, IsInternal == false),
    InternalUsers = dcountif(VSCodeMachineId, IsInternal == true),
    Succeeded     = countif(tostring(Properties['result']) == 'Succeeded'),
    Failed        = countif(tostring(Properties['result']) == 'Failed'),
    Canceled      = countif(tostring(Properties['result']) == 'Canceled'),
    LastSeen      = format_datetime(max(ServerTimestamp), 'yyyy-MM-dd')
    by EventName
| order by ExternalUsers desc
```

```kusto
let ext = 'ms-azuretools.vscode-azurestorage';
let feature = 'azurestorage.createblobcontainer';  // <-- any callbackId, lowercased
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

[Open the per-feature drill-down in ADX](https://dataexplorer.azure.com/clusters/ddtelvscode/databases/VSCodeExt?query=H4sIAAAAAAAAE5WRT0%2FDMAzF7%2FsUuaWV9ocrGuMygdQDCDHggji4iTci0mSK3XUgPjzOum5c10sVP7%2BfnRePrHDPaqF0QxP4aRNyjJ6mOzLRYl8hjgk2qOcjL%2B1rBJZitvxXpyaJgLWPtYmBwQVMeq7UbKZuJhMF4VsZ8L4G81XZsfKxw2SA0B6gnQs2dsK8vrLzkfEtMaZCW8vo%2B1V0ObXAUIul0G%2BrpZTu9izVZ%2BjudhiYTsXRr%2Bo%2BUVZcYdphenGNLAnNVt0q2MSin1WeusSBgVwMj9DItRY5kLOY0YNALCtzIfpY6ZkeD1lkFrVNA8n94EjJV4VdlFaBkpwWysQ2cFGOD2IemAL4V8JEItqD6tZFf4MHMJ%2BSXk6poir0vXn8GjzhkbFqjUG0aPNhGCAIjrKkC5viKcUtJnZI71oeqfWsP8pM0SerPrLuwfkj6FJWbx1ASwgGT6iLQINVlwdS%2FX1%2BljdJSX6ScUwW06CdE7RI5g%2FKX8DwyQIAAA%3D%3D)

---

## Migration-relevant cross-cutting notes

- **Host-API dependence is total.** No own views: the extension is one `AzExtResourceType.StorageAccounts` resolver, one workspace provider, and commands gated on host `viewItem` context values. In the monorepo this becomes `DataProvider` / `ViewProvider` registrations in `registerTrees.ts` and `ManagedCommand`s with static `ContextValue` properties; the hand-written `when` regexes (anchored `==` versus the unanchored `=~ /azureStorageAccount/`) collapse into the monorepo's `\b...\b` convention. Keep `azureStorageAccount-attached` / `-attached-emulated` distinguishable from `azureStorageAccount` - the unanchored base regex also matches them.
- **Two data-access modes behind one node tree.** Azure accounts try shared-key data-plane clients first when allowed and fall back to the storage-scoped OAuth credential (`BlobContainerFS` and AzCopy choose OAuth only when shared-key access is disabled; AzCopy otherwise uses SAS; ARM auth is separate); attached/emulated accounts are connection-string only and have no ARM/subscription context (hard `throw`s in `AttachedAccountRoot`). The monorepo's azutils client wrappers need a data-plane path that does not assume a subscription for the attached case.
- **Provisioning is an ARM SDK call, not a deployment.** Account creation sets security-forward defaults (`enableHttpsTrafficOnly`, `allowBlobPublicAccess = false`, `defaultToOAuthAuthentication`, shared key allowed) and is followed by a data-plane static-website configuration; the migration will map the primary `Microsoft.Storage/storageAccounts` resource plus its resource group onto the azd+Bicep creation path (AVM selection belongs to the migration skill). The data-plane static-website step has no Bicep equivalent and must remain a post-provision action.
- **Virtual file systems have no analogue in the monorepo today.** `azurestorage` and `azurestorageblob` (URI schemes with embedded resource ids, tree-resolved lookups, HNS-aware blob semantics, 5 ms event coalescing) back click-to-edit and Open in Explorer, and drive `onFileSystem:*` activation. Decide explicitly whether to carry both, and whether attached blob containers should finally move to `BlobContainerFS`.
- **AzCopy is the only transfer engine**, with per-OS native binaries and a `CredentialStore` bridge. Bundling, permission fix-up (`setAzCopyPermissions.mjs`), and the SAS/OAuth split are packaging concerns for the monorepo's esbuild setup.
- **Shared-lib coupling to strip:** `@microsoft/vscode-azext-utils` (`AzExtTreeItem`/`AzExtParentTreeItem`, `AzureWizard`, `registerCommandWithTreeNodeUnwrapping`, `GenericTreeItem`, activity-log APIs, `IActionContext.ui`), `@microsoft/vscode-azext-azureutils` (location/resource-group/provider steps, `StorageAccountCreateStep`, `createAzureClient`), `vscode-nls`.
- **Bugs / hazards to fix rather than port:** private `_rootTreeItem` access on `workspaceResourceTree`; the `hosing` typo in a progress message; `BlobContainerFS.rename` rejecting an existing destination when `overwrite` is true; the `||`-tail `when` clauses that escape the view restriction (`openInFileExplorer`, `deleteFile`, `deleteDirectory`); `showEnableWebsiteHostingPrompt` threaded through context casts; many hard-coded English (non-localized) messages in `storageAccountActionHandlers.ts`, `StorageAccountTreeItem.ts`, and the deploy flow.
- **Deliberate non-migrations (DEAD / unused):** `azureStorage.showExplorer` (declared, unread); README-only `file.showSavePrompt` / `blob.showSavePrompt`; `tree/createWizard/storageAccountNameStep.ts` (unreferenced local copy); `src/vscode.proposed.*.d.ts`; the `getApiExport.ts` helper.
- **Settings gap to resolve in triage:** `azureStorage.deployPath` is read but not declared; decide whether the monorepo declares it or replaces the per-workspace-folder sub-path convention.
