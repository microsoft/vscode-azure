# Settings

Application settings and similar name/value configuration on a deployed resource are a near-universal
Azure concept. This document describes the shared framework that serves them, so a product gets
settings by registering an adapter rather than by building a tree, a command, and an editor of its
own.

## Layers

```
extensions/vscode-azure/src/settings/core/   Model, JSONC format, document FileSystemProvider
extensions/vscode-azure/src/settings/        Adapter contract, registry, adapters, URI codec, registration
extensions/vscode-azure/src/tree/resources/settings/   Data + view providers
extensions/vscode-azure/src/commands/settings/         The edit command
```

`SettingsFileSystemProvider` is still written against a `SettingsDocumentSource` seam (resolve a URI,
read a snapshot, write a map) rather than against ARM. That keeps it unit-testable with
`createMockVsCode()` and no ARM mocking -- the seam earns its keep for testing regardless of which
package the file lives in.

## One command, one surface

The tree shows a single leaf node per settings collection. Selecting it runs the one settings
command, which opens the whole collection as an editable JSONC document:

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

Saving sends the parsed document as the collection's **complete** new contents. There is no re-read
and no merge:

- A key you removed is deleted.
- A key someone else added since you opened the document is **overwritten** (that is, removed).

This is deliberate. It makes the document mean exactly what it appears to mean, and it matches ARM,
which has no per-key patch for these collections -- `updateApplicationSettings` replaces the whole
dictionary. The trade-off is real: two people editing the same collection in two windows will clobber
each other silently. `SettingsAdapter.write` takes the full map, so adding etag / `If-Match` support
later is additive rather than a redesign.

## Adapters

A product supports settings by implementing `SettingsAdapter` and binding it to `ISettingsAdapter` in
`products/registerSettings.ts`. Nothing else changes.

```typescript
export interface SettingsAdapter {
    canHandle(resource: GenericResource): boolean;
    getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[];
    read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot>;
    write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void>;
}
```

**`canHandle` must depend only on the resource's `logicalType`.** `SettingsRegistry` memoizes adapter
lookup by logical type because `getCollections` runs for every resource the generic data provider
lists; an adapter that also inspected, say, the resource's location would be memoized incorrectly.

### Restricting what a product permits

There is deliberately **no capability model**. Two existing mechanisms already cover it:

- **What the user sees** is the tree's context values. A product that wants a different presentation
  registers its own view provider ahead of `SettingsViewProvider` and attaches only the context values
  it wants; a command whose context value is absent never matches its `when` clause, so the menu item
  never appears. This is the same mechanism every other tree node uses.
- **What is actually allowed** is `SettingsAdapter.write`. The editor can save anything the user
  types, and the command palette ignores context values, so this is the only place a rule can be
  enforced.

A collection the product will not let the user edit sets `writable: false` on the snapshot it returns
from `read`, which makes the editor document read-only.

> **Not modeled:** services that refuse to return values on read, and per-entry metadata (such as an
> App Service connection string's database `type`). Every adapter today returns plain string values
> for a single collection. Model these alongside the first adapter that actually needs them, rather
> than carrying unexercised machinery.

## Secrets

- **No values appear in the tree.** The collection node is a leaf, so there is nothing to mask and no
  show/hide state to persist.
- **Settings keys and values must never reach telemetry or logs.** Record counts and collection ids
  only.
- The document is memory-only. It never touches disk unless the user explicitly saves a copy, which
  the header warns about.

## Document URIs

```
azure-settings:/<nodeKey>/<resourceName>.<collectionId>.jsonc
```

`<nodeKey>` is the hex-encoded `AzureNodeId` of the settings collection node -- the data tree's own
primary key. `AzureSettingsDocumentSource` resolves a URI with a single `tree.get(nodeKey)`, so the
resource passed to the adapter is always **the object the tree loaded from Azure**.

Two alternatives were tried and rejected:

- *Searching the tree by ARM id* -- drilling account -> tenant -> subscription -> group to find a
  resource is expensive and turns a lookup into a scan.
- *Rebuilding a `GenericResource` from the URI* -- cheap, but it fabricates a resource that was never
  read from Azure, so it can silently disagree with reality.

The file name is cosmetic -- it makes the tab readable and selects the `jsonc` language mode. Nothing
parses meaning out of it.

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
  settings collection nodes.
- The collection nodes themselves are emitted by whichever provider owns the *resource*.
  `AzureResourceDataProvider` (the generic fallback) consults the registry and emits them for any
  resource with a registered adapter, so App Service and Logic App get settings with zero
  product-specific code.

A product provider that owns a resource in order to contribute its own children must compose
`ISettingsDataProvider.getCollectionNodes(resource)` into what it returns, or that resource will lose
its settings node.

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
3. Bind it to `ISettingsAdapter` in the settings product entry point,
   `src/products/registerSettings.ts`.

That is all. The tree node, the editor, and the command come for free.

## Testing

`extensions/vscode-azure/test/settings/mockSettings.ts` provides `StubAdapter` (an in-memory adapter
that retains writes for assertion, and refuses writes to any collection listed in
`readOnlyCollections`), `createSettingsRegistry`, and `createSettingsDataProvider`. Prefer these over
hand-rolled fixtures.
