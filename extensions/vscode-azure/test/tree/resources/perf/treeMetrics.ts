/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GroupingStrategy, IAcrClient, IResourceClient, IResourceClientProvider } from '@microsoft/vscode-azure-azutils';
import { AcrClient, AzureNodeId, ResourceClient } from '@microsoft/vscode-azure-azutils';
import type { PipelineRequest, PipelineResponse } from '@microsoft/vscode-azure-azutils/testing';
import { createMockAccountDataProvider, makeAccount, makeCredential, makeSubscription, makeTenant, MockHttpClient } from '@microsoft/vscode-azure-azutils/testing';
import type { ViewItemTreeOptions } from '@microsoft/vscode-azure-utils';
import { DataItemTree, ViewItemTree } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { ConfigurationSection } from '../../../../src/constants';
import { AcrDataProvider } from '../../../../src/tree/resources/acr/AcrDataProvider';
import { AzureResourceDataProvider } from '../../../../src/tree/resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from '../../../../src/tree/resources/GenericAzureViewProvider';
import { classifyArmRequest, createArmFixture, type ArmFixtureSpec } from './armFixture';

/**
 * Uniform latency applied to every mocked ARM round trip.
 *
 * Wave detection (see {@linkcode TreeMetrics.criticalPathDepth}) works by
 * watching the in-flight request count return to zero. That only separates
 * waves reliably if a round trip is much longer than the synchronous work
 * between two requests issued by the same batch, which is sub-millisecond. 25ms
 * gives roughly a 25x margin, which is what makes the counter deterministic
 * rather than merely usually-right.
 */
export const ArmLatencyMs = 25;

/**
 * Counters recorded for one tree-load scenario.
 *
 * The first three are the *gated* metrics. They were chosen because they move
 * independently of each other: a change can reduce total work while lengthening
 * the critical path, or leave both alone while multiplying redundant refreshes.
 * Everything under `diagnostics` is recorded to explain a movement in those
 * three, and is deliberately **not** asserted on -- those counters are all
 * proportional to `renderCycles x treeSize`, so gating them would produce
 * fixture churn without independent signal.
 */
export interface TreeMetrics {
    /**
     * Total ARM round trips, counted below
     * {@linkcode DedupeRequestPolicy} so concurrent identical GETs count once
     * -- i.e. this is real network traffic, not call-site count.
     */
    readonly armCalls: number;
    /**
     * Length of the longest chain of ARM round trips that had to happen one
     * after another -- the latency axis, which total call count cannot see.
     *
     * A request's depth is one more than the deepest request that had already
     * *completed* when it was issued, so independent requests share a depth and
     * a request that waited on an earlier one sits below it. Concurrency limits
     * fall out of this for free: sixteen requests through a five-wide limiter
     * measure four deep, and five pages fetched by following `nextLink` measure
     * five deep even though both are "one operation".
     *
     * This is why work and latency are gated separately: a change can cut total
     * calls several-fold while making the critical path longer.
     */
    readonly criticalPathDepth: number;
    /**
     * Change events the view raised with an `undefined` payload, each of which
     * asks VS Code to re-query the *entire* tree.
     *
     * `ViewItemTree` escalates to a full refresh whenever a data-layer change
     * names a node the view has not materialised. Under any grouping other than
     * resource group the view contains virtual type/location groups rather than
     * resource groups, so background enrichment routinely misses and escalates.
     */
    readonly fullRefreshFires: number;

    /** Unasserted counters, recorded to diagnose a movement in the gated three. */
    readonly diagnostics: {
        /** Change events the view raised naming a specific node. Cheap by comparison. */
        readonly targetedFires: number;
        /** Change events the data layer raised, before the view classified them. */
        readonly dataFires: number;
        /** Calls to {@linkcode DataItemTree.loadAll}, i.e. pagination drains. */
        readonly loadAllCalls: number;
        /** Peak number of ARM requests in flight at once. */
        readonly maxConcurrency: number;
        /** ARM round trips broken down by operation. */
        readonly armCallsByOperation: Readonly<Record<string, number>>;
        /** Top-level nodes the scenario's render produced. */
        readonly rootsRendered: number;
        /** Nodes rendered underneath the subscription (groups, or resource groups). */
        readonly groupsRendered: number;
    };
}

