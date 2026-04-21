/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HttpClient, PipelineRequest, PipelineResponse } from '@azure/core-rest-pipeline';
import { createHttpHeaders } from '@azure/core-rest-pipeline'; // eslint-disable-line @typescript-eslint/no-restricted-imports -- Test utility

/**
 * Creates a mock {@linkcode PipelineRequest} with sensible defaults.
 * Headers are backed by SDK's real {@linkcode createHttpHeaders}.
 */
export function makeRequest(overrides?: Partial<PipelineRequest>): PipelineRequest {
    return {
        url: 'https://management.azure.com/subscriptions',
        method: 'GET',
        headers: createHttpHeaders(),
        body: undefined,
        timeout: 0,
        withCredentials: false,
        requestId: '1',
        abortSignal: undefined,
        ...overrides,
    };
}

/**
 * Creates a mock {@linkcode PipelineResponse} for a given request.
 */
export function makeResponse(request: PipelineRequest, status?: number, bodyAsText?: string | null, headers?: Record<string, string>): PipelineResponse {
    return {
        request,
        status: status ?? 200,
        headers: createHttpHeaders(headers),
        bodyAsText: bodyAsText ?? null,
    };
}

/**
 * Options for {@linkcode MockHttpClient}.
 */
interface MockHttpClientOptions {
    /** Handler called for each request. Return a response or throw. */
    handler: (request: PipelineRequest) => PipelineResponse | Promise<PipelineResponse>;
}

/**
 * An {@linkcode HttpClient} that delegates to a test-provided handler
 * instead of making real network calls.
 *
 * Inject into an Azure SDK client wrapper via its `create({ ..., httpClient })`
 * option to run the full pipeline (policies, serialization) against
 * deterministic canned responses. All observed requests are captured on
 * {@linkcode requests} in the order they were sent.
 */
export class MockHttpClient implements HttpClient {
    /** Every request observed by {@linkcode sendRequest}, in the order received. */
    public readonly requests: PipelineRequest[] = [];

    constructor(private readonly options: MockHttpClientOptions) { }

    /**
     * Records the request and returns the result of
     * {@linkcode MockHttpClientOptions.handler}.
     */
    public sendRequest(request: PipelineRequest): Promise<PipelineResponse> {
        this.requests.push(request);
        return Promise.resolve(this.options.handler(request));
    }
}
