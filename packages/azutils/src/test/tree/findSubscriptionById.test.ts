/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '../../models/AzureNode';
import { findSubscriptionById } from '../../tree/findSubscriptionById';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';
import { createMockHierarchicalDataItemTree } from './mockTree';

describe('findSubscriptionById (unit)', () => {
    function createTree() {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', account });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenant, account });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant, account });

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
        const tenant1 = makeTenant({ tenantId: 'tenant-1', account });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', account });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenant: tenant1, account });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant: tenant2, account });

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
     * Builds a tree whose branch children are split across multiple pages,
     * mirroring {@linkcode DataItemTree}'s paging contract: `getChildren`
     * returns only the pages loaded so far, `hasMore` reports whether unloaded
     * pages remain, and `loadMore` advances to the next page. Root children are
     * never paged.
     *
     * @param rootChildren - The (unpaged) root nodes.
     * @param pagesMap - Maps a node to its children split into pages.
     */
    function createPagedTree(
        rootChildren: ConcreteAzureNode[],
        pagesMap: Map<ConcreteAzureNode, ConcreteAzureNode[][]>,
    ) {
        const loaded = new Map<ConcreteAzureNode, number>();

        function loadedCount(node: ConcreteAzureNode): number {
            return loaded.get(node) ?? 1;
        }

        const getChildren = mock.fn((node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> => {
            if (!node) {
                return Promise.resolve(rootChildren);
            }
            const pages = pagesMap.get(node) ?? [];
            return Promise.resolve(pages.slice(0, loadedCount(node)).flat());
        });

        const hasMore = mock.fn((node?: ConcreteAzureNode): boolean => {
            if (!node) {
                return false;
            }
            return loadedCount(node) < (pagesMap.get(node)?.length ?? 0);
        });

        const loadMore = mock.fn((node: ConcreteAzureNode): Promise<void> => {
            loaded.set(node, loadedCount(node) + 1);
            return Promise.resolve();
        });

        const tree = { getChildren, hasMore, loadMore } as unknown as ConcreteAzureNodeTree;
        return { tree, getChildren, hasMore, loadMore };
    }

    /**
     * Two accounts, each with one tenant owning one subscription. The
     * `getChildren` is a spy so tests can assert a non-matching account's
     * tenants were never loaded.
     */
    function createMultiAccountTree() {
        const account1 = makeAccount({ id: 'acct-1' });
        const account2 = makeAccount({ id: 'acct-2' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', account: account1 });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', account: account2 });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenant: tenant1, account: account1 });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant: tenant2, account: account2 });

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
        const tenant = makeTenant({ tenantId: 'tenant-1', account });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenant, account });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant, account });
        const subC = makeSubscription({ subscriptionId: 'sub-c', tenant, account });

        const { tree, loadMore } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
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
        const tenant1 = makeTenant({ tenantId: 'tenant-1', account });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', account });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant: tenant2, account });

        const { tree } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant1], [tenant2]]],
            [tenant1, [[]]],
            [tenant2, [[subB]]],
        ]));

        const result = await findSubscriptionById(tree, 'sub-b', 'tenant-2');

        expect(result).to.equal(subB);
    });

    it('should stop paging subscriptions once a match is found', async () => {
        const account = makeAccount({ id: 'acct-1' });
        const tenant = makeTenant({ tenantId: 'tenant-1', account });
        const subA = makeSubscription({ subscriptionId: 'sub-a', tenant, account });
        const subB = makeSubscription({ subscriptionId: 'sub-b', tenant, account });
        const subC = makeSubscription({ subscriptionId: 'sub-c', tenant, account });

        const { tree, loadMore } = createPagedTree([account], new Map<ConcreteAzureNode, ConcreteAzureNode[][]>([
            [account, [[tenant]]],
            [tenant, [[subA], [subB], [subC]]],
        ]));

        const result = await findSubscriptionById(tree, 'sub-a');

        // Matched on the first page, so no later pages should have been pulled.
        expect(result).to.equal(subA);
        expect(loadMore.mock.callCount()).to.equal(0);
    });
});