/** Description of one measured scenario. */
export interface PerfScenario {
    /** Stable key -- this is what the committed baseline is keyed on. */
    readonly id: string;
    /** One-line explanation of what regression this row is meant to catch. */
    readonly rationale: string;
    /** Topology of the synthetic subscription. */
    readonly fixture: ArmFixtureSpec;
    /** Grouping strategy the view renders under. */
    readonly groupBy: GroupingStrategy;
    /**
     * How much of the tree the scenario renders.
     *
     * - `'groups'` (default) models first paint: the subscription and its
     *   immediate children.
     * - `'expandGroups'` additionally expands every group at once, modelling a
     *   window reopened with expansion state restored -- which is how the
     *   per-resource-group listing path gets exercised.
     */
    readonly render?: 'groups' | 'expandGroups';
}

/**
 * Tracks ARM traffic and derives the causal depth of the request graph.
 *
 * Depth is assigned from *completion* order rather than from wall-clock
 * duration: a request issued while nothing deeper has finished sits at depth
 * one, and every request is one deeper than the deepest request that had
 * already completed when it went out. That makes the result an integer that
 * does not move with CI machine speed, while still distinguishing "five calls
 * in parallel" from "five calls in a chain".
 */
class ArmTrafficRecorder {
    public calls = 0;
    public criticalPathDepth = 0;
    public maxConcurrency = 0;
    public readonly byOperation: Record<string, number> = {};

    private inFlight = 0;
    /** Deepest request that has completed so far; the floor for anything issued now. */
    private completedDepth = 0;

    public async run(request: PipelineRequest, respond: () => PipelineResponse): Promise<PipelineResponse> {
        this.calls++;
        const operation = classifyArmRequest(request.url);
        this.byOperation[operation] = (this.byOperation[operation] ?? 0) + 1;

        const depth = this.completedDepth + 1;
        this.criticalPathDepth = Math.max(this.criticalPathDepth, depth);
        this.inFlight++;
        this.maxConcurrency = Math.max(this.maxConcurrency, this.inFlight);

        try {
            // Compute the response before waiting, so a fixture routing error
            // surfaces as a rejected request rather than a silent hang.
            const response = respond();
            await new Promise(resolve => setTimeout(resolve, ArmLatencyMs));
            return response;
        } finally {
            this.inFlight--;
            this.completedDepth = Math.max(this.completedDepth, depth);
        }
    }
}

/**
 * Wire a real {@linkcode DataItemTree} / {@linkcode ViewItemTree} stack over a
 * synthetic ARM endpoint, render the scenario, and return the counters.
 *
 * Everything below the HTTP boundary is production code: real
 * {@linkcode ResourceClient} and {@linkcode AcrClient} instances over
 * {@linkcode MockHttpClient}, the real providers, the real trees. That matters
 * for {@linkcode TreeMetrics.armCalls} in particular -- mocking
 * {@linkcode IResourceClient} instead would hide pagination follow-ups and
 * count a fiction.
 */
