# Tree performance regression gates

A guardrail suite that measures how much work the Azure resources tree does to
paint itself, and compares it against committed baselines. It lives in
`extensions/vscode-azure/test/tree/resources/perf/` and runs inside the normal
`pnpm test`.

It exists because tree performance regressions are invisible in review. Nothing
in a diff says "this now issues one ARM call per resource group"; you find that
out by reading a debug log, months later, after someone complains that the tree
is slow.

**The gate is report-only today.** It annotates PRs but does not fail them. See
[Promoting the gate to blocking](#promoting-the-gate-to-blocking).

## What is measured

Three counters, chosen because they move *independently* of one another.

| Metric | Means | Typical cause of a regression |
| --- | --- | --- |
| `armCalls` | Total ARM round trips | An N+1 over resource groups, resources, or pages; a lost request-coalescing window |
| `criticalPathDepth` | Longest chain of *dependent* round trips | A prefetch removed, or parallel calls serialised behind pagination |
| `fullRefreshFires` | `onDidChangeTreeData(undefined)` events, each of which asks VS Code to re-query the whole tree | A data-layer change that the view cannot map to a node |

### Why not gate wall-clock time

Because a wall-clock gate on shared CI runners flakes, and a flaky gate gets
`.skip`-ed within a month, after which it protects nothing. Every gated number
here is an integer derived from counting, not timing, and every comparison is an
exact match rather than a tolerance band -- a 10% tolerance on a counter of 4 is
not a threshold, it is a rounding error.

### Why these three and not the obvious ones

Most tree counters are collinear -- they are all just `renderCycles x treeSize`.
In a before/after comparison of the subscription-wide load change, `getTreeItem`
came out at *exactly* 22.0 calls per render cycle in both runs (286/13 and
176/8), with `loadAll` and branch cache hits tracking it closely. Gating those
would generate fixture churn every time a scenario changed size, in exchange for
no signal that `armCalls` does not already carry. They are recorded as
diagnostics and printed with every run, but nothing asserts on them.

### Why `armCalls` and `criticalPathDepth` are both needed

They disagree, and the disagreement is the point. Two rows of the matrix below
make the same 29 ARM calls:

| Scenario | `armCalls` | `criticalPathDepth` |
| --- | --- | --- |
| `typical-groupByResourceType` | 29 | **7** |
| `typical-expandAllResourceGroups` | 29 | **3** |

Identical work, less than half the waiting, because in the second case nothing
serialises the requests. A gate on call count alone cannot tell these apart.

The reverse case is just as real. In a before/after comparison of a change that
served every resource group from one subscription-wide listing:

| | Before | After |
| --- | --- | --- |
| ARM HTTP calls | 31 | 6 |
| Serial waves on the critical path | 4 | **5** |

Total work fell five-fold while the critical path got *longer*, because the fix
removed a prefetch that used to overlap two calls. A gate on call count alone
would have scored that latency regression as an unqualified win.

### `criticalPathDepth`, precisely

Every mocked round trip takes a fixed 25ms. A request's depth is one more than
the deepest request that had already **completed** when it was issued. So:

- requests issued together share a depth,
- a request that waited on an earlier one sits one below it,
- N requests through a K-wide limiter come out at `ceil(N/K)`,
- N pages followed via `nextLink` come out at N, because each page's URL is only
  known once the previous page lands.

This is a causal measure, not a timing one: the 25ms exists only to make
"completed before issued" unambiguous against sub-millisecond synchronous work,
not because the number of milliseconds means anything.

### `fullRefreshFires`, and the latent inefficiency it exposes

`ViewItemTree` forwards data-layer changes like this:

```ts
this.dataItemTreeSubscription = options.dataItemTree.onDidChange(resource => {
    if (resource !== undefined) {
        const node = this.nodes.get(this.getKey(options.toViewItem(resource)));
        if (node) {
            this.changeEmitter.fire(node.viewItem);   // targeted -- cheap
            return;
        }
    }
    this.changeEmitter.fire(undefined);               // FULL REFRESH
});
```

Any data-layer change naming a node the view has not materialised silently
escalates to a whole-tree refresh. Under `resourceType` / `location` / `armTag`
grouping the view holds *virtual* type groups, not resource groups -- so every
resource-group change misses this lookup.

The suite makes the cost concrete: first paint of a 26-group subscription under
resource-type grouping fires **28** full refreshes, versus **0** under the
default resource-group grouping. That is 28 requests to VS Code to re-query the
entire tree, for one paint. It is a real inefficiency, independent of any recent
change, and it is now baselined so that both fixing it and worsening it show up.

## The scenario matrix

The matrix is worth more than the metrics. The metrics tell you *that* something
moved; the matrix tells you *which shape of subscription* it moved for. Rows are
cheap to add and each one carries a `rationale` explaining the regression it
exists to catch.

Measured on `main` (identical across 10 consecutive runs):

| Scenario | Fixture | Grouping | `armCalls` | `depth` | `fullRefreshFires` |
| --- | --- | --- | --- | --- | --- |
| `typical-groupByResourceType` | 26 RGs / 75 resources / 2 ACR | resourceType | 29 | 7 | 28 |
| `typical-groupByResourceGroup` | 26 RGs / 75 resources / 2 ACR | resourceGroup | 1 | 1 | 0 |
| `fewGroupsManyResources-paginated` | 10 RGs / 5000 resources | resourceType | 101 | 21 | 10 |
| `manyResourceGroups-paginatedListing` | 60 RGs / 120 resources | resourceType | 62 | 14 | 60 |
| `manyResourceGroups-groupByResourceGroup` | 60 RGs / 120 resources | resourceGroup | 1 | 1 | 0 |
| `typical-expandAllResourceGroups` | 26 RGs / 75 resources / 2 ACR, all expanded | resourceGroup | 29 | 3 | 0 |
| `empty` | 0 RGs | resourceType | 1 | 1 | 0 |

Three rows deserve comment.

**`typical-groupByResourceType`** is the real-world shape, and it is where the
one-call-per-resource-group cost shows up: 29 calls, 7 levels deep, to paint a
subscription with 75 resources in it.

**`fewGroupsManyResources-paginated`** is where the critical path degrades
fastest. Each of the ten resource groups pages its own 500 resources 50 at a
time, and pagination is strictly serial because a page's URL is only known once
the previous page lands. Fanning out five-wide across resource groups does not
help when the depth is *inside* each one -- hence 101 calls at depth 21.

**`empty`** guards the degenerate case: an empty subscription must cost exactly
the resource-group listing, and nothing else.

## How the harness works

`measureScenario()` wires up the **real** stack -- real `DataItemTree`, real
`ViewItemTree`, real `AzureResourceDataProvider`, `GenericAzureViewProvider`, and
`AcrDataProvider`, real `ResourceClient` and `AcrClient` -- and mocks only the
HTTP boundary, via `MockHttpClient` from
`@microsoft/vscode-azure-azutils/testing`.

Mocking at the HTTP boundary rather than at `IResourceClient` is not a stylistic
preference; it is what makes `armCalls` mean anything:

- it is the only interception point that sees pagination follow-ups (`nextLink`),
  which a client-level mock reports as a single call;
- `DedupeRequestPolicy` sits *above* it and collapses concurrent identical GETs,
  so the count is real network traffic rather than call-site count;
- there is **no retry policy** anywhere in the pipeline, so the count is exactly
  deterministic -- no backoff, no jitter.

Token acquisition is not HTTP (`VsCodeExtensionCredential` delegates to
`code.authentication.getSession()`), so auth never pollutes the count.

`createArmFixture()` generates the ARM responses from a topology description
(counts of groups, resources, registries, page size) rather than from literal
fixture data, and **throws on an unrecognised URL** -- a wiring mistake must not
degrade into a misleadingly good number.

### Enrichment quiescence

The one genuinely new piece of infrastructure. Background enrichment
(`DataItemTree.enrichAll`) runs under a `Limiter(5)` and fires one change event
per resource, unawaited by anything on the render path. A test that asserted
before enrichment settled would see counts that depend on how fast the machine
got through the render -- exactly the kind of race that makes a gate flaky.

`DataItemTree.whenEnriched()` is per-resource only, so this work added
`DataItemTree.whenQuiescent()`: a global drain that resolves once nothing is
enriching anywhere in the tree. It loops (enrichment can cascade) and treats a
rejected enrichment as settled, because quiescence is about activity, not
success.

## Running it

As part of the extension suite:

```sh
cd extensions/vscode-azure && vscode-test --code-version 1.130.0
```

The suite does not use the `vscode` API, so for local iteration it can be run
headless -- much faster, and it does not steal window focus:

```sh
cd extensions/vscode-azure
node --import ./node_modules/tsx/dist/loader.mjs ../../node_modules/mocha/bin/mocha.js \
  --ui bdd "test/tree/resources/perf/TreePerformance.test.ts"
```

The whole matrix takes about 0.6s.

## Reporting tiers

Modelled on the VSIX bundle-size guardrail in `test/extension.test.ts`, but with
exact-match verdicts instead of percentage bands.

| Verdict | Behaviour |
| --- | --- |
| Counter matches baseline | Diagnostics line only |
| Counter **below** baseline | `::notice::` annotation: lower the baseline in this PR so the win is locked in |
| Counter **above** baseline | `::warning::` annotation, plus a hint about what usually causes that counter to grow. Fails the build when `TREE_PERF_ENFORCE=1` |

Annotations are only emitted under `GITHUB_ACTIONS=true`. Two things fail
regardless of mode, because they are wiring bugs rather than performance signals:
a scenario with no baseline, and a scenario that made zero ARM calls or rendered
zero groups (which would otherwise read as a spectacular improvement and quietly
disable the gate).

## Promoting the gate to blocking

Set `TREE_PERF_ENFORCE=1` in CI, or change the default in
`TreePerformance.test.ts`.

Do not do this yet. The baselines have been verified identical across 10
consecutive runs on one machine, which is evidence but not proof: it says
nothing about a different Node version, a loaded CI runner, or a different
platform. A gate is only worth having if people trust it, and trust is earned by
a stretch of runs where it never fires spuriously -- not by a design argument.
Let it annotate real PRs for a few weeks first. If it produces a false positive
in that window, fix the source of non-determinism or drop that metric; do not
widen the threshold, because a counter gate with a tolerance is just a slower way
of measuring nothing.

## What this does not catch

Be clear-eyed about the limits.

- **Mock fidelity.** ARM latency is a uniform 25ms. Real ARM is neither uniform
  nor 25ms, and real throttling (429s with `Retry-After`) does not exist here at
  all. The suite measures the *shape* of the request graph, not its duration.
- **VS Code's own rendering is unobservable.** `ViewItemTree` is handed straight
  to `createTreeView`; what VS Code does with a change event -- including how
  much it batches -- is invisible from the extension. The observed "13 render
  cycles" cannot be reproduced. `fullRefreshFires` is the honest proxy: it counts
  what the extension *asks for*, not what VS Code *does*. A change that halves
  full refreshes has certainly not made rendering worse, but the suite cannot
  tell you it made it exactly twice as good.
- **Only the resources tree, only first paint.** The workspace and activity trees
  are not covered. Neither is Load More, refresh-after-invalidate, or the tenant
  and subscription levels above the resource provider.
- **Scenarios, not reality.** Every number is a function of the fixture. A change
  that regresses only for a subscription shape not in the matrix will sail
  through. Adding a row is the cheapest possible fix for that, and is the main
  way this suite should grow.
- **Baseline churn is real.** `fullRefreshFires` in particular scales with the
  number of resource groups in the fixture, so changing a scenario's topology
  changes its baseline. Prefer adding a row over resizing an existing one.
- **Change-event *order* is not deterministic** (`Limiter(5)`, completion-order
  dependent) and is therefore never asserted on. Only counts are gated.

## Files

| File | Role |
| --- | --- |
| `perf/armFixture.ts` | Generates ARM responses (groups, resources, pagination, ACR) from a topology spec |
| `perf/treeMetrics.ts` | Wires the real tree stack over the fixture and records the counters |
| `perf/scenarios.ts` | The matrix, with a `rationale` per row |
| `perf/baselines.ts` | Committed baselines, with the anti-casual-bump comment |
| `perf/TreePerformance.test.ts` | Comparison, tiered reporting, and the enforcement switch |
