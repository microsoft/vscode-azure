/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Wizard } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, DebugOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AzureNodeId } from '../../models/AzureNodeId';
import { type ChooseResourceContext, ChooseResourceStep } from '../../wizard/ChooseResourceStep';
import { makeGenericResource, makeSubscription } from '../mockAzure';
import { createMockDataItemTree, createMockViewItemTree } from '../tree/mockTree';

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

describe('ChooseResourceStep (unit)', () => {
    const output = new DebugOutputChannel('test');
    it('should pick a resource matching the target logicalType', async () => {
        const { ctx, mock } = createMockCodeContext();

        const viewItemTree = createMockViewItemTree({
            '': [subId],
            [subId]: [site1Id, site2Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([subscription, site1, site2, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pick: 'test-sub $(chevron-right)' },
            { pick: 'site1' },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites' })],
        );
        const result = await wizard.run();

        expect(result.resource?.name).to.equal('site1');
        tracker.assertAllConsumed();
    });

    it('should hide resources that do not match the target logicalType', async () => {
        const { ctx, mock } = createMockCodeContext();

        const viewItemTree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pick: 'site1' },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites' })],
        );
        const result = await wizard.run();

        expect(result.resource?.name).to.equal('site1');
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
            { pick: 'test-sub $(chevron-right)' },
            { pick: 'rg1 $(chevron-right)' },
            { pick: 'site2' },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites' })],
        );
        const result = await wizard.run();

        expect(result.resource?.name).to.equal('site2');
        tracker.assertAllConsumed();
    });

    it('should drill through a non-matching virtual group as intermediate', async () => {
        const { ctx, mock } = createMockCodeContext();

        const locationGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~location/eastus';

        const viewItemTree = createMockViewItemTree({
            '': [locationGroupId],
            [locationGroupId]: [site1Id],
        });

        const dataItemTree = createMockDataItemTree([site1]);

        const tracker = respondToPrompts(mock, [
            { pick: 'eastus $(chevron-right)' },
            { pick: 'site1' },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites' })],
        );
        const result = await wizard.run();

        expect(result.resource?.name).to.equal('site1');
        tracker.assertAllConsumed();
    });

    it('should auto-skip a virtual group matching the target resource type', async () => {
        const { ctx, mock } = createMockCodeContext();

        const virtualGroupId = 'azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub/~resourceType/Microsoft.Web%2Fsites';

        const viewItemTree = createMockViewItemTree({
            '': [virtualGroupId],
            [virtualGroupId]: [site1Id, site2Id],
        });

        const dataItemTree = createMockDataItemTree([site1, site2]);

        const tracker = respondToPrompts(mock, [
            { pick: 'site2' },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites' })],
        );
        const result = await wizard.run();

        expect(result.resource?.name).to.equal('site2');
        tracker.assertAllConsumed();
    });

    it('should return multiple resources when canPickMany is true', async () => {
        const { ctx, mock } = createMockCodeContext();

        const viewItemTree = createMockViewItemTree({
            '': [site1Id, site2Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([site1, site2, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pickMany: ['site1', 'site2'] },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites', canPickMany: true })],
        );
        const result = await wizard.run();

        expect(result.resources).to.have.length(2);
        expect(result.resources?.map(r => r.name)).to.deep.equal(['site1', 'site2']);
        tracker.assertAllConsumed();
    });

    it('should filter non-matching resources from multi-pick results', async () => {
        const { ctx, mock } = createMockCodeContext();

        // All items are terminal (sites match, storage doesn't) but canPickMany shows all terminal items
        const viewItemTree = createMockViewItemTree({
            '': [site1Id, storageAccountId],
        });

        const dataItemTree = createMockDataItemTree([site1, storageAccount]);

        const tracker = respondToPrompts(mock, [
            { pickMany: ['site1'] },
        ]);

        const wizard = new Wizard<ChooseResourceContext>(
            output,
            { picks: [] },
            [new ChooseResourceStep({ ...ctx, tree: viewItemTree, dataItemTree, logicalType: 'Microsoft.Web/sites', canPickMany: true })],
        );
        const result = await wizard.run();

        expect(result.resources).to.have.length(1);
        expect(result.resources?.[0].name).to.equal('site1');
        tracker.assertAllConsumed();
    });
});
