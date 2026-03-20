/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HttpClient, PipelineRequest, PipelineResponse } from '@azure/core-rest-pipeline';
import { createHttpHeaders } from '@azure/core-rest-pipeline'; // eslint-disable-line @typescript-eslint/no-restricted-imports -- Test utility

/**
 * Creates a mock {@link PipelineRequest} with sensible defaults.
 * Headers are backed by SDK's real {@link createHttpHeaders}.
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
        abortSignal: undefined as never,
        ...overrides,
    } as PipelineRequest;
}

/**
 * Creates a mock {@link PipelineResponse} for a given request.
 */
export function makeResponse(request: PipelineRequest, status?: number, bodyAsText?: string | null, headers?: Record<string, string>): PipelineResponse {
    return {
        request,
        status: status ?? 200,
        headers: createHttpHeaders(headers),
        bodyAsText: bodyAsText ?? null,
    } as PipelineResponse;
}

export interface MockHttpClientOptions {
    /** Handler called for each request. Return a response or throw. */
    handler: (request: PipelineRequest) => PipelineResponse | Promise<PipelineResponse>;
}

/**
 * An {@link HttpClient} that delegates to a test-provided handler
 * instead of making real network calls.
 */
export class MockHttpClient implements HttpClient {
    public readonly requests: PipelineRequest[] = [];

    constructor(private readonly options: MockHttpClientOptions) { }

    public sendRequest(request: PipelineRequest): Promise<PipelineResponse> {
        this.requests.push(request);
        return Promise.resolve(this.options.handler(request));
    }
}
