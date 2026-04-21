/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor, DebugOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { SubscriptionClient } from '../../../rest/clients/SubscriptionClient';
import { makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('SubscriptionClient (unit)', () => {
    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- test-only: clear the static cache between tests
        (SubscriptionClient as any).locationsCache.clear();
    });

    it('should list locations for a subscription', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const output = new DebugOutputChannel('test');
        const subscription = makeSubscription();

        const locationsBody = JSON.stringify({
            value: [
                { name: 'eastus', displayName: 'East US' },
                { name: 'westus', displayName: 'West US' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, locationsBody),
        });

        const client = await SubscriptionClient.create(ctx, executor, output, subscription, { httpClient });
        const locations = await client.subscriptions.listLocations(subscription.subscriptionId);

        expect(locations).to.have.length(2);
        expect(locations[0].name).to.equal('eastus');
        expect(locations[0].displayName).to.equal('East US');
        expect(locations[1].name).to.equal('westus');
    });

    it('should cache locations across multiple calls', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const output = new DebugOutputChannel('test');
        const subscription = makeSubscription();

        let callCount = 0;
        const locationsBody = JSON.stringify({
            value: [
                { name: 'eastus', displayName: 'East US' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => {
                callCount++;
                return makeResponse(req, 200, locationsBody);
            },
        });

        const client = await SubscriptionClient.create(ctx, executor, output, subscription, { httpClient });

        const first = await client.subscriptions.listLocations(subscription.subscriptionId);
        const second = await client.subscriptions.listLocations(subscription.subscriptionId);

        expect(first).to.deep.equal(second);
        expect(callCount).to.equal(1);
    });
});
