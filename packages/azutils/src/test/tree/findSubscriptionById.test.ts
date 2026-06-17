/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type { ConcreteAzureNode } from '../../models/AzureNode';
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
});
