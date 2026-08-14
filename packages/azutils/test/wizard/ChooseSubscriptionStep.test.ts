/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Wizard } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { AzureNodeId } from '../../src/models/AzureNodeId';
import { type ChooseSubscriptionContext, ChooseSubscriptionStep } from '../../src/wizard/ChooseSubscriptionStep';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';
import { createMockDataItemTree, createMockViewItemTree } from '../tree/mockTree';

const account = makeAccount();
const tenant = makeTenant();
const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One' });
const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two' });

const accountId = AzureNodeId.from(account).toString();
const tenantId = AzureNodeId.from(tenant).toString();
const sub1Id = AzureNodeId.from(sub1).toString();
const sub2Id = AzureNodeId.from(sub2).toString();

describe('ChooseSubscriptionStep (unit)', () => {
    const output = new MockOutputChannel('test');
    it('should return the picked subscription when directly at root', async () => {
        const { ctx, mock } = createMockCodeContext();
        const viewItemTree = createMockViewItemTree({
            '': [sub1Id, sub2Id],
        });
        const dataItemTree = createMockDataItemTree([sub1, sub2]);

        respondToPrompts(mock, [
            { pick: 'sub-1' },
        ]);

        const wizard = new Wizard<ChooseSubscriptionContext>(
            output,
            {},
            [new ChooseSubscriptionStep({ ...ctx, tree: viewItemTree, dataItemTree })],
        );
        const result = await wizard.run();

        expect(result.subscription).to.equal(sub1);
    });

    it('should drill through account and tenant to pick a subscription', async () => {
        const { ctx, mock } = createMockCodeContext();
        const viewItemTree = createMockViewItemTree({
            '': [accountId],
            [accountId]: [tenantId],
            [tenantId]: [sub1Id, sub2Id],
        });
        const dataItemTree = createMockDataItemTree([account, tenant, sub1, sub2]);

        const tracker = respondToPrompts(mock, [
            { pick: 'test-account@portal.azure.com $(chevron-right)' },
            { pick: 'test-tenant $(chevron-right)' },
            { pick: 'sub-2' },
        ]);

        const wizard = new Wizard<ChooseSubscriptionContext>(
            output,
            {},
            [new ChooseSubscriptionStep({ ...ctx, tree: viewItemTree, dataItemTree })],
        );
        const result = await wizard.run();

        expect(result.subscription).to.equal(sub2);
        tracker.assertAllConsumed();
    });
});
