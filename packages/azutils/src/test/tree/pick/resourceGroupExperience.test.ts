/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataItemTree } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { ConcreteAzureNode } from '../../../models/AzureNode';
import { AzureNodeId } from '../../../models/AzureNodeId';
import { resourceGroupExperience } from '../../../tree/pick/resourceGroupExperience';
import { makeAccount, makeResourceGroup, makeSubscription, makeTenant } from '../../mockAzure';

const account = makeAccount();
const tenant = makeTenant();
const subscription = makeSubscription();

const rg1 = makeResourceGroup({ name: 'rg1', groupingValue: 'rg1' });
const rg2 = makeResourceGroup({ name: 'rg2', location: 'westus', id: '/subscriptions/test-sub/resourceGroups/rg2', groupingValue: 'rg2' });

// Build a simple mock DataItemTree that maps nodes by their AzureNodeId key
function createMockDataItemTree(
    rootChildren: ConcreteAzureNode[],
    childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>(),
): DataItemTree<ConcreteAzureNode> {
    const keyMap = new Map<string, ConcreteAzureNode>();
    function registerNode(node: ConcreteAzureNode) {
        keyMap.set(AzureNodeId.from(node).toString(), node);
    }

    rootChildren.forEach(registerNode);
    for (const children of childrenMap.values()) {
        children.forEach(registerNode);
    }

    return {
        getChildren(node?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
            if (!node) {
                return Promise.resolve(rootChildren);
            }
            return Promise.resolve(childrenMap.get(node) ?? []);
        },
        get(key: string): ConcreteAzureNode | undefined {
            return keyMap.get(key);
        },
    } as DataItemTree<ConcreteAzureNode>;
}

describe('resourceGroupExperience (unit)', () => {
    it('should drill through subscription to pick a resource group', async () => {
        const { ctx, mock } = createMockCodeContext();

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        childrenMap.set(subscription, [rg1, rg2]);

        const dataItemTree = createMockDataItemTree([subscription], childrenMap);

        const tracker = respondToPrompts(mock, [
            { pick: 'Test Subscription $(chevron-right)' },  // pick subscription (intermediate)
            { pick: 'rg1' },                // pick resource group (terminal)
        ]);

        const result = await resourceGroupExperience({
            ...ctx,
            dataItemTree,
        });

        // Result should be the AzureNodeId for rg1
        const nodeId = AzureNodeId.parse(result);
        expect(nodeId.isResourceGroupNodeId()).to.be.true;
        tracker.assertAllConsumed();
    });

    it('should drill through account, tenant, subscription, to pick a resource group', async () => {
        const { ctx, mock } = createMockCodeContext();

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        childrenMap.set(account as ConcreteAzureNode, [tenant]);
        childrenMap.set(tenant as ConcreteAzureNode, [subscription]);
        childrenMap.set(subscription, [rg1]);

        const dataItemTree = createMockDataItemTree([account as ConcreteAzureNode], childrenMap);

        const tracker = respondToPrompts(mock, [
            { pick: 'Test Account $(chevron-right)' },      // pick account (intermediate)
            { pick: 'Test Tenant $(chevron-right)' },        // pick tenant (intermediate)
            { pick: 'Test Subscription $(chevron-right)' },  // pick subscription (intermediate)
            { pick: 'rg1' },                                 // pick resource group (terminal)
        ]);

        const result = await resourceGroupExperience({
            ...ctx,
            dataItemTree,
        });

        const nodeId = AzureNodeId.parse(result);
        expect(nodeId.isResourceGroupNodeId()).to.be.true;
        tracker.assertAllConsumed();
    });
});
