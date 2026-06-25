/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { SelectSubscriptions } from '../../commands/SelectSubscriptions';
import { SelectedSubscriptionsConfigurationKey, SubscriptionFilterConfigurationSection } from '../../constants';
import type { IAzureViewDataTree } from '../../services';

describe('SelectSubscriptions (unit)', () => {
    function createPagedTree(
        rootChildren: ConcreteAzureNode[],
        pagesMap: Map<ConcreteAzureNode, ConcreteAzureNode[][]>,
    ): { cache: IAzureViewDataTree; loadMore: ReturnType<typeof mock.fn> } {
        const loaded = new Map<ConcreteAzureNode, number>();
        const loadedCount = (node: ConcreteAzureNode): number => loaded.get(node) ?? 1;

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (!node) {
                return Promise.resolve(rootChildren);
            }

            const pages = pagesMap.get(node) ?? [];
            return Promise.resolve(pages.slice(0, loadedCount(node)).flat());
        });

        const hasMore = mock.fn((node: ConcreteAzureNode): boolean => loadedCount(node) < (pagesMap.get(node)?.length ?? 0));
        const loadMore = mock.fn((node: ConcreteAzureNode): Promise<void> => {
            loaded.set(node, loadedCount(node) + 1);
            return Promise.resolve();
        });

        return {
            cache: { getChildren, hasMore, loadMore } as unknown as IAzureViewDataTree,
            loadMore,
        };
    }

    it('should list reachable subscriptions across pages and save the selected values', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One', tenantId: tenant.tenantId, accountId: account.id });
        const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two', tenantId: tenant.tenantId, accountId: account.id });
        const { cache, loadMore } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[sub1], [sub2]]],
        ]));

        const { ctx, mock: mockResult } = createMockCodeContext();
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)'] }]);

        const command = new SelectSubscriptions(ctx, cache);
        await command.execute();

        expect(mockResult.settings.get(`${SubscriptionFilterConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal(['tenant-1/sub-1']);
        expect(loadMore.mock.callCount()).to.equal(1);
    });

    it('should persist an empty filter when every reachable subscription is selected', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One', tenantId: tenant.tenantId, accountId: account.id });
        const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two', tenantId: tenant.tenantId, accountId: account.id });
        const { cache } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[sub1, sub2]]],
        ]));

        const { ctx, mock: mockResult } = createMockCodeContext();
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)', 'Sub Two (sub-2)'] }]);

        const command = new SelectSubscriptions(ctx, cache);
        await command.execute();

        expect(mockResult.settings.get(`${SubscriptionFilterConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal([]);
    });
});
