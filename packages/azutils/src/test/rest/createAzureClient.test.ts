/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { AzurePublicCloud } from '../../auth/Environment';
import { createArmRestClient, createArmRestSubscriptionClient } from '../../rest/createAzureClient';
import { makeCredential, makeSubscription } from '../mockAzure';

/** ARM endpoint of {@linkcode AzurePublicCloud} (stored without a trailing slash). */
const publicArmEndpoint = AzurePublicCloud.resourceManagerEndpointUrl;

/**
 * A fake factory function that captures what it received, mimicking
 * the `create*(credential, subscriptionId, options?)` free-function
 * pattern used by the new-style REST SDKs.
 */
interface FakeSubResult { credential: TokenCredential; subId: string; opts: RestClientOptions | undefined }
function fakeSubscriptionFactory(credential: TokenCredential, subscriptionId: string, options?: RestClientOptions): FakeSubResult {
    return { credential, subId: subscriptionId, opts: options };
}
const typedSubFactory = fakeSubscriptionFactory as any as Parameters<typeof createArmRestSubscriptionClient>[2]; // test fake

interface FakeResult { credential: TokenCredential; opts: RestClientOptions | undefined }
function fakeFactory(credential: TokenCredential, options?: RestClientOptions): FakeResult {
    return { credential, opts: options };
}
const typedFactory = fakeFactory as any as Parameters<typeof createArmRestClient>[2]; // test fake

describe('createArmRestSubscriptionClient (unit)', () => {
    it('should pass the credential and subscription ID to the factory', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
        ) as unknown as FakeSubResult;

        expect(client.credential).to.equal(credential);
        expect(client.subId).to.equal('my-sub-id');
    });

    it('should throw if the subscription has an empty subscription ID', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        expect(() =>
            createArmRestSubscriptionClient(
                ctx,
                executor,
                typedSubFactory,
                credential,
                makeSubscription({ subscriptionId: '' }),
            ),
        ).to.throw('Invalid arguments');
    });

    it('should derive the endpoint from the subscription environment', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
        ) as unknown as FakeSubResult;

        expect((client.opts as Record<string, unknown>).endpoint).to.equal(publicArmEndpoint);
    });

    it('should add the standard pipeline policies via additionalPolicies', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
        ) as unknown as FakeSubResult;

        const policyNames = (client.opts?.additionalPolicies ?? []).map(p => p.policy.name);

        expect(policyNames).to.include('DedupeRequestPolicy');
        expect(policyNames).to.include('CorrelationIdPolicy');
        expect(policyNames).to.include('AcceptLanguagePolicy');
    });

    it('should set user agent prefix with extension ID and version', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
        ) as unknown as FakeSubResult;

        const userAgentPrefix = client.opts?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
    });

    it('should concatenate user agent prefix with existing custom prefix', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();
        const customOptions = {
            userAgentOptions: {
                userAgentPrefix: 'CustomClient/1.0.0',
            },
        } as unknown as RestClientOptions;

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
            customOptions,
        ) as unknown as FakeSubResult;

        const userAgentPrefix = client.opts?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
        expect(userAgentPrefix).to.include('CustomClient/1.0.0');
    });

    it('should preserve custom additionalPolicies alongside defaults', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const customPolicy = { name: 'CustomPolicy' };
        const customOptions = {
            additionalPolicies: [
                { policy: customPolicy as any, position: 'perCall' as const },
            ],
        } as unknown as RestClientOptions;

        const client = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            credential,
            makeSubscription({ subscriptionId: 'my-sub-id' }),
            customOptions,
        ) as unknown as FakeSubResult;

        const policyNames = (client.opts?.additionalPolicies ?? []).map(p => p.policy.name);

        expect(policyNames).to.include('CustomPolicy');
        expect(policyNames).to.include('DedupeRequestPolicy');
    });
});

describe('createArmRestClient (unit)', () => {
    it('should pass the credential to the factory', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
        ) as unknown as FakeResult;

        expect(client.credential).to.equal(credential);
    });

    it('should derive the endpoint from the environment', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
        ) as unknown as FakeResult;

        expect((client.opts as Record<string, unknown>).endpoint).to.equal(publicArmEndpoint);
    });

    it('should add the standard pipeline policies via additionalPolicies', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
        ) as unknown as FakeResult;

        const policyNames = (client.opts?.additionalPolicies ?? []).map(p => p.policy.name);

        expect(policyNames).to.include('DedupeRequestPolicy');
        expect(policyNames).to.include('CorrelationIdPolicy');
        expect(policyNames).to.include('AcceptLanguagePolicy');
        expect(policyNames).to.not.include('MFAChallengePolicy');
        expect(policyNames).to.not.include('RemoveBOMPolicy');
    });

    it('should set user agent prefix with extension ID and version', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
        ) as unknown as FakeResult;

        const userAgentPrefix = client.opts?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
    });

    it('should concatenate user agent prefix with existing custom prefix', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();
        const customOptions = {
            userAgentOptions: {
                userAgentPrefix: 'CustomClient/1.0.0',
            },
        } as unknown as RestClientOptions;

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
            customOptions,
        ) as unknown as FakeResult;

        const userAgentPrefix = client.opts?.userAgentOptions?.userAgentPrefix;
        expect(userAgentPrefix).to.include('test-publisher.test-extension/0.0.0-test');
        expect(userAgentPrefix).to.include('CustomClient/1.0.0');
    });

    it('should preserve custom additionalPolicies alongside defaults', () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();

        const customPolicy = { name: 'CustomPolicy' };
        const customOptions = {
            additionalPolicies: [
                { policy: customPolicy as any, position: 'perCall' as const },
            ],
        } as unknown as RestClientOptions;

        const client = createArmRestClient(
            ctx,
            executor,
            typedFactory,
            credential,
            AzurePublicCloud,
            customOptions,
        ) as unknown as FakeResult;

        const policyNames = (client.opts?.additionalPolicies ?? []).map(p => p.policy.name);

        expect(policyNames).to.include('CustomPolicy');
        expect(policyNames).to.include('DedupeRequestPolicy');
    });
});
