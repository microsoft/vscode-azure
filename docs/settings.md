# Settings

Application settings and similar name/value configuration on a deployed resource are a near-universal
Azure concept. This document describes the shared framework that serves them, so a product can
compose its adapter into the common tree node, command, and editor.

## Layers

```
extensions/vscode-azure/src/settings/                  Adapter contract, adapters, model, JSONC format,
                                                       document FileSystemProvider, URI codec
extensions/vscode-azure/src/tree/resources/settings/   Data + view providers
extensions/vscode-azure/src/tree/resources/webApp/     Product ownership and settings composition
extensions/vscode-azure/src/commands/settings/         The edit command
```

`SettingsFileSystemProvider` resolves a document URI to the exact tree node and calls `read`/`write`
on the adapter attached to that node. The product provider selects the adapter explicitly when it
calls `getSettingsNodes(owner, adapter)`.

## One command, one surface

The tree shows a single leaf settings node per owner. Selecting it runs the one settings command,
which opens the settings as an editable JSONC document:

```jsonc
// Application settings for 'myFunctionApp'.
// Saving this file writes these settings to Azure. Removing a setting deletes it.
// The file is saved to Azure as-is: it overwrites any changes made elsewhere since it was opened.
// Deployments and infrastructure-as-code tools may overwrite edits made here.
{
    "AzureWebJobsStorage": "...",
    "FUNCTIONS_WORKER_RUNTIME": "node"
}
```

The header is regenerated on every read and stripped on parse, so edits to it are discarded rather
than persisted somewhere they could go stale.

There are deliberately **no per-setting tree commands** -- no add, edit, rename, delete, or copy. One
document editor covers all of them with the editor's own find, multi-cursor, and undo, and it means
setting values never appear in the tree, which is frequently visible during screen shares.

### Save semantics: last-writer-wins

Saving sends the parsed document as the resource's **complete** new settings. There is no re-read
and no merge:

- A key you removed is deleted.
- A key someone else added since you opened the document is **overwritten** (that is, removed).

This is deliberate. It makes the document mean exactly what it appears to mean, and it matches ARM,
which has no per-key patch -- `updateApplicationSettings` replaces the whole dictionary. The
trade-off is real: two people editing the same settings in two windows will clobber each other
silently. `SettingsAdapter.write` takes the full map, so adding etag / `If-Match` support later is
additive rather than a redesign.

### Setting names are case-insensitive

Two names differing only by capitalization are rejected on save, naming both spellings. Azure treats
app setting names as case-insensitive -- on Windows they become environment variables, which the OS
folds -- so sending `MySetting` and `MYSETTING` together would silently keep only one. This matches
`@microsoft/vscode-azext-azureappsettings`, whose `validateAppSettingKey` compares
`key.toLowerCase()` and whose `confirmOverwriteSettings` carries the comment "App setting keys are
case insensitive", both unconditionally.

Two caveats worth knowing, since neither is documented by Azure:

- What ARM does with a payload containing both spellings is **unverified**; the rejection here is a
  client-side guard, not an observed service error.
- On Linux the underlying environment variables *are* case-sensitive, so an app could in principle
  already hold both. Such a document would fail to save until one is removed. Microsoft's own tooling
  makes the same trade-off, and the alternative -- silently dropping one on save -- is worse.

## Adapters

A product supports settings by implementing `SettingsAdapter`, binding the concrete adapter in its
registrar, and passing it to `getSettingsNodes` from the provider that owns the resource.

```typescript
export interface SettingsAdapter {
    readonly label: string;
    canHandle(owner: SettingsOwner): boolean;
    read(owner: SettingsOwner): Promise<SettingsSnapshot>;
    write(owner: SettingsOwner, entries: SettingsMap): Promise<void>;
}
```

The product data provider can delegate its own `canHandle` decision to the adapter. Keep that check
cheap -- a set lookup on `logicalType` is the norm.

### Who owns a settings document

`SettingsOwner` is `GenericResource | VirtualResource`, because settings do not always belong to the
ARM resource as a whole:

- **The resource owns them.** Call `getSettingsNodes(resource, adapter)`. The node's `owner` is the
  resource and the document is named after it. This is App Service, Function Apps, and Logic Apps.
- **A part of the resource owns them.** Call `getSettingsNodes(virtualNode, adapter, documentName)`.
  The node is keyed beneath that virtual node, so sibling parts each get their own document, and
  `documentName` is what keeps their editor tabs distinguishable. This is Static Web Apps, where
  application settings belong to an environment and the site itself has none.

An adapter that only ever serves whole resources should narrow the owner back with a guard and throw
otherwise, as `WebAppSettingsAdapter` does -- an owner it cannot serve is a wiring bug, and failing
at the boundary beats issuing a request against the wrong thing.

### Restricting what a product permits

