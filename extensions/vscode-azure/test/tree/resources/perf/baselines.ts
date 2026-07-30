/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** The three gated counters, per scenario. */
export interface TreePerfBaseline {
    /** Total ARM round trips below the dedupe policy. */
    readonly armCalls: number;
    /** Longest chain of dependent ARM round trips. */
    readonly criticalPathDepth: number;
    /** Change events that ask VS Code to re-query the whole tree. */
    readonly fullRefreshFires: number;
}

/**
 * Measured baselines for the tree-load scenarios in `scenarios.ts`.
 *
 * These are guardrails, NOT targets. Their job is to notice when a change makes
 * the resource tree measurably worse in a way that no one would spot by reading
 * a debug log -- an extra ARM call per resource group, a prefetch removed so the
 * critical path grows a level, a refresh that escalates to the whole tree.
 *
 * Every number here is a **count**, not a duration, and every comparison is an
 * exact match rather than a percentage band. Wall-clock gates flake on shared CI
 * runners, and a flaky gate is `.skip`-ed within a month and then protects
 * nothing. A percentage tolerance on a counter of 4 is equally meaningless.
 * These counters were verified identical across repeated runs before being
 * committed; see `docs/tree-perf-gates.md`.
 *
 * DO NOT bump these baselines casually. Before changing one, work out *which*
 * of the three axes moved and why:
 *
 * - `armCalls` up: the tree is doing more total work. Usually an N+1 -- one call
 *   per resource group, per resource, or per page -- or a lost request-coalescing
 *   window.
 * - `criticalPathDepth` up: the tree is *slower* even if it is doing less work,
 *   because round trips that used to overlap now happen one after another. This
 *   is the axis a call-count gate cannot see, and it has regressed before while
 *   `armCalls` improved five-fold.
 * - `fullRefreshFires` up: the tree is asking VS Code to re-query everything more
 *   often. Each one re-runs `getTreeItem` for every visible node.
 *
 * A PR that touches a number here should say in its description which axis moved
 * and why that is acceptable. If you cannot explain it, investigate before
 * updating the baseline. A drop is good news, but still update the baseline in
 * the same PR -- a stale-low baseline silently stops guarding the improvement.
 */
export const TreePerfBaselines: Readonly<Record<string, TreePerfBaseline>> = {
    // One call to list the resource groups, then one listing per resource group
    // through a five-wide limiter, then the two registries enrich. Note the
    // contrast with `typical-expandAllResourceGroups`, which makes the *same*
    // 29 calls but only 3 deep: identical work, less than half the waiting.
    // Serving every resource group from a single subscription-wide listing
    // takes this row to 4 calls at depth 3.
    //
    // The 28 full refreshes are one per resource group plus one per registry:
    // under resource-type grouping the view holds virtual type groups, so no
    // data-layer change naming a resource group can be matched to a view node
    // and every one of them escalates to a whole-tree refresh. That is a latent
    // inefficiency independent of how the resources are fetched, baselined here
    // so that fixing it shows up -- and so that making it worse does too.
    'typical-groupByResourceType': { armCalls: 29, criticalPathDepth: 7, fullRefreshFires: 28 },

    // The default grouping renders resource groups without loading any resources
    // at all, so first paint is a single ARM call and nothing escalates.
    'typical-groupByResourceGroup': { armCalls: 1, criticalPathDepth: 1, fullRefreshFires: 0 },

    // The pathological shape: few resource groups, many resources. Each of the
    // ten resource groups pages its own 500 resources 50 at a time, and those
    // pages are strictly serial because each page's URL is only known once the
    // previous one lands. Five-wide across resource groups does not help much
    // when the depth is inside each one.
    'fewGroupsManyResources-paginated': { armCalls: 101, criticalPathDepth: 21, fullRefreshFires: 10 },

    // 60 resource groups against a `$top: 50` listing: two pages of resource
    // groups, then one listing per group. Every resource group escalates to a
    // full refresh, so this row is the most sensitive to a change in the view's
    // refresh targeting.
    'manyResourceGroups-paginatedListing': { armCalls: 62, criticalPathDepth: 14, fullRefreshFires: 60 },

    // Same subscription under the default grouping: only the first page of
    // resource groups is rendered and the rest are left to Load More, so this
    // stays at one call no matter how many resource groups exist.
    'manyResourceGroups-groupByResourceGroup': { armCalls: 1, criticalPathDepth: 1, fullRefreshFires: 0 },

    // Expanding every resource group at once costs one call per group, but they
    // all go out together, so the user waits on three round trips rather than
    // 29. This row is the control that keeps the two axes honest: it has the
    // same `armCalls` as `typical-groupByResourceType` and less than half the
    // depth, which is the whole reason both are gated.
    'typical-expandAllResourceGroups': { armCalls: 29, criticalPathDepth: 3, fullRefreshFires: 0 },

    // An empty subscription must cost exactly the resource-group listing. A
    // regression here would mean the tree speculatively lists resources for a
    // subscription that has none.
    'empty': { armCalls: 1, criticalPathDepth: 1, fullRefreshFires: 0 },
};
