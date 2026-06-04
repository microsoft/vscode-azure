/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { AzureNodeId } from '../../../models/AzureNodeId';
import { subscriptionExperience } from '../../../tree/pick/subscriptionExperience';
import { makeSubscription } from '../../mockAzure';
import { createMockDataItemTree, createMockViewItemTree } from '../mockTree';

const sub1 = makeSubscription({ subscriptionId: 'sub-1', name: 'Sub One' });
const sub2 = makeSubscription({ subscriptionId: 'sub-2', name: 'Sub Two' });

const sub1Id = AzureNodeId.from(sub1).toString();
const sub2Id = AzureNodeId.from(sub2).toString();

describe('subscriptionExperience (unit)', () => {
    const output = new MockOutputChannel('test');
    it('should return the picked AzureSubscription', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tree = createMockViewItemTree({ '': [sub1Id, sub2Id] });
        const dataItemTree = createMockDataItemTree([sub1, sub2]);

        respondToPrompts(mock, [{ pick: 'sub-2' }]);

        const result = await subscriptionExperience({
            ...ctx,
            tree: tree as never,
            dataItemTree,
            output,
        });

        expect(result.subscriptionId).to.equal('sub-2');
        expect(result.name).to.equal('Sub Two');
    });
});