There is deliberately **no capability model**. A product controls presentation through the tree's
context values, using the same mechanism as every other tree node. Settings that the product will not
let the user edit set `writable: false` on the snapshot returned from `read`, which makes the editor
document read-only.

> **Not modeled:** services that refuse to return values on read, and per-entry metadata -- an App
> Service connection string's database `type`, or an App Service setting's sticky "deployment slot
> setting" flag, which lives in a separate `slotConfigNames` resource on the parent site. Model these
> alongside the first adapter that actually needs them, rather than carrying unexercised machinery.

## Secrets

- **No values appear in the tree.** The settings node is a leaf, so there is nothing to mask and no
  show/hide state to persist.
- **Settings keys and values must never reach telemetry or logs.** Record counts only.
- The document is memory-only. It never touches disk unless the user explicitly saves a copy.

## Document URIs

```
azure-settings:/<nodeKey>/<documentName>.settings.jsonc
```

`<nodeKey>` is the hex-encoded `AzureNodeId` of the settings node -- the data tree's own primary key.
`SettingsFileSystemProvider` resolves a URI with a single `tree.get(nodeKey)`, so the owner passed to
the adapter is always **the object the tree loaded from Azure**.

The file name is cosmetic -- it makes the tab readable and selects the `jsonc` language mode. Nothing
parses meaning out of it. It is still arbitrary text, though: a product may name a settings document
after an ARM child resource (a deployment slot is `site/slot`) or after something a user wrote (a
Static Web Apps preview environment is named after a pull request title). Path separators are
therefore flattened to `-`, since they are the one character class that would split the file across
two path segments. Everything else survives on its own: `?`, `#`, `%`, spaces, and non-ASCII are
percent-encoded on serialization and decoded back byte-for-byte, and an already-encoded `%2F`
double-encodes rather than becoming a separator.

Two encoding details are load-bearing:

- **The key goes in the path, never the authority.** VS Code lowercases a URI's authority when
  round-tripping through `Uri.parse(uri.toString())` but preserves the path byte-for-byte, and
  neither account ids nor ARM ids are safe to lowercase.
- **Hex, not base64url**, for the same reason: hex survives case normalization regardless.

`SettingsUri` has a round-trip test covering exactly this.

## Tree dispatch

`ProviderRegistry` dispatches to the **first** `canHandle` match, so two providers cannot both serve
one resource. The settings framework therefore splits along the resource/virtual-node boundary:

- `SettingsDataProvider` and `SettingsViewProvider` register **first** and claim only the virtual
  settings nodes. They are thin tree-framework glue: the data provider reports a leaf, while the
  view provider delegates presentation to `createSettingsTreeItem`.
- The product-specific provider owns the *resource*, injects its concrete adapter, and calls the pure
  `getSettingsNodes(owner, adapter)` helper. The resulting virtual node retains that adapter.
- A product-specific view provider presents the owning resource as expandable. For ordinary ARM
  resources it can delegate shared presentation to `createGenericResourceTreeItem`.

For example, `WebAppDataProvider` owns Function App, App Service, and Logic App resources supported
by `WebAppSettingsAdapter`, while `WebAppViewProvider` gives those resources a chevron. Other
capabilities can overlap those products independently without inheritance or provider aggregation.

## Ownership boundary

This framework edits the settings currently stored on the live Azure resource. It does not compare,
upload, download, or synchronize local configuration files such as `local.settings.json` or `.env`.
Those files belong to product development and deployment workflows, particularly azd and
infrastructure-as-code.

In an azd project the declarative source of truth is the Bicep template under `infra/`, which sets
`appSettings` from other resources' outputs. A successful edit here is therefore not a change to that
source of truth: the next `azd provision` re-applies the template and may overwrite it. The virtual
document warns about this directly without adding a confirmation prompt to every save.

## Adding a product

1. Add a client wrapper in `packages/azutils/src/rest/clients/` if the product needs one, re-exporting
   any SDK types from the wrapper.
2. Implement `SettingsAdapter` in `extensions/vscode-azure/src/settings/adapters/`.
3. Bind the concrete adapter in the product registrar.
4. Have the product data provider inject it and include `getSettingsNodes(owner, adapter)` in the
   owner's children, passing a `documentName` when one resource can have more than one settings
   document.
5. Ensure the product view provider renders the owning resource as expandable.

The settings virtual-node behavior, editor, and command then come from the shared framework.

## Testing

`extensions/vscode-azure/test/settings/mockSettings.ts` provides `StubAdapter` (an in-memory adapter
that retains writes for assertion, and refuses writes when constructed with `readOnly`) and
`makeSettingsResource` / `makeSettingsNode` fixtures for `Microsoft.Web/sites` resources. Prefer
these over hand-rolled fixtures. `SettingsDataProvider` has no constructor dependencies; test
product composition through `getSettingsNodes`.
