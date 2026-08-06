/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelineRequest } from '@azure/core-rest-pipeline';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { delay } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { DedupeRequestPolicy } from '../../../src/rest/pipeline/DedupeRequestPolicy';
import { makeRequest, makeResponse } from '../../mockPipeline';

describe('DedupeRequestPolicy (unit)', () => {
    it('should have the name "DedupeRequestPolicy"', () => {
        const policy = new DedupeRequestPolicy();
        expect(policy.name).to.equal('DedupeRequestPolicy');
    });

    it('should deduplicate concurrent GET requests to the same URL', async () => {
        const policy1 = new DedupeRequestPolicy();
        const policy2 = new DedupeRequestPolicy();
        let callCount = 0;

        const next = async (req: PipelineRequest) => {
            callCount++;
            // Simulate async delay
            await delay(10);
            return makeResponse(req, 200, `{"call":${callCount}}`);
        };

        const req1 = makeRequest({ requestId: 'r1' });
        const req2 = makeRequest({ requestId: 'r2' });

        const [res1, res2] = await Promise.all([
            policy1.sendRequest(req1, next),
            policy2.sendRequest(req2, next),
        ]);

        // Only one actual HTTP call should have been made
        expect(callCount).to.equal(1);

        // First caller gets the original response
        expect(res1.request).to.equal(req1);
        // Second caller gets a cloned response with its own request ref
        expect(res2.request).to.equal(req2);

        // Both responses have the same body
        expect(res1.bodyAsText).to.equal(res2.bodyAsText);
    });

    it('should not deduplicate requests authenticated with different credentials', async () => {
        const policy1 = new DedupeRequestPolicy();
        const policy2 = new DedupeRequestPolicy();
        let callCount = 0;
        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const req1 = makeRequest({ headers: createHttpHeaders({ authorization: 'Bearer account-1' }) });
        const req2 = makeRequest({ headers: createHttpHeaders({ authorization: 'Bearer account-2' }) });

        await Promise.all([policy1.sendRequest(req1, next), policy2.sendRequest(req2, next)]);

        expect(callCount).to.equal(2);
    });

    it('should not deduplicate unauthenticated requests', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;
        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        await Promise.all([
            policy.sendRequest(makeRequest({ headers: createHttpHeaders() }), next),
            policy.sendRequest(makeRequest({ headers: createHttpHeaders() }), next),
        ]);

        expect(callCount).to.equal(2);
    });

    it('should not deduplicate requests with different representation headers', async () => {
        const policy1 = new DedupeRequestPolicy();
        const policy2 = new DedupeRequestPolicy();
        let callCount = 0;
        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const req1 = makeRequest({ headers: createHttpHeaders({ authorization: 'Bearer account-1', 'accept-language': 'en' }) });
        const req2 = makeRequest({ headers: createHttpHeaders({ authorization: 'Bearer account-1', 'accept-language': 'fr' }) });

        await Promise.all([policy1.sendRequest(req1, next), policy2.sendRequest(req2, next)]);

        expect(callCount).to.equal(2);
    });

    it('should ignore request-specific observability headers', async () => {
        const policy1 = new DedupeRequestPolicy();
        const policy2 = new DedupeRequestPolicy();
        let callCount = 0;
        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const req1 = makeRequest({
            headers: createHttpHeaders({
                authorization: 'Bearer account-1',
                traceparent: 'trace-1',
                'x-ms-client-request-id': 'request-1',
                'x-ms-correlation-request-id': 'correlation-1',
            }),
        });
        const req2 = makeRequest({
            headers: createHttpHeaders({
                authorization: 'Bearer account-1',
                traceparent: 'trace-2',
                'x-ms-client-request-id': 'request-2',
                'x-ms-correlation-request-id': 'correlation-2',
            }),
        });

        await Promise.all([policy1.sendRequest(req1, next), policy2.sendRequest(req2, next)]);

        expect(callCount).to.equal(1);
    });

    it('should not deduplicate non-GET requests', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;

        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const req1 = makeRequest({ method: 'POST', requestId: 'r1' });
        const req2 = makeRequest({ method: 'POST', requestId: 'r2' });

        await Promise.all([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);

        expect(callCount).to.equal(2);
    });

    it('should not deduplicate requests with streamResponseStatusCodes', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;

        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const streamCodes = new Set([200]);
        const req1 = makeRequest({ requestId: 'r1', streamResponseStatusCodes: streamCodes });
        const req2 = makeRequest({ requestId: 'r2', streamResponseStatusCodes: streamCodes });

        await Promise.all([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);

        expect(callCount).to.equal(2);
    });

    it('should not deduplicate abortable requests', async () => {
        const policy = new DedupeRequestPolicy();
        const controller1 = new AbortController();
        const controller2 = new AbortController();
        let callCount = 0;
        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        await Promise.all([
            policy.sendRequest(makeRequest({ abortSignal: controller1.signal }), next),
            policy.sendRequest(makeRequest({ abortSignal: controller2.signal }), next),
        ]);

        expect(callCount).to.equal(2);
    });

    it('should not deduplicate sequential requests (not concurrent)', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;

        const next = (req: PipelineRequest) => {
            callCount++;
            return Promise.resolve(makeResponse(req, 200));
        };

        const req1 = makeRequest({ requestId: 'r1' });
        const req2 = makeRequest({ requestId: 'r2' });

        await policy.sendRequest(req1, next);
        await policy.sendRequest(req2, next);

        // Both complete independently since they're not concurrent
        expect(callCount).to.equal(2);
    });

    it('should not deduplicate requests to different URLs', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;

        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        const req1 = makeRequest({ url: 'https://example.com/a', requestId: 'r1' });
        const req2 = makeRequest({ url: 'https://example.com/b', requestId: 'r2' });

        await Promise.all([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);

        expect(callCount).to.equal(2);
    });

    it('should deduplicate GET requests with empty streamResponseStatusCodes', async () => {
        const policy = new DedupeRequestPolicy();
        let callCount = 0;

        const next = async (req: PipelineRequest) => {
            callCount++;
            await delay(10);
            return makeResponse(req);
        };

        // Empty set (size === 0) should still allow dedup
        const emptySet = new Set<number>();
        const req1 = makeRequest({ requestId: 'r1', streamResponseStatusCodes: emptySet });
        const req2 = makeRequest({ requestId: 'r2', streamResponseStatusCodes: emptySet });

        await Promise.all([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);

        expect(callCount).to.equal(1);
    });

    it('should clone the response for piggybacked callers with correct properties', async () => {
        const policy = new DedupeRequestPolicy();

        const next = async (req: PipelineRequest) => {
            await delay(10);
            return makeResponse(req, 200, '{"data":true}');
        };

        const req1 = makeRequest({ requestId: 'r1' });
        const req2 = makeRequest({ requestId: 'r2' });

        const [res1, res2] = await Promise.all([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);

        // Cloned response should have the correct request, status, and body
        expect(res2.request).to.equal(req2);
        expect(res2.status).to.equal(200);
        expect(res2.bodyAsText).to.equal('{"data":true}');
        expect(res2.headers).to.equal(res1.headers);
    });

    it('should remove failed requests from the in-flight map', async () => {
        const policy = new DedupeRequestPolicy();
        const req1 = makeRequest({ requestId: 'r1' });
        const req2 = makeRequest({ requestId: 'r2' });
        let callCount = 0;
        const next = async () => {
            callCount++;
            await delay(10);
            throw new Error('request failed');
        };

        const firstResults = await Promise.allSettled([
            policy.sendRequest(req1, next),
            policy.sendRequest(req2, next),
        ]);
        expect(firstResults.every(result => result.status === 'rejected')).to.be.true;
        expect(callCount).to.equal(1);

        let error: unknown;
        try {
            await policy.sendRequest(makeRequest({ requestId: 'r3' }), next);
        } catch (err) {
            error = err;
        }
        expect(error).to.be.an.instanceOf(Error).with.property('message', 'request failed');
        expect(callCount).to.equal(2);
    });
});
