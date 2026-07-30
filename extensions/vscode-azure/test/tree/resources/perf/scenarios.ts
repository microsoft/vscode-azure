/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PerfScenario } from './treeMetrics';

/**
 * The measured matrix.
 *
 * Each row exists to catch a specific regression; the `rationale` is the
 * contract. Rows are cheap to add and are where most of the value of this
 * suite lives -- the metrics only tell you *that* something moved, the matrix
 * tells you *which shape of subscription* it moved for.
 */
export const scenarios: readonly PerfScenario[] = [
    {
        id: 'typical-groupByResourceType',
        rationale: 'The observed real-world shape: many small resource groups, grouped by resource type. '
            + 'This is the path that costs one ARM call per resource group, and the one most likely to '
            + 'regress when the grouping or fetching strategy changes.',
        fixture: { resourceGroups: 26, totalResources: 75, acrRegistries: 2 },
        groupBy: 'resourceType',
    },
    {
        id: 'typical-groupByResourceGroup',
        rationale: 'The default grouping, which renders resource groups without loading their resources. '
            + 'Guards against a regression that makes the cheap path load resources it does not need.',
        fixture: { resourceGroups: 26, totalResources: 75, acrRegistries: 2 },
        groupBy: 'resourceGroup',
    },
    {
        id: 'fewGroupsManyResources-paginated',
        rationale: 'Few resource groups, many resources, heavily paginated. Pagination is strictly '
            + 'serial -- each page URL is only known once the previous page lands -- so this is the '
            + 'shape where the critical path grows fastest and total call count understates the pain.',
        fixture: { resourceGroups: 10, totalResources: 5000, acrRegistries: 0, resourcePageSize: 1000 },
        groupBy: 'resourceType',
    },
    {
        id: 'manyResourceGroups-paginatedListing',
        rationale: 'More resource groups than one page of the resource-group listing (the tree asks '
            + 'for `$top: 50`), so resource-group pagination and per-group resource loading interact.',
        fixture: { resourceGroups: 60, totalResources: 120, acrRegistries: 0 },
        groupBy: 'resourceType',
    },
    {
        id: 'manyResourceGroups-groupByResourceGroup',
        rationale: 'Same paginated resource-group listing under the default grouping, where the view '
            + 'renders only the first page and leaves the rest to Load More.',
        fixture: { resourceGroups: 60, totalResources: 120, acrRegistries: 0 },
        groupBy: 'resourceGroup',
    },
    {
        id: 'typical-expandAllResourceGroups',
        rationale: 'Every resource group expanded at once, as when a window reopens with expansion '
            + 'state restored. The control row for the two axes: same call count as the grouped '
            + 'render, far less depth, because nothing serialises the requests.',
        fixture: { resourceGroups: 26, totalResources: 75, acrRegistries: 2 },
        groupBy: 'resourceGroup',
        render: 'expandGroups',
    },
    {
        id: 'empty',
        rationale: 'Degenerate case. An empty subscription should cost the resource-group listing and '
            + 'nothing else -- no speculative resource listing.',
        fixture: { resourceGroups: 0, totalResources: 0 },
        groupBy: 'resourceType',
    },
];
