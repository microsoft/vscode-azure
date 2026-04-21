/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';

const acceptLanguageHeaderName = 'accept-language';

/**
 * Pipeline policy that sets the `accept-language` header on every
 * outgoing request so ARM responses are localized to the user's UI
 * language (typically `vscode.env.language`).
 */
export class AcceptLanguagePolicy implements PipelinePolicy {
    public readonly name = 'AcceptLanguagePolicy';

    /**
     * @param acceptLanguage - The value to set for the `accept-language`
     *   header, e.g. `'en-us'`.
     */
    public constructor(private readonly acceptLanguage: string) {}

    /** @inheritdoc */
    public sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        request.headers.set(acceptLanguageHeaderName, this.acceptLanguage);
        return next(request);
    }
}
