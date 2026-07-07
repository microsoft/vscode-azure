/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor, MockQuickPick, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { SelectSubscriptions } from '../../commands/SelectSubscriptions';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../../constants';
import { CredentialOptionsScope } from '../../CredentialOptionsScope';
import type { IAzureViewDataTree } from '../../services';

describe('SelectSubscriptions (unit)', () => {
    /**
     * Build a fake {@linkcode IAzureViewDataTree} whose children come from
     * `pagesMap`. Any node listed in `failNodes` rejects on `getChildren`,
     * simulating a tenant whose subscriptions cannot be enumerated silently.
     */
    function createPagedTree(
        rootChildren: ConcreteAzureNode[],
        pagesMap: Map<ConcreteAzureNode, ConcreteAzureNode[][]>,
        failNodes = new Set<ConcreteAzureNode>(),
    ): { cache: IAzureViewDataTree; loadMore: ReturnType<typeof mock.fn> } {
        const loaded = new Map<ConcreteAzureNode, number>();
        const loadedCount = (node: ConcreteAzureNode): number => loaded.get(node) ?? 1;

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (!node) {
                return Promise.resolve(rootChildren);
            }

            if (failNodes.has(node)) {
                return Promise.reject(new Error('token acquisition failed'));
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

    function createCommand(cache: IAzureViewDataTree) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const command = new SelectSubscriptions(ctx, executor, cache, new CredentialOptionsScope());
        return { command, ctx, mockResult };
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

        const { command, mockResult } = createCommand(cache);
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)'] }]);

        await command.execute();

        expect(mockResult.settings.get(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal(['tenant-1/sub-1']);
        expect(loadMore.mock.callCount()).to.equal(1);
    });

    it('should pre-check the currently-selected subscriptions case-insensitively', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One', tenantId: tenant.tenantId, accountId: account.id });
        const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two', tenantId: tenant.tenantId, accountId: account.id });
        const { cache } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[sub1, sub2]]],
        ]));

        const { command, mockResult } = createCommand(cache);

        // Seed the filter with an UPPERCASE id: the command lowercases both the
        // stored ids and the computed selection key, so the pre-check must still
        // match sub-2 despite the case difference.
        mockResult.settings.set(
            `${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`,
            ['TENANT-1/SUB-2'],
        );

        // Snapshot which items production pre-checks (assigned to selectedItems
        // before show()), then accept that selection unchanged.
        const preChecked: string[] = [];
        mockResult.window.createQuickPick.mock.mockImplementation(() => {
            const qp = new MockQuickPick<vscode.QuickPickItem>();
            (mockResult.quickPicks as MockQuickPick<vscode.QuickPickItem>[]).push(qp);
            qp.show.mock.mockImplementation(() => {
                preChecked.push(...qp.selectedItems.map(item => item.label));
                qp.accept();
            });
            return qp;
        });

        await command.execute();

        // Only sub-2 was in the (upper-cased) filter, so only it is pre-checked...
        expect(preChecked).to.deep.equal(['Sub Two (sub-2)']);
        // ...and accepting the pre-checked set round-trips to the lowercased id.
        expect(mockResult.settings.get(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal(['tenant-1/sub-2']);
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

        const { command, mockResult } = createCommand(cache);
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)', 'Sub Two (sub-2)'] }]);

        await command.execute();

        expect(mockResult.settings.get(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal([]);
    });

    it('should skip a tenant whose subscriptions fail to load and warn instead of aborting', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const goodTenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Good Tenant', accountId: account.id });
        const badTenant = makeTenant({ tenantId: 'tenant-2', displayName: 'Bad Tenant', accountId: account.id });
        const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One', tenantId: goodTenant.tenantId, accountId: account.id });
        const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two', tenantId: goodTenant.tenantId, accountId: account.id });
        const { cache } = createPagedTree(
            [account],
            new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
                [account, [[goodTenant, badTenant]]],
                [goodTenant, [[sub1, sub2]]],
            ]),
            new Set<ConcreteAzureNode>([badTenant]),
        );

        const { command, mockResult } = createCommand(cache);
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)', 'Sub Two (sub-2)'] }]);

        await command.execute();

        // The failing tenant is surfaced as a non-blocking warning...
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
        // ...and even though every *loaded* subscription was selected, the filter
        // is NOT collapsed to [] (which would unhide the un-enumerated tenant).
        expect(mockResult.settings.get(`${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`))
            .to.deep.equal(['tenant-1/sub-1', 'tenant-1/sub-2']);
    });

    it('should throw when no tenant could be enumerated', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const badTenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Bad Tenant', accountId: account.id });
        const { cache } = createPagedTree(
            [account],
            new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
                [account, [[badTenant]]],
            ]),
            new Set<ConcreteAzureNode>([badTenant]),
        );

        const { command, mockResult } = createCommand(cache);

        let caught: unknown;
        try {
            await command.execute();
        } catch (error) {
            caught = error;
        }

        expect(caught).to.be.instanceOf(Error);
        expect((caught as Error).message).to.match(/Could not load subscriptions for any tenant/);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
    });
});
