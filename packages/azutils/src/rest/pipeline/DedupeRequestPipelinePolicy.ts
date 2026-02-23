/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import { InflightMap } from '@microsoft/vscode-azure-utils';

/**
 * A pipeline policy that deduplicates identical in-flight GET requests.
 * If multiple callers issue GET requests to the same URL concurrently,
 * only one HTTP request is made and the response is shared across all callers.
 *
 * Non-GET requests are never deduplicated. Non-text responses (i.e. streams) are
 * also not deduplicated, since they cannot be easily shared across callers.
 *
 * Note that this does not dedupe requests on behalf of different accounts,
 * because they will necessarily have different REST clients, and thus different
 * instances of this policy.
 */
export class DedupeRequestPipelinePolicy implements PipelinePolicy {
    private readonly inflight = new InflightMap<PipelineResponse>();

    public readonly name = 'DedupeRequestPipelinePolicy';

    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        // Skip dedup for non-GET requests (mutations must always execute) and for
        // streamed responses. `streamResponseStatusCodes` is the Azure SDK's pre-flight
        // signal indicating the caller expects a stream body (e.g. blob downloads).
        // When this property is absent/empty, the SDK will populate `bodyAsText`
        // (i.e. JSON), which is safe to share.
        if (request.method !== 'GET' || request.streamResponseStatusCodes?.size) {
            return next(request);
        }

        const response = await this.inflight.getOrRun(request.url, () => next(request));

        // If this caller piggybacked on another request, clone the response
        // so each caller gets its own response object with the correct request ref
        return response.request === request ? response : cloneResponse(request, response);
    }
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
