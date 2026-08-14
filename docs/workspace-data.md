# Workspace Data

The **workspace data service** is a single, shared, queryable index of what is in
the user's open workspace. Detectors tag files and folders with namespaced tags;
consumers ask for everything carrying a tag instead of running their own search.

It exists because every feature that cares about the workspace -- tree data
providers, creation wizards, deployment commands -- otherwise hand-rolls the same
three things: a `findFiles` call, a file watcher, and its own idea of what a
"project" is. That means N scans of the same folders, N watchers, and N
subtly-different answers. Here there is **one** walk of the workspace and
**one** watcher, shared by every detector.

Everything lives in [`src/workspace/`](../extensions/vscode-azure/src/workspace).

## Model

```
WorkspaceFolderIndexNode      one per open workspace folder (the unit of scanning/invalidation)
    └── WorkspaceEntry[]      flat list of every file/folder any detector tagged
            └── AppliedTag[]  namespaced tags, each with optional typed metadata
```

An entry exists only for a *tagged* location -- the index is not a mirror of the
filesystem. When several detectors tag the same URI, their tags merge into **one**
entry, so an azd project that is also a Node project is a single entry carrying
both tags.

## Tags

A tag is defined once with `defineWorkspaceTag` and exported:

```ts
export const AzdProjectTag = defineWorkspaceTag<MarkerFileMetadata>('azd', 'project');
AzdProjectTag.name; // 'azd:project'
```

- **Namespaced.** The namespace identifies the detector that owns the tag. A
  detector may only apply tags in its own namespace; foreign tags are dropped
  with a warning, so a tag's owner is always the detector that can refresh it.
- **Typed metadata.** The type parameter threads from `applyTag` (where a
  mismatch is a compile error) through to `getTagMetadata` at the query site.
  Use `undefined` (the default) for a bare marker tag.
- **Compared by qualified name**, not object identity.

### Standard tags

[`standardTags.ts`](../extensions/vscode-azure/src/workspace/standardTags.ts) defines
the product-agnostic vocabulary, registered ahead of product detectors:

| Tag | Marker |
| --- | --- |
| `project:node` | `package.json` |
| `project:dotnet` | `*.csproj`, `*.fsproj`, `*.vbproj`, `*.sln` |
| `project:python` | `pyproject.toml`, `requirements.txt`, `setup.py` |
| `project:java` | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| `project:go` | `go.mod` |
| `container:dockerfile` | `Dockerfile` |
| `container:compose` | `docker-compose.yml`, `compose.yml`, ... |

Product tags live with their detector: `azd:project`, `functions:project`.

### Convention: tag the project folder

Marker-file detection tags the folder **containing** the marker and puts the
marker file in the tag's metadata. Consumers almost always want "where does this
project live", and the manifest stays reachable:

```ts
const entries = await workspaceData.getEntries(AzdProjectTag);
entries[0].uri;                                      // the project folder
getTagMetadata(entries[0], AzdProjectTag)?.manifestUri; // the azure.yaml
```

## Querying

```ts
const projects = await workspaceData.getEntries(FunctionsProjectTag);
const entry = await workspaceData.getEntry(someUri);   // what do we know about this?
const ready = await workspaceData.whenEnriched(entry); // wait for background work
workspaceData.refresh();                               // force a rescan
workspaceData.onDidChange(() => { /* re-query */ });
```

The first query scans; later ones hit the cache. Concurrent queries share a
single scan. Returned entries are the index's own objects -- treat them as
read-only, but note their identity is stable across enrichment, so holding one
and awaiting `whenEnriched` on it later is safe.

### Subscribe once per consumer surface, not per provider

The workspace tree subscribes to `onDidChange` **once**, in `registerTrees`,
which invalidates the tree's roots:

```ts
const workspaceDataTree = container.get(IWorkspaceViewDataTree);
container.get(IWorkspaceDataService).onDidChange(() => {
    workspaceDataTree.invalidate(Roots);
});
```

The workspace data providers therefore have no `onDidChange` of their own. If
each provider subscribed instead, a single file change would refresh the tree
once per provider reading from the index -- three refreshes today, more with
every product added. Anything else consuming the index (a wizard step, a
command) should follow the same rule: one subscription per surface that needs
to react, not one per component.

