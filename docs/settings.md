# Settings

Application settings, connection strings, and similar name/value configuration on a deployed
resource are a near-universal Azure concept. This document describes the shared framework that
serves all of them, so a product gets settings by registering an adapter rather than by building a
tree, a command set, and an editor of its own.

## Layers

```
packages/utils/src/settings/           Azure-agnostic: model, JSONC format, generic FileSystemProvider
packages/azutils/src/settings/         SettingsAdapter contract + capabilities
extensions/vscode-azure/src/settings/  Registry, adapters, URI codec, document sources, registration
extensions/vscode-azure/src/tree/resources/settings/   Data + view providers
extensions/vscode-azure/src/commands/settings/         Commands
```

The file system provider in `utils` knows nothing about Azure. It is generic over a
`SettingsDocumentSource` (resolve a URI, read a snapshot, write a map), which keeps it unit-testable
against `createMockVsCode()` with no ARM mocking, and lets the same provider class serve both the
remote and local sides of a comparison.

## The editor is the primary surface

Opening **Edit Settings** on a collection produces a JSONC document that *is* the collection:

```jsonc
// Application settings for 'myFunctionApp'.
// Saving this file writes these settings to Azure. Removing a setting deletes it.
// The file is saved to Azure as-is: it overwrites any changes made elsewhere since it was opened.
// This file lives only in the editor. Saving a copy to disk would store its values in plain text.
{
    "AzureWebJobsStorage": "...",
    "FUNCTIONS_WORKER_RUNTIME": "node"
}
```

The header is regenerated on every read and stripped on parse, so edits to it are discarded rather
than persisted somewhere they could go stale.

The tree keeps an expandable collection node with per-setting add / edit / rename / delete / copy for
one-off changes, but anything involving more than one setting is easier in the document.

### Save semantics: last-writer-wins

Saving sends the parsed document as the collection's **complete** new contents. There is no re-read
and no merge:

- A key you removed is deleted.
- A key someone else added since you opened the document is **overwritten** (that is, removed).

This is deliberate. It makes the document mean exactly what it appears to mean, and it matches ARM,
which has no per-key patch for these collections — `updateApplicationSettings` replaces the whole
dictionary. The trade-off is real: two people editing the same collection in two windows will clobber
each other silently. `SettingsAdapter.write` takes the full map, so adding etag / `If-Match` support
later is additive rather than a redesign.

The per-setting tree commands are different: they read, modify one key, and write, so keys they do
not touch survive. They are also **refused outright** on a collection whose `valuesReadable` is
`false` — read-modify-write over a collection that reads back as all sentinels would replace every
untouched secret with `********`, and unlike the editor there is no real value in hand to restore.

### Keeping the tree and an open document in step

A collection is visible in two independent places. A tree command that changed Azure but refreshed
only the tree would leave an open document holding a stale snapshot, and last-writer-wins means that
document would silently undo the change on its next save — the same user's own action, reverted in
the same window.

Every command that mutates settings outside the editor therefore calls `ISettingsChangeNotifier`,
which invalidates both the tree subtree and the document, rather than touching the tree directly.

## Adapters

A product supports settings by implementing `SettingsAdapter` (in azutils) and binding it to
`ISettingsAdapter` in `registerSettings.ts`. Nothing else changes.

```typescript
export interface SettingsAdapter {
    canHandle(resource: GenericResource): boolean;
    getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[];
    getCapabilities(resource: GenericResource, collectionId: string): SettingsCapabilities;
    read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot>;
    write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void>;
}
```

**`canHandle` must depend only on the resource's `logicalType`.** `SettingsRegistry` memoizes adapter
lookup by logical type because `getCollections` runs for every resource the generic data provider
lists; an adapter that also inspected, say, the resource's location would be memoized incorrectly.

### Capabilities, not product branches

