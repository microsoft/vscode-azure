/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { AzureNodeId } from '../../../src/models/AzureNodeId';
import { resourceExperience } from '../../../src/tree/pick/resourceExperience';
import { makeGenericResource, makeSubscription } from '../../mockAzure';
import { createMockDataItemTree, createMockViewItemTree } from '../mockTree';

const subscription = makeSubscription();
const subId = AzureNodeId.from(subscription).toString();

const site1 = makeGenericResource({ name: 'site1', subscription });
const site1Id = AzureNodeId.from(site1).toString();

const site2 = makeGenericResource({
    name: 'site2',
    location: 'westus',
    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site2',
    subscription,
});
const site2Id = AzureNodeId.from(site2).toString();

const storageAccount = makeGenericResource({
    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1',
    name: 'sa1',
    type: 'Microsoft.Storage/storageAccounts',
    logicalType: 'Microsoft.Storage/storageAccounts',
    subscription,
});
const storageAccountId = AzureNodeId.from(storageAccount).toString();

describe('resourceExperience (unit)', () => {
    const output = new MockOutputChannel('test');
    it('should pick a resource matching the target logical type', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({
            '': [subId],
            [subId]: [site1Id],
        });
        const dataItemTree = createMockDataItemTree([subscription, site1]);

        respondToPrompts(mock, [
            { pick: 'test-sub $(chevron-right)' },
            { pick: 'site1' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            output,
        });

        expect(result.name).to.equal('site1');
        expect(result.logicalType).to.equal('Microsoft.Web/sites');
    });

    it('should hide resources that do not match the target logical type', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pick: 'site1' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            output,
        });

        expect(result.name).to.equal('site1');
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal(['site1']);
        tracker.assertAllConsumed();
    });

    it('should offer resources of every type when no logical type is given', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        respondToPrompts(mock, [
            { pick: 'sa1' },
        ]);

        const result = await resourceExperience({ ...ctx, tree, dataItemTree, output });

        expect(result.name).to.equal('sa1');
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal(['site1', 'sa1']);
    });

    it('should drill through a resource group to pick a resource', async () => {
        const { ctx, mock } = createMockCodeContext();
        const rgId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/resourceGroups/rg1';

        const tree = createMockViewItemTree({
            '': [subId],
            [subId]: [rgId],
            [rgId]: [site1Id, site2Id],
        });
        const dataItemTree = createMockDataItemTree([subscription, site1, site2]);

        const tracker = respondToPrompts(mock, [
            { pick: 'test-sub $(chevron-right)' },
            { pick: 'rg1 $(chevron-right)' },
            { pick: 'site2' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            output,
        });

        expect(result.name).to.equal('site2');
        tracker.assertAllConsumed();
    });

    it('should drill through a non-matching virtual group as intermediate', async () => {
        const { ctx, mock } = createMockCodeContext();
        const locationGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~location/eastus';

        const tree = createMockViewItemTree({
            '': [locationGroupId],
            [locationGroupId]: [site1Id],
        });
        const dataItemTree = createMockDataItemTree([site1]);

        const tracker = respondToPrompts(mock, [
            { pick: 'eastus $(chevron-right)' },
            { pick: 'site1' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            output,
        });

        expect(result.name).to.equal('site1');
        tracker.assertAllConsumed();
    });

    it('should auto-skip a virtual group matching the target resource type', async () => {
        const { ctx, mock } = createMockCodeContext();
        const virtualGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~resourceType/Microsoft.Web%2Fsites';

        const tree = createMockViewItemTree({
            '': [virtualGroupId],
            [virtualGroupId]: [site1Id, site2Id],
        });
        const dataItemTree = createMockDataItemTree([site1, site2]);

        const tracker = respondToPrompts(mock, [
            { pick: 'site2' },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            output,
        });

        expect(result.name).to.equal('site2');
        tracker.assertAllConsumed();
    });

    it('should return multiple resources when canPickMany is true', async () => {
        const { ctx, mock } = createMockCodeContext();

        const tree = createMockViewItemTree({
            '': [site1Id, site2Id],
        });
        const dataItemTree = createMockDataItemTree([site1, site2]);

        respondToPrompts(mock, [
            { pickMany: ['site1', 'site2'] },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            canPickMany: true,
            output,
        });

        expect(result).to.have.length(2);
        expect(result.map(r => r.name)).to.deep.equal(['site1', 'site2']);
    });

    it('should omit non-matching resources from a multi-pick', async () => {
        const { ctx, mock } = createMockCodeContext();

        const tree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pickMany: ['site1'] },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree,
            dataItemTree,
            logicalTypes: ['Microsoft.Web/sites'],
            canPickMany: true,
            output,
        });

        expect(result.map(r => r.name)).to.deep.equal(['site1']);
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal(['site1']);
        tracker.assertAllConsumed();
    });

    it('should select resources across logical types case-insensitively', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({ '': [site1Id, storageAccountId] });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);
        const tracker = respondToPrompts(mock, [{ pickMany: ['site1', 'sa1'] }]);

        const result = await resourceExperience({
            ...ctx, tree, dataItemTree, output,
            logicalTypes: ['microsoft.web/SITES', 'MICROSOFT.STORAGE/storageAccounts'],
            canPickMany: true,
        });

        expect(result).to.deep.equal([site1, storageAccount]);
        tracker.assertAllConsumed();
    });

    it('should filter resources against every requested logical type', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({ '': [site1Id, storageAccountId] });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);
        const tracker = respondToPrompts(mock, [{ pick: 'sa1' }]);

        const result = await resourceExperience({
            ...ctx, tree, dataItemTree, output,
            logicalTypes: ['Microsoft.ContainerRegistry/registries', 'microsoft.storage/STORAGEACCOUNTS'],
        });

        expect(result).to.equal(storageAccount);
        expect(mock.quickPicks[0].items.map(item => item.label)).to.deep.equal(['sa1']);
        tracker.assertAllConsumed();
    });

    it('should navigate resource-type groups when multiple types are requested', async () => {
        const { ctx, mock } = createMockCodeContext();
        const webGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~resourceType/Microsoft.Web%2Fsites';
        const storageGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~resourceType/Microsoft.Storage%2FstorageAccounts';
        const tree = createMockViewItemTree({
            '': [webGroupId, storageGroupId],
            [webGroupId]: [site1Id],
            [storageGroupId]: [storageAccountId],
        });
        const dataItemTree = createMockDataItemTree([site1, storageAccount]);
        const tracker = respondToPrompts(mock, [
            { pick: 'Microsoft.Storage%2FstorageAccounts $(chevron-right)' },
            { pick: 'sa1' },
        ]);

        const result = await resourceExperience({
            ...ctx, tree, dataItemTree, output,
            logicalTypes: ['Microsoft.Web/sites', 'Microsoft.Storage/storageAccounts'],
        });

        expect(result).to.equal(storageAccount);
        expect(mock.quickPicks[0].items.map(item => item.label))
            .to.deep.equal(['Microsoft.Web%2Fsites $(chevron-right)', 'Microsoft.Storage%2FstorageAccounts $(chevron-right)']);
        tracker.assertAllConsumed();
    });
});
