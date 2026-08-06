/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { DataItemTree } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, expectRejection } from '@microsoft/vscode-azure-utils/testing';
import { AzureNodeId } from '../../src/models/AzureNodeId';
import type { ConcreteAzureNode } from '../../src/models/AzureNode';
import { findResourceByArmId } from '../../src/tree/findResourceByArmId';
import { createMockAccountDataProvider, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '../mockAzure';

const account = makeAccount({ id: 'acc1' });
const tenant = makeTenant({ accountId: 'acc1', tenantId: 't1' });
const subscription = makeSubscription({ accountId: 'acc1', tenantId: 't1', subscriptionId: 'sub1' });
const group = makeResourceGroup({ name: 'rg1', subscription });
const otherGroup = makeResourceGroup({ name: 'rg2', subscription });

const resource = makeGenericResource({
    id: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/mysite',
    name: 'mysite',
    subscription,
});

function createTree() {
    const code = createMockVsCode().vscode;
    const { executor } = createTestActionExecutor();

    const tree = new DataItemTree<ConcreteAzureNode>(
        code,
        'test-tree',
        executor,
        node => AzureNodeId.from(node).toString(),
        Infinity,
    );

    tree.registerProvider(createMockAccountDataProvider({
        accounts: [account],
        tenants: [tenant],
        subscriptions: [subscription],
    }));

    tree.registerProvider({
        canHandle: (node): node is ConcreteAzureNode =>
            !!node && typeof node === 'object' && ('subscriptionId' in node || 'groupingStrategy' in node),
        getChildren: (node?: ConcreteAzureNode) => {
            if (node && 'subscriptionId' in node) {
                return [group, otherGroup] as ConcreteAzureNode[];
            }
            if (node && 'groupingStrategy' in node) {
                return (node as { name: string }).name === 'rg1' ? [resource] as ConcreteAzureNode[] : [];
            }
            return [];
        },
    });

    return tree;
}

describe('findResourceByArmId (unit)', () => {
    it('finds a resource by drilling account -> tenant -> subscription -> group', async () => {
        expect(await findResourceByArmId(createTree(), resource.id)).to.equal(resource);
    });

    it('matches the ARM id case-insensitively, as ARM does', async () => {
        expect(await findResourceByArmId(createTree(), resource.id.toUpperCase())).to.equal(resource);
    });

    it('returns undefined when the resource does not exist', async () => {
        const missing = '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/nope';
        expect(await findResourceByArmId(createTree(), missing)).to.be.undefined;
    });

    it('returns undefined when the resource group does not exist', async () => {
        const missing = '/subscriptions/sub1/resourceGroups/nope/providers/Microsoft.Web/sites/mysite';
        expect(await findResourceByArmId(createTree(), missing)).to.be.undefined;
    });

    it('returns undefined when the subscription is not signed in', async () => {
        const missing = '/subscriptions/other/resourceGroups/rg1/providers/Microsoft.Web/sites/mysite';
        expect(await findResourceByArmId(createTree(), missing)).to.be.undefined;
    });

    it('returns undefined for an ARM id with no resource group', async () => {
        expect(await findResourceByArmId(createTree(), '/subscriptions/sub1')).to.be.undefined;
    });

    it('throws for an id that is not an ARM id at all', async () => {
        await expectRejection(findResourceByArmId(createTree(), 'not-an-arm-id'), /Invalid ARM resource ID/);
    });
});
