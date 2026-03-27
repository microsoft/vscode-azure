/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AzureNodeId } from '../../../models/AzureNodeId';
import { resourceExperience } from '../../../tree/pick/resourceExperience';
import { makeGenericResource, makeSubscription } from '../../mockAzure';
import { createMockDataItemTree, createMockViewItemTree } from '../mockTree';

const subscription = makeSubscription();
const subId = AzureNodeId.from(subscription).toString();

const site1 = makeGenericResource({ name: 'site1', subscription });
const site1Id = AzureNodeId.from(site1).toString();

describe('resourceExperience (unit)', () => {
    it('should return the picked resource typed as the generic parameter', async () => {
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
            tree: tree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
        });

        expect(result.name).to.equal('site1');
        expect(result.logicalType).to.equal('Microsoft.Web/sites');
    });

    it('should return multiple resources when canPickMany is true', async () => {
        const { ctx, mock } = createMockCodeContext();
        const site2 = makeGenericResource({ name: 'site2', subscription, id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site2' });
        const site2Id = AzureNodeId.from(site2).toString();

        const tree = createMockViewItemTree({
            '': [site1Id, site2Id],
        });
        const dataItemTree = createMockDataItemTree([site1, site2]);

        respondToPrompts(mock, [
            { pickMany: ['site1', 'site2'] },
        ]);

        const result = await resourceExperience({
            ...ctx,
            tree: tree as never,
            dataItemTree,
            logicalType: 'Microsoft.Web/sites',
            canPickMany: true,
        });

        expect(result).to.have.length(2);
        expect(result.map(r => r.name)).to.deep.equal(['site1', 'site2']);
    });
});
