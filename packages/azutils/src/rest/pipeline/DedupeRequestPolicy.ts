/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import { InflightMap } from '@microsoft/vscode-azure-utils';

const inflight = new InflightMap<PipelineResponse>();

const ignoredHeaderNames = new Set([
    'request-id',
    'traceparent',
    'tracestate',
    'x-ms-client-request-id',
    'x-ms-correlation-request-id',
    'x-ms-request-id',
]);

/**
 * A pipeline policy that deduplicates identical in-flight GET requests.
 * If multiple callers issue GET requests to the same URL concurrently,
 * only one HTTP request is made and the response is shared across all callers.
 *
 * Non-GET requests are never deduplicated. Non-text responses (i.e. streams) are
 * also not deduplicated, since they cannot be easily shared across callers.
 *
 * Policy instances share transient in-flight state, allowing independently
 * created clients to deduplicate requests. The policy must run after
 * authentication so the request's authorization header partitions requests by
 * credential. This places deduplication inside each caller's retry loop, where
 * concurrent retry attempts can also coalesce. Request-specific observability
 * headers are excluded from the key.
 */
export class DedupeRequestPolicy implements PipelinePolicy {
    public readonly name = 'DedupeRequestPolicy';

    /** @inheritdoc */
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        // Mutations must always execute, and streamed responses cannot be shared.
        // An abortable transport is also caller-owned: sharing it would couple
        // the owner's cancellation to every piggybacked caller.
        if (request.method !== 'GET'
            || request.streamResponseStatusCodes?.size
            || request.abortSignal
            || !request.headers.has('authorization')) {
            return next(request);
        }

        const response = await inflight.getOrRun(createRequestKey(request), () => next(request));

        // If this caller piggybacked on another request, clone the response
        // so each caller gets its own response object with the correct request ref
        return response.request === request ? response : cloneResponse(request, response);
    }
}

function createRequestKey(request: PipelineRequest): string {
    const headers = [...request.headers]
        .filter(([name]) => !ignoredHeaderNames.has(name.toLowerCase()))
        .map(([name, value]) => [name.toLowerCase(), value] as const)
        .sort(([left], [right]) => left.localeCompare(right));

    return JSON.stringify([request.url, headers]);
}

function cloneResponse(request: PipelineRequest, response: PipelineResponse): PipelineResponse {
    return {
        request: request, // The original request--not deduped
        status: response.status,
        headers: response.headers,
        bodyAsText: response.bodyAsText,

        // Stream bodies (`readableStreamBody`, `browserStreamBody`) are single-read
        // and cannot be easily shared across deduplicated callers. They are omitted
        // here intentionally. `blobBody` is omitted just for consistency.
    };
}
