/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TokenCredential } from '@azure/core-auth';
import type { ServiceClient, ServiceClientOptions } from '@azure/core-client';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { createAzureSubscriptionClient } from '../../rest/createAzureClient';
import { makeSubscription } from '../mockAzure';

/** A fake service client constructor that captures what it received. */
class FakeClient {
    public credential: TokenCredential;
    public subscriptionId: string;
    public options: ServiceClientOptions | undefined;

    constructor(credential: TokenCredential, subscriptionId: string, options?: ServiceClientOptions) {
        this.credential = credential;
        this.subscriptionId = subscriptionId;
        this.options = options;
    }
}

describe('createAzureSubscriptionClient (unit)', () => {
    it('should accept an AzureSubscription and extract credential + subscriptionId', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const subscription = makeSubscription();

        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
            subscription,
        ) as unknown as FakeClient;

        expect(client.credential).to.equal(subscription.credential);
        expect(client.subscriptionId).to.equal('test-sub');
    });

    it('should accept a TokenCredential + subscriptionId string', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const credential: TokenCredential = { getToken: () => Promise.resolve(null) };

        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
            credential,
            'my-sub-id',
        ) as unknown as FakeClient;

        expect(client.credential).to.equal(credential);
        expect(client.subscriptionId).to.equal('my-sub-id');
    });

    it('should throw if TokenCredential is provided with an empty subscription ID string', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const credential: TokenCredential = { getToken: () => Promise.resolve(null) };

        expect(() =>
            createAzureSubscriptionClient(
                ctx,
                executor,
                FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
                credential,
                '', // Empty subscription ID
            ),
        ).to.throw('Invalid arguments');
    });

    it('should set the endpoint from AzureSubscription.environment', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const subscription = makeSubscription();

        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
            subscription,
        ) as unknown as FakeClient;

        expect((client.options as Record<string, unknown>).endpoint).to.equal('https://management.azure.com');
    });

    it('should add pipeline policies via additionalPolicies', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const subscription = makeSubscription();

        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
            subscription,
        ) as unknown as FakeClient;

        const policies = client.options?.additionalPolicies ?? [];
        const policyNames = policies.map(p => p.policy.name);

        expect(policyNames).to.include('DedupeRequestPolicy');
        expect(policyNames).to.include('CorrelationIdPolicy');
        expect(policyNames).to.include('AcceptLanguagePolicy');
        expect(policyNames).to.include('MFAChallengePolicy');
        expect(policyNames).to.include('RemoveBOMPolicy');
    });

    it('should set user agent prefix with extension ID and version', () => {
        const { ctx } = createMockCodeContext();
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const subscription = makeSubscription();

        const client = createAzureSubscriptionClient(
            ctx,
            executor,
            FakeClient as unknown as new (c: TokenCredential, s: string, o?: ServiceClientOptions) => ServiceClient,
            subscription,
        ) as unknown as FakeClient;

        const userAgentPrefix = client.options?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
    });
});
