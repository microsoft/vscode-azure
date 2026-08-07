/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import { InflightMap } from '@microsoft/vscode-azure-utils';
import { createHash } from 'node:crypto';

const inflight = new InflightMap<PipelineResponse>();
const objectPartitions = new WeakMap<object, string>();
let nextObjectPartition = 0;

const responseAffectingHeaderNames = [
    'accept',
    'accept-encoding',
    'accept-language',
    'if-match',
    'if-modified-since',
    'if-none-match',
    'if-unmodified-since',
    'prefer',
    'range',
    'x-ms-version',
];

/**
 * Stable request identity used to prevent responses from being shared across
 * Azure principals or tenants.
 */
export interface DedupeRequestIdentity {
    readonly accountId: string;
    readonly tenantId?: string;
}

/**
 * A pipeline policy that deduplicates identical in-flight GET requests.
 * If multiple callers issue GET requests to the same URL concurrently,
 * only one HTTP request is made and the response is shared across all callers.
 *
 * Non-GET requests are never deduplicated. Non-text responses (i.e. streams) are
 * also not deduplicated, since they cannot be easily shared across callers.
 *
 * Policy instances share transient in-flight state, allowing independently
 * created clients in the same opaque identity partition to deduplicate requests.
 * Only headers that can affect the returned representation participate in request
 * equivalence; authentication and observability headers do not.
 */
export class DedupeRequestPolicy implements PipelinePolicy {
    public readonly name = 'DedupeRequestPolicy';
    private readonly partition: string;

    /**
     * @param identity - A stable Azure identity for cross-client deduplication,
     * or an object whose identity limits deduplication to clients sharing that
     * object. Omit only for anonymous requests.
     */
    public constructor(identity?: DedupeRequestIdentity | object) {
        this.partition = createPartition(identity);
    }

    /** @inheritdoc */
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        // Mutations must always execute, and streamed responses cannot be shared.
        // An abortable transport is also caller-owned: sharing it would couple
        // the owner's cancellation to every piggybacked caller.
        if (request.method !== 'GET'
            || request.streamResponseStatusCodes?.size
            || request.abortSignal) {
            return next(request);
        }

        const response = await inflight.getOrRun(this.createRequestKey(request), () => next(request));

        // If this caller piggybacked on another request, clone the response
        // so each caller gets its own response object with the correct request ref
        return response.request === request ? response : cloneResponse(request, response);
    }

    private createRequestKey(request: PipelineRequest): string {
        const headers = responseAffectingHeaderNames
            .map(name => [name, request.headers.get(name)] as const)
            .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);

        return JSON.stringify([this.partition, request.url, headers]);
    }
}

function createPartition(identity: DedupeRequestIdentity | object | undefined): string {
    if (!identity) {
        return 'anonymous';
    }

    if ('accountId' in identity && typeof identity.accountId === 'string') {
        const stableIdentity = JSON.stringify([
            identity.accountId.toLowerCase(),
            typeof identity.tenantId === 'string' ? identity.tenantId.toLowerCase() : undefined,
        ]);
        return createHash('sha256').update(stableIdentity).digest('base64url');
    }

    let partition = objectPartitions.get(identity);
    if (!partition) {
        partition = `object-${++nextObjectPartition}`;
        objectPartitions.set(identity, partition);
    }
    return partition;
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