## Writing a detector

Implement `WorkspaceDetector`. The service performs **one** breadth-first walk of
each workspace folder and offers every file and folder it sees to every
detector, so a detector never runs its own search and adding one costs no extra
I/O.

`visit` is synchronous on purpose: it is called for every file in the workspace,
so it must be a name check, not I/O.

```ts
const MyTag = defineWorkspaceTag<{ framework: string }>('myproduct', 'app');

export function createMyDetector(): WorkspaceDetector {
    return {
        namespace: 'myproduct',
        visit(candidate) {
            if (candidate.isDirectory || candidate.name !== 'my.config.json') {
                return undefined;
            }
            return [{
                uri: dirname(candidate.uri),
                isDirectory: true,
                tags: [applyTag(MyTag, { framework: 'whatever' })],
            }];
        },
    };
}
```

For the common "a marker file means this tag" case, use the declarative helper
instead -- adding a project type is then a table entry, not a code path:

```ts
createMarkerFileDetector('myproduct', [
    { tag: MyTag, fileNames: ['my.config.json'] },   // or: suffixes: ['.csproj']
]);
```

Register it from the product's entry point:

```ts
registrar.registerWorkspaceDetector(createMyDetector());
```

### Put anything expensive in `enrich`

`visit` cannot do I/O. Anything that needs file contents, a subprocess, or the
network goes in the optional `enrich`, which runs in the background once the
index is already queryable and which callers can await via `whenEnriched`.
`enrich` must mutate the entry in place -- typically by pushing onto
`entry.tags` -- so held references stay valid.

This is where "detect azd projects with a given environment name or resource
group" belongs: `visit` finds `azure.yaml`, `enrich` asks `azd`.

A detector that throws is logged and dropped for the rest of that folder's scan;
the rest of the index still loads.

## Caching and invalidation

Storage is a private two-level `DataItemTree` (folders -> entries), which
supplies TTL staleness, keyed eviction, and background enrichment without
bespoke caching code. Because `DataItemTree` dispatches each node to the *first*
provider whose `canHandle` matches -- which would let only one detector ever tag
a folder -- a single `WorkspaceScanProvider` handles every node and fans out to
the detectors itself, merging their taggings by URI.

The tree is entirely private to the service, so the storage strategy can change
without affecting consumers.

Invalidation:

- **File changes.** **One** watcher, `**/*`, for the whole workspace. VS Code
  already watches the workspace recursively, so this is filtered off that
  existing watch rather than costing an OS-level watcher -- and detectors never
  declare what they care about twice. An event is worth a rescan only if it is
  outside the excluded directories *and* either some detector recognizes the
  name (the same `visit` call the scan makes) or it lands on something already
  indexed (so deleting a project folder drops it). Rescans are debounced, so a
  branch switch or `npm install` collapses into one.
- **Workspace folders.** Handled centrally; folders that are still open keep
  their cached scans.
- **TTL.** A five-minute backstop for changes the watcher misses.
- **`refresh()`.** For changes the service cannot observe, e.g. after a tool the
  extension invoked wrote project files.

## Known limitations

**`.gitignore` is not honored.** Honoring ignore files needs `findFiles2`, which
is still proposed API and absent from our `@types/vscode` baseline. So the walk
skips a curated list of directories (`node_modules`, `dist`, `bin`, `.git`, ...)
in
[`workspaceExclusions.ts`](../extensions/vscode-azure/src/workspace/workspaceExclusions.ts),
which is the one place to change when real ignore-file handling becomes
available.

**Queries are not cancelable.** `DataItemTree.getChildren` takes no cancellation
token, and threading one through shared tree infrastructure would be a large
change. Scans are instead bounded (`MaxScanEntries`) and shared, so a wizard
step that abandons a query merely leaves a scan running that warms the cache for
the next caller.

**Invalidation is folder-granular.** A relevant change rescans the whole folder.
A scan is one walk shared by all detectors, so per-detector cache partitions
would need a third tree level and buy little.

