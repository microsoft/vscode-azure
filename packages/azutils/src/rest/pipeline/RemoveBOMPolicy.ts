/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';

/**
 * Pipeline policy that strips a leading UTF-8 BOM (`U+FEFF`) from
 * `response.bodyAsText`, which some Azure endpoints include and which
 * breaks JSON parsers.
 */
export class RemoveBOMPolicy implements PipelinePolicy {
    public readonly name = 'RemoveBOMPolicy';

    /** @inheritdoc */
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const response = await next(request);
        if (response.bodyAsText?.charCodeAt(0) === 0xFEFF) {
            response.bodyAsText = response.bodyAsText.slice(1);
        }
        return response;
    }
}
