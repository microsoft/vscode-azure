/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { SubscriptionClient, type Subscription, type TenantIdDescription } from '../../../rest/clients/SubscriptionClient';
import { makeCredential, makeSubscription } from '../../mockAzure';
import { makeResponse, MockHttpClient } from '../../mockPipeline';

describe('SubscriptionClient (unit)', () => {
    afterEach(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- test-only: clear the static cache between tests
        (SubscriptionClient as any).locationsCache.clear();
    });

    it('should list tenants as pages', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const tenantsBody = JSON.stringify({
            value: [
                { tenantId: 't1', displayName: 'Tenant 1' },
                { tenantId: 't2', displayName: 'Tenant 2' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, tenantsBody),
        });

        const client = SubscriptionClient.create(ctx, executor, makeCredential(), subscription.environment, { httpClient });

        const tenants: TenantIdDescription[] = [];
        for await (const page of client.tenants.list()) {
            tenants.push(...page.items);
        }

        expect(tenants.map(t => t.tenantId)).to.deep.equal(['t1', 't2']);
    });

    it('should list subscriptions as pages', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const subscriptionsBody = JSON.stringify({
            value: [
                { subscriptionId: 's1', displayName: 'Sub 1', tenantId: 't1' },
                { subscriptionId: 's2', displayName: 'Sub 2', tenantId: 't1' },
            ],
        });

        const httpClient = new MockHttpClient({
            handler: (req) => makeResponse(req, 200, subscriptionsBody),
        });

        const client = SubscriptionClient.create(ctx, executor, makeCredential(), subscription.environment, { httpClient });

        const subscriptions: Subscription[] = [];
        for await (const page of client.subscriptions.list()) {
            subscriptions.push(...page.items);
        }

        expect(subscriptions.map(s => s.subscriptionId)).to.deep.equal(['s1', 's2']);
    });

    it('should list locations for a subscription', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
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

        const client = SubscriptionClient.create(ctx, executor, makeCredential(), subscription.environment, { httpClient });
        const locations = await client.subscriptions.listLocations(subscription.subscriptionId);

        expect(locations).to.have.length(2);
        expect(locations[0].name).to.equal('eastus');
        expect(locations[0].displayName).to.equal('East US');
        expect(locations[1].name).to.equal('westus');
    });

    it('should cache locations across multiple calls', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
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

        const client = SubscriptionClient.create(ctx, executor, makeCredential(), subscription.environment, { httpClient });

        const first = await client.subscriptions.listLocations(subscription.subscriptionId);
        const second = await client.subscriptions.listLocations(subscription.subscriptionId);

        expect(first).to.deep.equal(second);
        expect(callCount).to.equal(1);
    });
});
