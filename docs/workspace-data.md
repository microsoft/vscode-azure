# Workspace Data

The **workspace data service** is a single, shared, queryable index of what is in
the user's open workspace. Detectors tag files and folders with namespaced tags;
consumers ask for everything carrying a tag instead of running their own search.

It exists because every feature that cares about the workspace -- tree data
providers, creation wizards, deployment commands -- otherwise hand-rolls the same
three things: a `findFiles` call, a file watcher, and its own idea of what a
"project" is. That means N scans of the same folders, N watchers, and N
subtly-different answers.

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

## Writing a detector

Implement `WorkspaceDetector`. Detection is deliberately unconstrained: read
files, parse manifests, do whatever the product needs. Anything glob-shaped
should go through `context.findFiles`, which applies the shared exclusions and
coalesces repeated globs within a scan.

```ts
const MyTag = defineWorkspaceTag<{ framework: string }>('myproduct', 'app');

export function createMyDetector(): WorkspaceDetector {
    return {
        namespace: 'myproduct',
        watchPatterns: ['**/my.config.json'],
        async detect(context) {
            const configs = await context.findFiles('**/my.config.json');
            return configs.map(uri => ({
                uri: dirname(uri),
                isDirectory: true,
                tags: [applyTag(MyTag, { framework: 'whatever' })],
            }));
        },
    };
}
```

For the common "a marker file means this tag" case, use the declarative helper
instead -- adding a project type is then a table entry, not a code path:

```ts
createMarkerFileDetector('myproduct', [
    { tag: MyTag, patterns: ['**/my.config.json'] },
]);
```

Register it from the product's entry point:

```ts
registrar.registerWorkspaceDetector(createMyDetector());
```

### Keep `detect` cheap

`detect` runs on activation, on workspace changes, and inside interactive wizard
steps. Push expensive work (spawning a CLI, parsing large files) into the
optional `enrich`, which runs in the background once the index is already
queryable and which callers can await via `whenEnriched`. `enrich` must mutate
the entry in place -- typically by pushing onto `entry.tags` -- so held
references stay valid.

This is where "detect azd projects with a given environment name or resource
group" belongs: `detect` finds `azure.yaml`, `enrich` asks `azd`.

A detector that throws is logged and skipped for that folder; the rest of the
index still loads.

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

- **File changes.** One watcher per distinct declared `watchPatterns` glob.
  Plain-string globs are filtered off VS Code's existing recursive workspace
  watcher rather than creating OS-level watchers, so declaring several is
  effectively free. A hit invalidates the containing workspace folder, debounced
  so a branch switch or `npm install` collapses into one rescan.
- **Workspace folders.** Handled centrally; folders that are still open keep
  their cached scans.
- **TTL.** A five-minute backstop for changes the watcher misses.
- **`refresh()`.** For changes the service cannot observe, e.g. after a tool the
  extension invoked wrote project files.

A detector that declares no `watchPatterns` cannot be invalidated by file changes
and relies on the TTL and explicit refreshes.

## Known limitations

**`.gitignore` is not honored.** Stable `vscode.workspace.findFiles` hard-codes
`useIgnoreFiles: { local: false }` internally, and drops the user's
`files.exclude` as soon as an explicit `exclude` argument is passed. So
exclusions are a curated list of directories (`node_modules`, `dist`, `bin`,
`.git`, ...) in
[`workspaceExclusions.ts`](../extensions/vscode-azure/src/workspace/workspaceExclusions.ts).
When `findFiles2` (which accepts `useIgnoreFiles`) leaves proposed API and lands
in our `@types/vscode` baseline, that one file is the place to swap in real
ignore-file handling.

**Queries are not cancelable.** `DataItemTree.getChildren` takes no cancellation
token, and threading one through shared tree infrastructure would be a large
change. Scans are instead bounded (`DefaultScanMaxResults`) and shared, so a
wizard step that abandons a query merely leaves a scan running that warms the
cache for the next caller.

**Invalidation is folder-granular.** A watcher hit rescans every detector for
that folder. A scan is a handful of searches, so per-detector cache partitions
would need a third tree level and buy little.
