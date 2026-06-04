/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { createAzureRestClient, createAzureRestSubscriptionClient } from '../../rest/createAzureClient';
import { makeSubscription } from '../mockAzure';

/**
 * A fake factory function that captures what it received, mimicking
 * the `create*(credential, subscriptionId, options?)` free-function
 * pattern used by the new-style REST SDKs.
 */
interface FakeSubResult { credential: TokenCredential; subId: string; opts: RestClientOptions | undefined }
function fakeSubscriptionFactory(credential: TokenCredential, subscriptionId: string, options?: RestClientOptions): FakeSubResult {
    return { credential, subId: subscriptionId, opts: options };
}
const typedSubFactory = fakeSubscriptionFactory as any as Parameters<typeof createAzureRestSubscriptionClient>[2]; // test fake

interface FakeResult { credential: TokenCredential; opts: RestClientOptions | undefined }
function fakeFactory(credential: TokenCredential, options?: RestClientOptions): FakeResult {
    return { credential, opts: options };
}
const typedFactory = fakeFactory as any as Parameters<typeof createAzureRestClient>[2]; // test fake

describe('createAzureRestSubscriptionClient (unit)', () => {
    it('should accept an AzureSubscription and extract credential + subscriptionId', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            subscription,
        ) as unknown as FakeSubResult;

        expect(client.credential).to.equal(subscription.credential);
        expect(client.subId).to.equal('test-sub');
    });

    it('should accept a TokenCredential + subscriptionId string', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential: TokenCredential = { getToken: () => Promise.resolve(null) };

        const client = createAzureRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            'my-sub-id',
        ) as unknown as FakeSubResult;

        expect(client.credential).to.equal(credential);
        expect(client.subId).to.equal('my-sub-id');
    });

    it('should throw if TokenCredential is provided with an empty subscription ID string', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential: TokenCredential = { getToken: () => Promise.resolve(null) };

        expect(() =>
            createAzureRestSubscriptionClient(
                ctx,
                executor,
                typedSubFactory,
                credential,
                '', // Empty subscription ID
            ),
        ).to.throw('Invalid arguments');
    });

    it('should set the endpoint from AzureSubscription.environment', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            subscription,
        ) as unknown as FakeSubResult;

        expect((client.opts as Record<string, unknown>).endpoint).to.equal('https://management.azure.com');
    });

    it('should add pipeline policies via additionalPolicies', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            subscription,
        ) as unknown as FakeSubResult;

        const policies = client.opts?.additionalPolicies ?? [];
        const policyNames = policies.map(p => p.policy.name);

        expect(policyNames).to.include('DedupeRequestPolicy');
        expect(policyNames).to.include('CorrelationIdPolicy');
        expect(policyNames).to.include('AcceptLanguagePolicy');
        expect(policyNames).to.include('MFAChallengePolicy');
        expect(policyNames).to.include('RemoveBOMPolicy');
    });

    it('should set user agent prefix with extension ID and version', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            subscription,
        ) as unknown as FakeSubResult;

        const userAgentPrefix = client.opts?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
    });
});

describe('createAzureRestClient (unit)', () => {
    it('should accept an AzureSubscription and extract credential', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestClient(
            ctx,
            executor,
            typedFactory,
            subscription,
        ) as unknown as FakeResult;

        expect(client.credential).to.equal(subscription.credential);
    });

    it('should set the endpoint from AzureSubscription.environment', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestClient(
            ctx,
            executor,
            typedFactory,
            subscription,
        ) as unknown as FakeResult;

        expect((client.opts as Record<string, unknown>).endpoint).to.equal('https://management.azure.com');
    });

    it('should add pipeline policies via additionalPolicies', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();

        const client = createAzureRestClient(
            ctx,
            executor,
            typedFactory,
            subscription,
        ) as unknown as FakeResult;

        const policies = client.opts?.additionalPolicies ?? [];
        const policyNames = policies.map(p => p.policy.name);

        expect(policyNames).to.include('DedupeRequestPolicy');
        expect(policyNames).to.include('CorrelationIdPolicy');
        expect(policyNames).to.include('AcceptLanguagePolicy');
        expect(policyNames).to.include('MFAChallengePolicy');
        expect(policyNames).to.include('RemoveBOMPolicy');
    });
});