export async function measureScenario(scenario: PerfScenario): Promise<TreeMetrics> {
    const fixture = createArmFixture(scenario.fixture);
    const traffic = new ArmTrafficRecorder();

    const httpClient = new MockHttpClient({
        handler: (request) => traffic.run(request, () => fixture.handle(request)),
    });

    const { executor } = createTestActionExecutor();
    const mockCtx = createMockCodeContext();
    const code = mockCtx.ctx.code;
    mockCtx.mock.settings.set(`${ConfigurationSection}.groupBy`, scenario.groupBy);

    const account = makeAccount();
    const tenant = makeTenant({ accountId: account.id });
    const subscription = makeSubscription({
        subscriptionId: fixture.subscriptionId,
        accountId: tenant.accountId,
        tenantId: tenant.tenantId,
        environment: tenant.environment,
    });

    const credential = makeCredential();
    const resourceClientProvider: IResourceClientProvider = (sub): IResourceClient =>
        ResourceClient.create(mockCtx.ctx, executor, credential, sub, { httpClient });
    const acrClientProvider = (sub: typeof subscription): IAcrClient =>
        AcrClient.create(mockCtx.ctx, executor, credential, sub, { httpClient });

    const dataTree = new DataItemTree<ConcreteAzureNode>(
        code,
        'perf-tree',
        executor,
        resource => AzureNodeId.from(resource).toString(),
        5 * 60 * 1000,
    );

    let loadAllCalls = 0;
    const realLoadAll = dataTree.loadAll.bind(dataTree);
    dataTree.loadAll = (resource: ConcreteAzureNode) => {
        loadAllCalls++;
        return realLoadAll(resource);
    };

    const resourceProvider = new AzureResourceDataProvider(code, executor, resourceClientProvider);
    // Registration order mirrors `registerTrees.ts`: the ACR provider is more
    // specific than the generic resource provider, so it must come first.
    dataTree.registerProvider(new AcrDataProvider(executor, acrClientProvider));
    dataTree.registerProvider(resourceProvider);
    dataTree.registerProvider(createMockAccountDataProvider({
        accounts: [account],
        tenants: [tenant],
        subscriptions: [subscription],
    }));

    let dataFires = 0;
    const dataSubscription = dataTree.onDidChange(() => { dataFires++; });

    const viewOptions: ViewItemTreeOptions<string, ConcreteAzureNode> = {
        dataItemTree: dataTree,
        toViewItem: resource => AzureNodeId.from(resource).toString(),
        getKey: key => key,
        getResourceKey: key => key,
    };
    const viewTree = new ViewItemTree<string, ConcreteAzureNode>('perf-tree', executor, viewOptions, undefined);
    const viewProvider = new GenericAzureViewProvider(mockCtx.ctx, executor, dataTree);
    viewTree.registerProvider(viewProvider);

    let fullRefreshFires = 0;
    let targetedFires = 0;
    const viewSubscription = viewTree.onDidChangeTreeData(item => {
        if (item === undefined) {
            fullRefreshFires++;
        } else {
            targetedFires++;
        }
    });

    try {
        const roots = await viewTree.getChildren();
        const groups = roots.length > 0 ? await viewTree.getChildren(roots[0]) : [];

        if (scenario.render === 'expandGroups') {
            // VS Code expands restored nodes concurrently rather than one at a
            // time, so this must not be a sequential loop -- doing so would
            // turn one wave of parallel requests into a chain and report a
            // critical path that no user ever waits on.
            await Promise.all(groups.map(group => viewTree.getChildren(group)));
        }
        // Background enrichment fires change events without being awaited by
        // anything the render path returns. Without draining it here the fire
        // counts would depend on how fast the machine got through the render,
        // which is precisely the kind of race that makes a gate flaky.
        await dataTree.whenQuiescent();

        return {
            armCalls: traffic.calls,
            criticalPathDepth: traffic.criticalPathDepth,
            fullRefreshFires,
            diagnostics: {
                targetedFires,
                dataFires,
                loadAllCalls,
                maxConcurrency: traffic.maxConcurrency,
                armCallsByOperation: { ...traffic.byOperation },
                rootsRendered: roots.length,
                groupsRendered: groups.length,
            },
        };
    } finally {
        viewSubscription.dispose();
        dataSubscription.dispose();
        viewProvider.dispose();
        resourceProvider.dispose();
        viewTree.dispose();
        dataTree.dispose();
    }
}
