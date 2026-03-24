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
import { resourceExperience } from '../../../tree/pick/resourceExperience';
import { makeGenericResource, makeSubscription } from '../../mockAzure';

const subscription = makeSubscription();

const subId = AzureNodeId.from(subscription).toString();

const site1 = makeGenericResource({ name: 'site1', subscription });
const site2 = makeGenericResource({ name: 'site2', location: 'westus', id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site2', subscription });
const storageAccount = makeGenericResource({
    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1',
    name: 'sa1',
    type: 'Microsoft.Storage/storageAccounts',
    logicalType: 'Microsoft.Storage/storageAccounts',
    subscription,
});

const site1Id = AzureNodeId.from(site1).toString();
const site2Id = AzureNodeId.from(site2).toString();
const storageAccountId = AzureNodeId.from(storageAccount).toString();

function createMockViewItemTree(tree: Record<string, string[]>) {
    return {
        getChildren(key?: string): Promise<string[]> {
            return Promise.resolve(tree[key ?? ''] ?? []);
        },
        getTreeItem(key: string) {
            const label = key.split('/').pop()?.split('#')[0] ?? key;
            return { label, id: key };
        },
    };
}

function createMockDataItemTree(nodes: ConcreteAzureNode[]): DataItemTree<ConcreteAzureNode> {
    const keyMap = new Map<string, ConcreteAzureNode>();
    for (const node of nodes) {
        keyMap.set(AzureNodeId.from(node).toString(), node);
    }
    return {
        get(key: string): ConcreteAzureNode | undefined {
            return keyMap.get(key);
        },
    } as DataItemTree<ConcreteAzureNode>;
}

describe('resourceExperience (unit)', () => {
    it('should pick a resource matching the target logicalType', async () => {
        const { ctx, mock } = createMockCodeContext();

        const viewItemTree = createMockViewItemTree({
            '': [subId],
            [subId]: [site1Id, site2Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([subscription, site1, site2, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pick: 'test-sub $(chevron-right)' },  // pick subscription (intermediate)
            { pick: 'site1' },     // pick site1 (terminal since logicalType matches)
        ]);

        const result = await resourceExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result).to.equal(site1Id);
        tracker.assertAllConsumed();
    });

    it('should hide resources that do not match the target logicalType', async () => {
        const { ctx, mock } = createMockCodeContext();

        // Only matching resources should appear in the picker
        const viewItemTree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pick: 'site1' },  // only site1 should be visible (storage is hidden)
        ]);

        const result = await resourceExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result).to.equal(site1Id);
        tracker.assertAllConsumed();
    });

    it('should drill through a resource group to pick a resource', async () => {
        const { ctx, mock } = createMockCodeContext();

        const rgId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/resourceGroups/rg1';

        const viewItemTree = createMockViewItemTree({
            '': [subId],
            [subId]: [rgId],
            [rgId]: [site1Id, site2Id],
        });

        const dataItemTree = createMockDataItemTree([subscription, site1, site2]);

        const tracker = respondToPrompts(mock, [
            { pick: 'test-sub $(chevron-right)' },   // subscription (intermediate)
            { pick: 'rg1 $(chevron-right)' },         // resource group (intermediate)
            { pick: 'site2' },                         // pick site2 (terminal)
        ]);

        const result = await resourceExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result).to.equal(site2Id);
        tracker.assertAllConsumed();
    });

    it('should drill through a non-matching virtual group as intermediate', async () => {
        const { ctx, mock } = createMockCodeContext();

        // Virtual group for location (not matching the target resource type)
        const locationGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~location/eastus';

        const viewItemTree = createMockViewItemTree({
            '': [locationGroupId],
            [locationGroupId]: [site1Id],
        });

        const dataItemTree = createMockDataItemTree([site1]);

        const tracker = respondToPrompts(mock, [
            { pick: 'eastus $(chevron-right)' },  // location group (intermediate, not skip)
            { pick: 'site1' },                     // pick site1 (terminal)
        ]);

        const result = await resourceExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result).to.equal(site1Id);
        tracker.assertAllConsumed();
    });

    it('should auto-skip a virtual group matching the target resource type', async () => {
        const { ctx, mock } = createMockCodeContext();

        // Virtual group for Microsoft.Web/sites
        const virtualGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~resourceType/Microsoft.Web%2Fsites';

        const viewItemTree = createMockViewItemTree({
            '': [virtualGroupId],
            [virtualGroupId]: [site1Id, site2Id],
        });

        const dataItemTree = createMockDataItemTree([site1, site2]);

        const tracker = respondToPrompts(mock, [
            // Virtual group is auto-skipped (single skip item)
            { pick: 'site2' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result).to.equal(site2Id);
        tracker.assertAllConsumed();
    });
});
