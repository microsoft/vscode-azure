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
        const tree = { getChildren } as unknown as ConcreteAzureNodeTree;
        return { tree, getChildren, tenant1, tenant2, subA, subB };
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
});