`SettingsCapabilities` is how product differences stay out of the shared layer. The view provider
assembles each node's `contextValue` from these flags, so a command whose capability is absent is
never contributed, its `when` clause never matches, and the menu item never appears:

| Flag | Effect when false |
|---|---|
| `canWrite` | Document opens read-only; every mutating command is withheld |
| `canAdd` | "Add New Setting" is withheld |
| `canDelete` | "Delete Setting" is withheld |
| `canRename` | "Rename Setting" is withheld |
| `valuesReadable` | Values render as the `UnreadableValue` sentinel and are preserved on save |
| `localFile` (absent) | Compare / download / upload are withheld |

Adding a product that forbids renaming means returning `canRename: false` — not adding a branch.

### Structured collections

A collection is *structured* when its entries carry metadata that travels with the value but is not
the value. App Service connection strings are the reference case: each has a database `type`.

```jsonc
{
    "MyDatabase": { "value": "Server=tcp:...", "type": "SQLAzure" }
}
```

Unstructured collections serialize as plain `"KEY": "value"`. The framework picks the shape from
`SettingsCollectionDescriptor.structured`; nothing downstream special-cases connection strings.

### Unreadable values

Some services will not return values on read. Such a collection sets `valuesReadable: false`; every
value reads back as `UnreadableValue` (`********`). On save, an entry still carrying the sentinel
means *leave the remote value alone*, so a no-op save cannot overwrite real secrets with the
placeholder. Using the sentinel as the value of a **new** key is an error, because there is nothing
to preserve.

`WebAppSettingsAdapter` sets `valuesReadable: true`, since ARM does return App Service values; the
machinery exists for products that do not.

## Secrets

- **Values are hidden in the tree by default**, behind a persisted per-workspace show/hide toggle.
  The resources tree is often visible during screen shares, and a connection string rendered in a
  tree item description is a real disclosure risk.
- A value the service will not return renders distinctly from one merely hidden, so "you may not see
  this" and "nobody can" are not confused.
- **Copy Value** exists so that reading one value does not require revealing every value.
- **Settings keys and values must never reach telemetry or logs.** Notifications name the setting but
  never echo its value.
- **Value prompts opt out of "recent value" persistence** via `rememberRecent: false` on
  `showSmartInputBox`. By default that helper writes the accepted input to workspace state in
  cleartext and offers it back as the pre-filled default next time — which for a setting value would
  both persist a secret to disk and replay one resource's secret into a prompt for another. Setting
  `password: true` implies the same opt-out, so forgetting the flag fails safe.
- The document is memory-only. It never touches disk unless the user explicitly saves a copy, which
  the header warns about.

## Document URIs

```
azure-settings:/<identity>/<armResourceId>/<resourceName>.<collectionId>.jsonc
```

`<identity>` is a hex encoding of `accountId|portalHost|tenantId`.

The URI is **self-describing** rather than a handle into a session map, because the editor restores
open tabs on window reload and calls `readFile` before the extension has any tree state — a handle
would dangle. `AzureSettingsDocumentSource` rebuilds the owning resource with `findResourceByArmId`.

Two details are load-bearing:

- **Identity goes in the path, never the authority.** VS Code lowercases a URI's authority when
  round-tripping through `Uri.parse(uri.toString())` but preserves the path byte-for-byte, and
  account ids are not safe to lowercase.
- **Hex, not base64url**, for the same reason: hex survives case normalization regardless.

`SettingsUri` has a round-trip test covering exactly this.

## Tree dispatch

`ProviderRegistry` dispatches to the **first** `canHandle` match, so two providers cannot both serve
one resource. The settings framework therefore splits along the resource/virtual-node boundary:

- `SettingsDataProvider` and `SettingsViewProvider` register **first** and claim only the virtual
  settings nodes (`settings.collection`, `settings.entry`).
- The collection nodes themselves are emitted by whichever provider owns the *resource*.
  `AzureResourceDataProvider` (the generic fallback) consults the registry and emits them for any
  resource with a registered adapter, so App Service and Logic App get settings with zero
  product-specific code.

