/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';

const acceptLanguageHeaderName = 'accept-language';

export class AcceptLanguagePolicy implements PipelinePolicy {
    public readonly name = 'AcceptLanguagePolicy';

    public constructor(private readonly acceptLanguage: string) {}

    public sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        request.headers.set(acceptLanguageHeaderName, this.acceptLanguage);
        return next(request);
    }
}
