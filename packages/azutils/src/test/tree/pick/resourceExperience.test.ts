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
});
