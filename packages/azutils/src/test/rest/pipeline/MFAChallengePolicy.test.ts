/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelineRequest } from '@azure/core-rest-pipeline';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { MFAChallengePolicy } from '../../../rest/pipeline/MFAChallengePolicy';
import { makeRequest, makeResponse } from '../../mockPipeline';

describe('MFAChallengePolicy (unit)', () => {
    it('should have the name "MFAChallengePolicy"', () => {
        const { executor } = createTestActionExecutor();
        const policy = new MFAChallengePolicy(executor, () => Promise.resolve(undefined));
        expect(policy.name).to.equal('MFAChallengePolicy');
    });

    it('should pass through non-401 responses without challenge', async () => {
        const { executor } = createTestActionExecutor();
        const policy = new MFAChallengePolicy(executor, () => Promise.resolve(undefined));
        const request = makeRequest();
        const response = makeResponse(request, 200);

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result).to.equal(response);
        expect(result.status).to.equal(200);
    });

    it('should pass through 401 without WWW-Authenticate header', async () => {
        const { executor } = createTestActionExecutor();
        const policy = new MFAChallengePolicy(executor, () => Promise.resolve(undefined));
        const request = makeRequest();
        const response = makeResponse(request, 401);

        const result = await policy.sendRequest(request, () => Promise.resolve(response));

        expect(result).to.equal(response);
        expect(result.status).to.equal(401);
    });

    it('should retry with new token on 401 + WWW-Authenticate when getNewToken succeeds', async () => {
        const { executor } = createTestActionExecutor();
        let retryCalled = false;

        const getNewToken = () => Promise.resolve({
            accessToken: 'new-token',
            id: 'session1',
            account: { id: 'acc', label: 'Acc' },
            scopes: [],
        });

        const policy = new MFAChallengePolicy(executor, getNewToken);

        await executor.callWithTelemetryAndErrorHandling('test', async (ctx) => {
            const request = makeRequest();
            const next = (req: PipelineRequest) => {
                if (!retryCalled) {
                    retryCalled = true;
                    return Promise.resolve(makeResponse(req, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' }));
                }
                return Promise.resolve(makeResponse(req, 200));
            };

            const result = await policy.sendRequest(request, next);

            expect(result.status).to.equal(200);
            expect(request.headers.get('authorization')).to.equal('Bearer new-token');
            expect(ctx.telemetry.properties.challenge).to.equal('true');
            expect(ctx.telemetry.properties.challengeSuccess).to.equal('true');
        });
    });

    it('should return the 401 response when getNewToken returns undefined', async () => {
        const { executor } = createTestActionExecutor();
        const policy = new MFAChallengePolicy(executor, () => Promise.resolve(undefined));

        await executor.callWithTelemetryAndErrorHandling('test', async (ctx) => {
            const request = makeRequest();
            const challengeResponse = makeResponse(request, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' });

            const result = await policy.sendRequest(request, () => Promise.resolve(challengeResponse));

            expect(result.status).to.equal(401);
            expect(ctx.telemetry.properties.challenge).to.equal('true');
            expect(ctx.telemetry.properties.challengeSuccess).to.equal('false');
        });
    });

    it('should not retry the same request more than once (prevent infinite loop)', async () => {
        const { executor } = createTestActionExecutor();
        let callCount = 0;

        const getNewToken = () => Promise.resolve({
            accessToken: 'new-token',
            id: 'session1',
            account: { id: 'acc', label: 'Acc' },
            scopes: [],
        });

        const policy = new MFAChallengePolicy(executor, getNewToken);

        await executor.callWithTelemetryAndErrorHandling('test', async () => {
            const request = makeRequest();
            const next = (req: PipelineRequest) => {
                callCount++;
                return Promise.resolve(makeResponse(req, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' }));
            };

            const result = await policy.sendRequest(request, next);

            expect(callCount).to.equal(2);
            expect(result.status).to.equal(401);
        });
    });

    it('should work without a current context (no telemetry)', async () => {
        const { executor } = createTestActionExecutor();
        const policy = new MFAChallengePolicy(
            executor,
            () => Promise.resolve({
                accessToken: 'new-token',
                id: 'session1',
                account: { id: 'acc', label: 'Acc' },
                scopes: [],
            }),
        );
        const request = makeRequest();
        let retryCalled = false;

        const next = (req: PipelineRequest) => {
            if (!retryCalled) {
                retryCalled = true;
                return Promise.resolve(makeResponse(req, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' }));
            }
            return Promise.resolve(makeResponse(req, 200));
        };

        const result = await policy.sendRequest(request, next);
        expect(result.status).to.equal(200);
    });

    it('should pass fallback scopes derived from endpoint to getNewToken', async () => {
        const { executor } = createTestActionExecutor();
        let capturedRequest: { wwwAuthenticate: string; fallbackScopes?: readonly string[] } | undefined;

        const getNewToken = (request: { wwwAuthenticate: string; fallbackScopes?: readonly string[] }) => {
            capturedRequest = request;
            return Promise.resolve(undefined);
        };

        const policy = new MFAChallengePolicy(executor, getNewToken, 'https://management.azure.com');
        const request = makeRequest();
        const response = makeResponse(request, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' });

        await policy.sendRequest(request, () => Promise.resolve(response));

        expect(capturedRequest).to.not.be.undefined;
        expect(capturedRequest!.fallbackScopes).to.deep.equal(['https://management.azure.com/.default']);
    });

    it('should strip trailing slashes from endpoint before deriving fallback scopes', async () => {
        const { executor } = createTestActionExecutor();
        let capturedRequest: { wwwAuthenticate: string; fallbackScopes?: readonly string[] } | undefined;

        const getNewToken = (request: { wwwAuthenticate: string; fallbackScopes?: readonly string[] }) => {
            capturedRequest = request;
            return Promise.resolve(undefined);
        };

        const policy = new MFAChallengePolicy(executor, getNewToken, 'https://management.azure.com///');
        const request = makeRequest();
        const response = makeResponse(request, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' });

        await policy.sendRequest(request, () => Promise.resolve(response));

        expect(capturedRequest!.fallbackScopes).to.deep.equal(['https://management.azure.com/.default']);
    });

    it('should use default ARM endpoint for fallback scopes when no endpoint is provided', async () => {
        const { executor } = createTestActionExecutor();
        let capturedRequest: { wwwAuthenticate: string; fallbackScopes?: readonly string[] } | undefined;

        const getNewToken = (request: { wwwAuthenticate: string; fallbackScopes?: readonly string[] }) => {
            capturedRequest = request;
            return Promise.resolve(undefined);
        };

        const policy = new MFAChallengePolicy(executor, getNewToken);
        const request = makeRequest();
        const response = makeResponse(request, 401, '{}', { 'WWW-Authenticate': 'Bearer claims="..."' });

        await policy.sendRequest(request, () => Promise.resolve(response));

        expect(capturedRequest!.fallbackScopes).to.deep.equal(['https://management.azure.com/.default']);
    });
});
