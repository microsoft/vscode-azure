/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Wizard } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { ConcreteAzureNode } from '../../models/AzureNode';
import { type ChooseResourceGroupContext, ChooseResourceGroupStep } from '../../wizard/ChooseResourceGroupStep';
import { makeAccount, makeResourceGroup, makeSubscription, makeTenant } from '../mockAzure';
import { createMockHierarchicalDataItemTree } from '../tree/mockTree';

const account = makeAccount();
const tenant = makeTenant();
const subscription = makeSubscription();

const rg1 = makeResourceGroup({ name: 'rg1', groupingValue: 'rg1' });
const rg2 = makeResourceGroup({ name: 'rg2', location: 'westus', id: '/subscriptions/test-sub/resourceGroups/rg2', groupingValue: 'rg2' });

describe('ChooseResourceGroupStep (unit)', () => {
    it('should drill through subscription to pick a resource group', async () => {
        const { ctx, mock } = createMockCodeContext();

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        childrenMap.set(subscription, [rg1, rg2]);

        const dataItemTree = createMockHierarchicalDataItemTree([subscription], childrenMap);

        const tracker = respondToPrompts(mock, [
            { pick: 'Test Subscription $(chevron-right)' },
            { pick: 'rg1' },
        ]);

        const wizard = new Wizard<ChooseResourceGroupContext>(
            {},
            [new ChooseResourceGroupStep({ ...ctx, dataItemTree })],
        );
        const result = await wizard.run();

        expect(result.resourceGroup).to.equal(rg1);
        expect(result.subscription?.subscriptionId).to.equal(subscription.subscriptionId);
        tracker.assertAllConsumed();
    });

    it('should drill through account, tenant, subscription, to pick a resource group', async () => {
        const { ctx, mock } = createMockCodeContext();

        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        childrenMap.set(account, [tenant]);
        childrenMap.set(tenant, [subscription]);
        childrenMap.set(subscription, [rg1]);

        const dataItemTree = createMockHierarchicalDataItemTree([account], childrenMap);

        const tracker = respondToPrompts(mock, [
            { pick: 'Test Account $(chevron-right)' },
            { pick: 'Test Tenant $(chevron-right)' },
            { pick: 'Test Subscription $(chevron-right)' },
            { pick: 'rg1' },
        ]);

        const wizard = new Wizard<ChooseResourceGroupContext>(
            {},
            [new ChooseResourceGroupStep({ ...ctx, dataItemTree })],
        );
        const result = await wizard.run();

        expect(result.resourceGroup).to.equal(rg1);
        expect(result.subscription?.subscriptionId).to.equal(subscription.subscriptionId);
        tracker.assertAllConsumed();
    });
});
