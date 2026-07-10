/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { ConcreteAzureNode } from '../../../src/models/AzureNode';
import { resourceGroupExperience } from '../../../src/tree/pick/resourceGroupExperience';
import { makeResourceGroup, makeSubscription } from '../../mockAzure';
import { createMockHierarchicalDataItemTree } from '../mockTree';

const subscription = makeSubscription();
const rg1 = makeResourceGroup({ name: 'rg1', groupingValue: 'rg1' });

describe('resourceGroupExperience (unit)', () => {
    const output = new MockOutputChannel('test');
    it('should return the picked ResourceGroup and subscription', async () => {
        const { ctx, mock } = createMockCodeContext();
        const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        childrenMap.set(subscription, [rg1]);
        const dataItemTree = createMockHierarchicalDataItemTree([subscription], childrenMap);

        respondToPrompts(mock, [
            { pick: 'Test Subscription $(chevron-right)' },
            { pick: 'rg1' },
        ]);

        const result = await resourceGroupExperience({ ...ctx, dataItemTree, output });

        expect(result.resourceGroup.name).to.equal('rg1');
        expect(result.subscription.subscriptionId).to.equal(subscription.subscriptionId);
    });
});
