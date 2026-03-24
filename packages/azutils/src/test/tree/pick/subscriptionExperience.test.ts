/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AzureNodeId } from '../../../models/AzureNodeId';
import { subscriptionExperience } from '../../../tree/pick/subscriptionExperience';
import { makeAccount, makeSubscription, makeTenant } from '../../mockAzure';

const account = makeAccount();
const tenant = makeTenant();
const sub1 = makeSubscription({ subscriptionId: 'sub-1', name: 'Sub One' });
const sub2 = makeSubscription({ subscriptionId: 'sub-2', name: 'Sub Two' });

const accountId = AzureNodeId.from(account).toString();
const tenantId = AzureNodeId.from(tenant).toString();
const sub1Id = AzureNodeId.from(sub1).toString();
const sub2Id = AzureNodeId.from(sub2).toString();

function createMockViewItemTree(tree: Record<string, string[]>) {
    return {
        getChildren(key?: string): Promise<string[]> {
            return Promise.resolve(tree[key ?? ''] ?? []);
        },
        getTreeItem(key: string) {
            // Extract a label from the last segment of the URI
            const label = key.split('/').pop() ?? key;
            return { label, id: key };
        },
    };
}

describe('subscriptionExperience (unit)', () => {
    it('should return the picked subscription when directly at root', async () => {
        const { ctx, mock } = createMockCodeContext();
        const viewItemTree = createMockViewItemTree({
            '': [sub1Id, sub2Id],
        });

        respondToPrompts(mock, [
            { pick: 'sub-1' },
        ]);

        const result = await subscriptionExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
        });

        expect(result).to.equal(sub1Id);
    });

    it('should drill through account and tenant to pick a subscription', async () => {
        const { ctx, mock } = createMockCodeContext();
        const viewItemTree = createMockViewItemTree({
            '': [accountId],
            [accountId]: [tenantId],
            [tenantId]: [sub1Id, sub2Id],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'test-account@portal.azure.com $(chevron-right)' }, // pick account (intermediate)
            { pick: 'test-tenant $(chevron-right)' },                   // pick tenant (intermediate)
            { pick: 'sub-2' },                                          // pick subscription (terminal)
        ]);

        const result = await subscriptionExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
        });

        expect(result).to.equal(sub2Id);
        tracker.assertAllConsumed();
    });
});