A product provider that owns a resource in order to contribute its own children must compose
`ISettingsDataProvider.getCollectionNodes(resource)` into what it returns, or that resource will lose
its settings node.

### Node keys

An entry node's `virtualPath` is `{collectionId}/{key}`, not the bare key, because the same key can
legitimately exist in two collections on one resource — an app setting and a connection string both
named `Database`. `AzureNodeId` percent-encodes `virtualPath`, so the `/` round-trips as `%2F`
rather than splitting the fragment.

Entry nodes also carry their `value` and `metadata`. The data provider already has them from the
collection read, so carrying them avoids a second round trip in the view provider and in the
edit / copy commands. They are not part of the node key, so changing a value never orphans a node.

`SettingsViewProvider.getParent` returns an entry's **collection**, not the owning resource;
`AzureNodeId.parentNodeId` models the ARM hierarchy, in which a virtual node's parent is the
resource, and would skip a level.

## Local file sync

Adapters declare the file they sync with via `SettingsCapabilities.localFile` — `local.settings.json`
for Function Apps and Logic Apps, `.env` for plain App Service, nothing for connection strings.

**Compare with Local Settings** is the headline: it opens a side-by-side diff via `vscode.diff`.
Both sides are projected through the same JSONC format by the same file system provider class, under
two schemes:

| Scheme | Source |
|---|---|
| `azure-settings:` | `AzureSettingsDocumentSource` — the collection in Azure |
| `azure-settings-local:` | `LocalSettingsDocumentSource` — the matching local file |

Projecting both sides is what makes the diff readable: comparing raw `local.settings.json` against
the remote document would show the `Values` wrapper and unrelated keys such as `IsEncrypted` as
differences. Either side can be edited and saved in place, so reconciling is a normal merge rather
than an all-or-nothing copy.

**Download** and **Upload** do wholesale what the diff does selectively. Both summarize the change
(counts of added / changed / deleted — never the keys) and require modal confirmation, because a
wholesale copy silently destroys settings that exist only on the destination.

`LocalSettingsFile` writes **surgically**: for JSON, only the `Values` object is rewritten, so
sibling properties and formatting survive; for `.env`, comments, ordering, and untouched lines are
preserved. These files are checked into source control, and a settings sync must not reformat them.

Two data-preservation details:

- **Non-string members of `Values` are preserved.** They were never surfaced as settings, so they are
  not the user's to have deleted by saving.
- **`.env` values are JSON-quoted when they contain whitespace, quotes, backslashes, or `#`, and
  JSON-unescaped on read.** Quoting and unquoting must stay exact inverses, or a value such as
  `{"a":"b"}` — common on App Service — gains a layer of backslashes on every download/upload cycle
  and is eventually written back to Azure corrupted.

## Adding a product

1. Add a client wrapper in `packages/azutils/src/rest/clients/` if the product needs one, re-exporting
   any SDK types from the wrapper.
2. Implement `SettingsAdapter` in `extensions/vscode-azure/src/settings/adapters/`.
3. Bind it in `bindSettingsServices` in `registerSettings.ts`.

That is all. The tree nodes, the editor, all ten commands, masking, and local sync follow from the
capabilities the adapter reports.

## Testing

`extensions/vscode-azure/test/settings/mockSettings.ts` provides `StubAdapter` (an in-memory adapter
that retains writes for assertion), `createSettingsRegistry`, `createSettingsDataProvider`, and
`permissiveCapabilities`. Prefer these over hand-rolled fixtures.

`expectRejection` (from `@microsoft/vscode-azure-utils/testing`) replaces the
`try { await ...; expect.fail(); } catch { ... }` shape, which is easy to get subtly wrong by
asserting inside the `try` — where a failed assertion is caught by the very `catch` meant to inspect
the rejection, and the test silently passes.
