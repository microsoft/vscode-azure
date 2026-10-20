/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { ChallengeCallbacks, PipelinePolicy, PipelineRequest } from '@azure/core-rest-pipeline';
import { delay } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzurePublicCloud } from '../../src/auth/Environment';
import { createArmRestClient, createArmRestSubscriptionClient, createDataPlaneRestClient } from '../../src/rest/createAzureClient';
import { makeCredential, makeSubscription } from '../mockAzure';
import { makeRequest, makeResponse, MockHttpClient } from '../mockPipeline';

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

function getDedupePolicy(client: FakeResult | FakeSubResult): PipelinePolicy {
    const policy = client.opts?.additionalPolicies?.find(config => config.policy.name === 'DedupeRequestPolicy')?.policy;
    if (!policy) {
        throw new Error('DedupeRequestPolicy was not configured');
    }
    return policy;
}

async function countConcurrentRequests(policy1: PipelinePolicy, policy2: PipelinePolicy): Promise<number> {
    const next = mock.fn(async (request: PipelineRequest) => {
        await delay(10);
        return makeResponse(request);
    });
    await Promise.all([
        policy1.sendRequest(makeRequest(), next),
        policy2.sendRequest(makeRequest(), next),
    ]);
    return next.mock.callCount();
}

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

    it('should preserve cross-client deduplication for harmless options', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();
        const options = { userAgentOptions: { userAgentPrefix: 'CustomClient/1.0.0' } };
        const client1 = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            makeCredential(),
            subscription,
            options,
        ) as unknown as FakeSubResult;
        const client2 = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            makeCredential(),
            subscription,
            options,
        ) as unknown as FakeSubResult;

        const callCount = await countConcurrentRequests(getDedupePolicy(client1), getDedupePolicy(client2));

        expect(callCount).to.equal(1);
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

    it('should isolate clients with custom policies', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const subscription = makeSubscription();
        const customPolicy: PipelinePolicy = {
            name: 'CustomPolicy',
            sendRequest: (request, next) => next(request),
        };
        const options = { additionalPolicies: [{ policy: customPolicy, position: 'perCall' as const }] };
        const client1 = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            makeCredential(),
            subscription,
            options,
        ) as unknown as FakeSubResult;
        const client2 = createArmRestSubscriptionClient(
            ctx,
            executor,
            typedSubFactory,
            makeCredential(),
            subscription,
            options,
        ) as unknown as FakeSubResult;

        const callCount = await countConcurrentRequests(getDedupePolicy(client1), getDedupePolicy(client2));

        expect(callCount).to.equal(2);
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

describe('createDataPlaneRestClient (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    for (const scopes of [undefined, ['https://example.test/.default']]) {
        it(`should retry a challenged request using the callback (${scopes ? 'explicit scopes' : 'no scopes'})`, async () => {
            const { ctx } = createMockCodeContext();
            const { executor } = createTestActionExecutor();
            const credential = makeCredential();
            const getToken = mock.method(credential, 'getToken');
            const authorize = mock.fn<NonNullable<ChallengeCallbacks['authorizeRequestOnChallenge']>>(({ request }) => {
                request.headers.set('authorization', 'Bearer service-token');
                return Promise.resolve(true);
            });
            const send = mock.fn((request: PipelineRequest) => makeResponse(
                request,
                request.headers.get('authorization') === 'Bearer service-token' ? 200 : 401,
                undefined,
                { 'www-authenticate': 'Bearer scope="https://example.test/.default"' },
            ));
            const httpClient = new MockHttpClient({ handler: send });
            const client = createDataPlaneRestClient(ctx, executor, {
                name: 'example-service',
                endpoint: 'https://example.test',
                credential,
                scopes,
                challengeCallbacks: { authorizeRequestOnChallenge: authorize },
            }, { httpClient });

            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            await client.path('/items').get();

            expect(getToken.mock.callCount()).to.equal(1);
            expect(getToken.mock.calls[0].arguments[0]).to.deep.equal(scopes ?? []);
            expect(authorize.mock.callCount()).to.equal(1);
            expect(send.mock.calls.map(call => call.result?.status)).to.deep.equal([401, 200]);
            expect(httpClient.requests).to.have.length(2);
        });
    }

    it('should preserve authentication scopes and standard policies on credentialed requests', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credential = makeCredential();
        const getToken = mock.method(credential, 'getToken');
        const scopes = ['https://example.test/read', 'https://example.test/write'];
        const httpClient = new MockHttpClient({
            handler: request => {
                expect(request.headers.get('authorization')).to.equal('Bearer mock-token');
                expect(request.headers.get('accept-language')).to.equal(ctx.code.env.language);
                expect(request.headers.get('user-agent')).to.include(ctx.extensionContext.extension.id);
                return makeResponse(request);
            },
        });
        const client = createDataPlaneRestClient(ctx, executor, {
            name: 'example-service',
            endpoint: 'https://example.test',
            credential,
            scopes,
        }, { httpClient });
        scopes.push('https://example.test/unrequested');

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await client.path('/items').get();

        expect(getToken.mock.callCount()).to.equal(1);
        expect(getToken.mock.calls[0].arguments[0]).to.deep.equal([
            'https://example.test/read',
            'https://example.test/write',
        ]);
        expect(httpClient.requests).to.have.length(1);
    });

    it('should send requests through the configured endpoint and standard pipeline', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const httpClient = new MockHttpClient({
            handler: request => makeResponse(request),
        });
        const client = createDataPlaneRestClient(ctx, executor, {
            name: 'example-service',
            endpoint: 'https://example.test',
        }, { httpClient });

        // The untyped core REST client exposes route operations dynamically.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await client.path('/items').get();

        expect(httpClient.requests).to.have.length(1);
        expect(httpClient.requests[0].url).to.equal('https://example.test/items');
        expect(httpClient.requests[0].headers.get('user-agent')).to.contain('test-publisher.test-extension/0.0.0-test');
    });

    it('should acquire a token for the configured scope', async () => {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const getToken = mock.fn((_scopes: string | string[]) => Promise.resolve({
            token: 'data-plane-token',
            expiresOnTimestamp: Date.now() + 3600000,
        }));
        const credential: TokenCredential = { getToken };
        const httpClient = new MockHttpClient({
            handler: request => makeResponse(request),
        });
        const client = createDataPlaneRestClient(ctx, executor, {
            name: 'example-service',
            endpoint: 'https://example.test',
            credential,
            scopes: ['https://example.test/.default'],
        }, { httpClient });

        // The untyped core REST client exposes route operations dynamically.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await client.path('/items').get();

        expect(getToken.mock.callCount()).to.equal(1);
        expect(getToken.mock.calls[0].arguments[0]).to.deep.equal(['https://example.test/.default']);
        expect(httpClient.requests[0].headers.get('authorization')).to.equal('Bearer data-plane-token');
    });
});
