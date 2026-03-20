/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { subscriptionExperience } from '../../../tree/pick/subscriptionExperience';

// Node IDs following the azr:// scheme
const accountId = 'azr://acc1@portal.azure.com';
const tenantId = 'azr://acc1@portal.azure.com/tenants/t1';
const sub1Id = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub-1';
const sub2Id = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub-2';

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
            { pick: 'acc1@portal.azure.com $(chevron-right)' },  // pick account (intermediate)
            { pick: 't1 $(chevron-right)' },                     // pick tenant (intermediate)
            { pick: 'sub-2' },                                   // pick subscription (terminal)
        ]);

        const result = await subscriptionExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
        });

        expect(result).to.equal(sub2Id);
        tracker.assertAllConsumed();
    });

    it('should pick directly when subscriptions are at root level', async () => {
        const { ctx, mock } = createMockCodeContext();
        const viewItemTree = createMockViewItemTree({
            '': [sub1Id, sub2Id],
        });

        const tracker = respondToPrompts(mock, [
            { pick: 'sub-1' },
        ]);

        const result = await subscriptionExperience({
            ...ctx,
            viewItemTree: viewItemTree as never,
        });

        expect(result).to.equal(sub1Id);
        tracker.assertAllConsumed();
    });
});
