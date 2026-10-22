/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken } from '@azure/core-auth';
import { bearerTokenAuthenticationPolicy, createEmptyPipeline, type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzurePublicCloud, AzureUSGovernment, type EnvironmentLike } from '../../../src/auth/Environment';
import type { TenantChallengeCredential } from '../../../src/auth/VsCodeExtensionCredential';
import { parseBearerChallenge, TenantChallengePolicy } from '../../../src/rest/pipeline/TenantChallengePolicy';
import { makeRequest, makeResponse, MockHttpClient } from '../../mockPipeline';

const homeTenant = '11111111-1111-1111-1111-111111111111';
const otherTenant = '22222222-2222-2222-2222-222222222222';
const subscriptionId = '33333333-3333-3333-3333-333333333333';
const armUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourcegroups?api-version=2021-04-01`;

function makeJwt(claims: Record<string, unknown>): string {
    return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function wrongIssuerChallenge(tenantId = otherTenant, host = 'login.windows.net'): Record<string, string> {
    return {
        'WWW-Authenticate': `Bearer authorization_uri="https://${host}/${tenantId}", error="invalid_token", error_description="The primary access token is from the wrong issuer."`,
    };
}

interface Harness {
    readonly credential: TenantChallengeCredential;
    readonly silentToken: ReturnType<typeof mock.fn<TenantChallengeCredential['getTokenSilentlyForTenant']>>;
    readonly reportTenantDiscovered: ReturnType<typeof mock.fn<TenantChallengeCredential['reportTenantDiscovered']>>;
    readonly http: MockHttpClient;
    send(request?: PipelineRequest): Promise<PipelineResponse>;
}

/**
 * Runs a request through a real pipeline -- the SDK's bearer policy followed by
 * {@linkcode TenantChallengePolicy} -- against a fake service that accepts only
 * the token minted for `otherTenant`.
 */
function createHarness(options?: {
    readonly silentToken?: AccessToken | null | Error;
    readonly environment?: EnvironmentLike;
    readonly credentialTenant?: string;
    readonly challenge?: Record<string, string>;
    readonly serviceStatus?: (request: PipelineRequest) => number;
}): Harness {
    const homeToken = makeJwt({ tid: homeTenant });
    const otherToken = makeJwt({ tid: otherTenant });

    const silentToken = mock.fn<TenantChallengeCredential['getTokenSilentlyForTenant']>(() => {
        const result = options?.silentToken === undefined ? { token: otherToken, expiresOnTimestamp: Date.now() + 3600000 } : options.silentToken;
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    });
    const reportTenantDiscovered = mock.fn<TenantChallengeCredential['reportTenantDiscovered']>();
    const credential: TenantChallengeCredential = {
        tenantId: options?.credentialTenant,
        getToken: () => Promise.resolve({ token: homeToken, expiresOnTimestamp: Date.now() + 3600000 }),
        getTokenSilentlyForTenant: silentToken,
        reportTenantDiscovered,
    };

    const http = new MockHttpClient({
        handler: request => {
            const status = options?.serviceStatus?.(request)
                ?? (request.headers.get('Authorization') === `Bearer ${otherToken}` ? 200 : 401);
            return makeResponse(request, status, null, status === 401 ? (options?.challenge ?? wrongIssuerChallenge()) : undefined);
        },
    });

    const { executor } = createTestActionExecutor();
    const pipeline = createEmptyPipeline();
    pipeline.addPolicy(bearerTokenAuthenticationPolicy({ credential, scopes: [AzurePublicCloud.resourceManagerDefaultScope] }));
    pipeline.addPolicy(new TenantChallengePolicy({
        credential,
        environment: options?.environment ?? AzurePublicCloud,
        scopes: [AzurePublicCloud.resourceManagerDefaultScope],
        output: executor.output,
    }), { afterPhase: 'Retry' });

    return {
        credential,
        silentToken,
        reportTenantDiscovered,
        http,
        send: request => pipeline.sendRequest(http, request ?? makeRequest({ url: armUrl })),
    };
}

describe('TenantChallengePolicy (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('should retry once with a silently acquired token for the tenant the service named', async () => {
        const harness = createHarness();

        const response = await harness.send();

        expect(response.status).to.equal(200);
        expect(harness.http.requests).to.have.length(2);
        expect(harness.silentToken.mock.calls[0].arguments.slice(0, 2)).to.deep.equal([[AzurePublicCloud.resourceManagerDefaultScope], otherTenant]);
    });

    it('should report the discovered tenant and subscription only once the retry succeeds', async () => {
        const harness = createHarness();

        await harness.send();

        expect(harness.reportTenantDiscovered.mock.callCount()).to.equal(1);
        expect(harness.reportTenantDiscovered.mock.calls[0].arguments[0]).to.deep.equal({ tenantId: otherTenant, subscriptionId });
    });

    it('should omit the subscription when the request path does not name one', async () => {
        const harness = createHarness();

        await harness.send(makeRequest({ url: 'https://management.azure.com/tenants?api-version=2022-12-01' }));

        expect(harness.reportTenantDiscovered.mock.calls[0].arguments[0]).to.deep.equal({ tenantId: otherTenant, subscriptionId: undefined });
    });

    it('should retry at most once and return the second 401', async () => {
        const harness = createHarness({ serviceStatus: () => 401 });

        const response = await harness.send();

        expect(response.status).to.equal(401);
        expect(harness.http.requests).to.have.length(2);
        expect(harness.silentToken.mock.callCount()).to.equal(1);
        expect(harness.reportTenantDiscovered.mock.callCount()).to.equal(0);
    });

    it('should not retry a successful response', async () => {
        const harness = createHarness({ serviceStatus: () => 200 });

        await harness.send();

        expect(harness.http.requests).to.have.length(1);
        expect(harness.silentToken.mock.callCount()).to.equal(0);
    });

    it('should return the original 401 when no session can supply a token silently', async () => {
        const harness = createHarness({ silentToken: null });

        const response = await harness.send();

        expect(response.status).to.equal(401);
        expect(harness.http.requests).to.have.length(1);
    });

    it('should return the original 401 when silent acquisition throws', async () => {
        const harness = createHarness({ silentToken: new Error('boom') });

        const response = await harness.send();

        expect(response.status).to.equal(401);
        expect(harness.http.requests).to.have.length(1);
    });

    const untrusted: [string, Record<string, string>][] = [
        ['an authority on a host outside the cloud', wrongIssuerChallenge(otherTenant, 'login.evil.example')],
        ['an authority that is not a GUID tenant', wrongIssuerChallenge('contoso.onmicrosoft.com')],
        ['an authority over http', { 'WWW-Authenticate': `Bearer authorization_uri="http://login.windows.net/${otherTenant}", error="invalid_token"` }],
        ['a different error', { 'WWW-Authenticate': `Bearer authorization_uri="https://login.windows.net/${otherTenant}", error="insufficient_scope"` }],
        ['a claims challenge', { 'WWW-Authenticate': `Bearer authorization_uri="https://login.windows.net/${otherTenant}", error="invalid_token", claims="e30="` }],
        ['no authority', { 'WWW-Authenticate': 'Bearer error="invalid_token"' }],
        ['a non-bearer scheme', { 'WWW-Authenticate': `Basic realm="x"` }],
    ];
    for (const [description, challenge] of untrusted) {
        it(`should not retry for ${description}`, async () => {
            const harness = createHarness({ challenge });

            const response = await harness.send();

            expect(response.status).to.equal(401);
            expect(harness.silentToken.mock.callCount()).to.equal(0);
            expect(harness.http.requests).to.have.length(1);
        });
    }

    it('should not retry when the named tenant is the one already tried', async () => {
        const harness = createHarness({ challenge: wrongIssuerChallenge(homeTenant) });

        const response = await harness.send();

        expect(response.status).to.equal(401);
        expect(harness.silentToken.mock.callCount()).to.equal(0);
    });

    it('should not retry a request whose body cannot be replayed', async () => {
        const harness = createHarness();
        const request = makeRequest({ url: armUrl, method: 'PUT', body: new ReadableStream() });

        const response = await harness.send(request);

        expect(response.status).to.equal(401);
        expect(harness.silentToken.mock.callCount()).to.equal(0);
    });

    it('should retry a request with a replayable body', async () => {
        const harness = createHarness();

        const response = await harness.send(makeRequest({ url: armUrl, method: 'PUT', body: '{"a":1}' }));

        expect(response.status).to.equal(200);
        expect(harness.http.requests[1].body).to.equal('{"a":1}');
    });

    it('should accept the login hosts of the configured cloud', async () => {
        const harness = createHarness({
            environment: AzureUSGovernment,
            challenge: wrongIssuerChallenge(otherTenant, 'login.microsoftonline.us'),
        });

        const response = await harness.send();

        expect(response.status).to.equal(200);
    });

    it('should reject the login host of another cloud', async () => {
        const harness = createHarness({
            environment: AzureUSGovernment,
            challenge: wrongIssuerChallenge(otherTenant, 'login.windows.net'),
        });

        const response = await harness.send();

        expect(response.status).to.equal(401);
        expect(harness.silentToken.mock.callCount()).to.equal(0);
    });
});

describe('parseBearerChallenge (unit)', () => {
    it('should read the parameters of a bearer challenge', () => {
        const challenge = parseBearerChallenge('Bearer authorization_uri="https://login.windows.net/t", error="invalid_token", claims="abc"');

        expect(challenge).to.deep.equal({ authorizationUri: 'https://login.windows.net/t', error: 'invalid_token', claims: 'abc' });
    });

    it('should find the bearer challenge among several', () => {
        const challenge = parseBearerChallenge('Basic realm="x", Bearer error="invalid_token"');

        expect(challenge?.error).to.equal('invalid_token');
    });

    it('should return undefined without a bearer challenge', () => {
        expect(parseBearerChallenge(undefined)).to.be.undefined;
        expect(parseBearerChallenge('Basic realm="x"')).to.be.undefined;
    });
});
