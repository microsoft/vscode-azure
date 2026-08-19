/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IOutputChannel } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../src/models/AzureNode';
import { findSubscriptionById } from '../../src/tree/findSubscriptionById';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';
import { createMockHierarchicalDataItemTree, createMockPagedDataItemTree } from './mockTree';

describe('findSubscriptionById (unit)', () => {
    function createTree() {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: tenant.tenantId, accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant.tenantId, accountId: account.id });

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [account, [tenant]],
            [tenant, [subA, subB]],
        ]);
        const tree = createMockHierarchicalDataItemTree([account], childrenMap);
        return { tree, subA, subB };
    }

    /**
     * A single account with two tenants, each owning one subscription. The
     * `getChildren` is a spy so tests can assert a tenant's subscriptions were
     * never loaded.
     */
    function createMultiTenantTree() {
        const account = makeAccount({ id: 'acct-1' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', accountId: account.id });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: tenant1.tenantId, accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant2.tenantId, accountId: account.id });

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [account, [tenant1, tenant2]],
            [tenant1, [subA]],
            [tenant2, [subB]],
        ]);
        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> =>
            Promise.resolve(node ? childrenMap.get(node) ?? [] : [account]),
        );
        const tree = { getChildren, hasMore: () => false, loadMore: () => Promise.resolve() } as unknown as ConcreteAzureNodeTree;
        return { tree, getChildren, tenant1, tenant2, subA, subB };
    }

    /**
     * Two accounts, each with one tenant owning one subscription. The
     * `getChildren` is a spy so tests can assert a non-matching account's
     * tenants were never loaded.
     */
    function createMultiAccountTree() {
        const account1 = makeAccount({ id: 'acct-1' });
        const account2 = makeAccount({ id: 'acct-2' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', accountId: account1.id });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', accountId: account2.id });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: tenant1.tenantId, accountId: account1.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant2.tenantId, accountId: account2.id });

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
            [account1, [tenant1]],
            [account2, [tenant2]],
            [tenant1, [subA]],
            [tenant2, [subB]],
        ]);
        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> =>
            Promise.resolve(node ? childrenMap.get(node) ?? [] : [account1, account2]),
        );
        const tree = { getChildren, hasMore: () => false, loadMore: () => Promise.resolve() } as unknown as ConcreteAzureNodeTree;
        return { tree, getChildren, account1, account2, subA, subB };
    }

    it('should resolve a subscription by drilling account -> tenant -> subscription', async () => {
        const { tree, subB } = createTree();

        const result = await findSubscriptionById(tree, 'sub-b');

        expect(result).to.equal(subB);
    });

    it('should match case-insensitively', async () => {
        const { tree, subA } = createTree();

        const result = await findSubscriptionById(tree, 'SUB-A');

        expect(result).to.equal(subA);
    });

    it('should return undefined when no subscription matches', async () => {
        const { tree } = createTree();

        const result = await findSubscriptionById(tree, 'sub-missing');

        expect(result).to.be.undefined;
    });

    it('should return undefined when there are no accounts', async () => {
        const tree = createMockHierarchicalDataItemTree([]);

        const result = await findSubscriptionById(tree, 'sub-a');

        expect(result).to.be.undefined;
    });

    it('should search only the given tenant when a tenantId is provided', async () => {
        const { tree, getChildren, tenant1, subB } = createMultiTenantTree();

        const result = await findSubscriptionById(tree, 'sub-b', 'tenant-2');

        expect(result).to.equal(subB);
        // The other tenant's subscriptions must never be loaded.
        expect(getChildren.mock.calls.some(call => call.arguments[0] === tenant1)).to.be.false;
    });

    it('should match the tenantId case-insensitively', async () => {
        const { tree, subB } = createMultiTenantTree();

        const result = await findSubscriptionById(tree, 'sub-b', 'TENANT-2');

        expect(result).to.equal(subB);
    });

    it('should not find a subscription that lives under a different tenant than the one provided', async () => {
        const { tree } = createMultiTenantTree();

        const result = await findSubscriptionById(tree, 'sub-a', 'tenant-2');

        expect(result).to.be.undefined;
    });

    it('should search only the given account when an accountId is provided', async () => {
        const { tree, getChildren, account1, subB } = createMultiAccountTree();

        const result = await findSubscriptionById(tree, 'sub-b', undefined, 'acct-2');

        expect(result).to.equal(subB);
        // The other account's tenants must never be loaded.
        expect(getChildren.mock.calls.some(call => call.arguments[0] === account1)).to.be.false;
    });

    it('should match the accountId case-insensitively', async () => {
        const { tree, subB } = createMultiAccountTree();

        const result = await findSubscriptionById(tree, 'sub-b', undefined, 'ACCT-2');

        expect(result).to.equal(subB);
    });

    it('should not find a subscription that lives under a different account than the one provided', async () => {
        const { tree } = createMultiAccountTree();

        const result = await findSubscriptionById(tree, 'sub-a', undefined, 'acct-2');

        expect(result).to.be.undefined;
    });

    it('should resolve a subscription that appears on a later subscription page', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: tenant.tenantId, accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant.tenantId, accountId: account.id });
        const subC = makeSubscription({ subscriptionId: 'sub-c', tenantId: tenant.tenantId, accountId: account.id });

        const { tree, loadMore } = createMockPagedDataItemTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[subA], [subB], [subC]]],
        ]));

        const result = await findSubscriptionById(tree, 'sub-c');

        // Found only on the third page, so paging must have advanced twice.
        expect(result).to.equal(subC);
        expect(loadMore.mock.callCount()).to.equal(2);
    });

    it('should resolve a tenant that appears on a later tenant page', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant2.tenantId, accountId: account.id });

        const { tree } = createMockPagedDataItemTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant1], [tenant2]]],
            [tenant1, [[]]],
            [tenant2, [[subB]]],
        ]));

        const result = await findSubscriptionById(tree, 'sub-b', 'tenant-2');

        expect(result).to.equal(subB);
    });

    it('should stop paging subscriptions once a match is found', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenantId: tenant.tenantId, accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant.tenantId, accountId: account.id });
        const subC = makeSubscription({ subscriptionId: 'sub-c', tenantId: tenant.tenantId, accountId: account.id });

        const { tree, loadMore } = createMockPagedDataItemTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[subA], [subB], [subC]]],
        ]));

        const result = await findSubscriptionById(tree, 'sub-a');

        // Matched on the first page, so no later pages should have been pulled.
        expect(result).to.equal(subA);
        expect(loadMore.mock.callCount()).to.equal(0);
    });

    it('should skip a tenant whose subscriptions cannot be listed and match a later tenant', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const blockedTenant = makeTenant({ tenantId: 'tenant-blocked', accountId: account.id });
        const tenant = makeTenant({ tenantId: 'tenant-2', accountId: account.id });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenantId: tenant.tenantId, accountId: account.id });

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (node === blockedTenant) {
                return Promise.reject(new Error('Access has been blocked by Conditional Access policies'));
            }
            if (node === account) {
                return Promise.resolve([blockedTenant, tenant]);
            }
            if (node === tenant) {
                return Promise.resolve([subB]);
            }
            return Promise.resolve(node ? [] : [account]);
        });
        const tree = { getChildren, hasMore: () => false, loadMore: () => Promise.resolve() } as unknown as ConcreteAzureNodeTree;

        const result = await findSubscriptionById(tree, 'sub-b');

        expect(result).to.equal(subB);
    });

    it('should return undefined when every tenant fails to list subscriptions', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const blockedTenant = makeTenant({ tenantId: 'tenant-blocked', accountId: account.id });

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (node === blockedTenant) {
                return Promise.reject(new Error('Access has been blocked by Conditional Access policies'));
            }
            return Promise.resolve(node === account ? [blockedTenant] : node ? [] : [account]);
        });
        const tree = { getChildren, hasMore: () => false, loadMore: () => Promise.resolve() } as unknown as ConcreteAzureNodeTree;

        const result = await findSubscriptionById(tree, 'sub-b');

        expect(result).to.be.undefined;
    });

    it('should report each skipped tenant to the output channel', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const blockedTenant = makeTenant({ tenantId: 'tenant-blocked', accountId: account.id });

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (node === blockedTenant) {
                return Promise.reject(new Error('Access has been blocked by Conditional Access policies'));
            }
            return Promise.resolve(node === account ? [blockedTenant] : node ? [] : [account]);
        });
        const tree = { getChildren, hasMore: () => false, loadMore: () => Promise.resolve() } as unknown as ConcreteAzureNodeTree;
        const debug = mock.fn();

        await findSubscriptionById(tree, 'sub-b', undefined, undefined, { debug } as unknown as IOutputChannel);

        expect(debug.mock.callCount()).to.equal(1);
        expect(debug.mock.calls[0].arguments[0]).to.contain('tenant-blocked');
    });
});
