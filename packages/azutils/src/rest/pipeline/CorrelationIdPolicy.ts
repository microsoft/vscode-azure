/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IActionContext } from '@microsoft/vscode-azure-utils';

const correlationIdHeaderName = 'x-ms-correlation-request-id';

export class CorrelationIdPolicy implements PipelinePolicy {
    public readonly name = 'CorrelationIdPolicy';

    public constructor(private readonly context: IActionContext) {}

    public sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        request.headers.set(correlationIdHeaderName, this.context.telemetry.properties.correlationId);
        return next(request);
    }
}
