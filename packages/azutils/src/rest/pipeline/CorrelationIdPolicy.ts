/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IActionExecutor } from '@microsoft/vscode-azure-utils';

const correlationIdHeaderName = 'x-ms-correlation-request-id';

export class CorrelationIdPolicy implements PipelinePolicy {
    public readonly name = 'CorrelationIdPolicy';

    public constructor(private readonly executor: IActionExecutor) {}

    public sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const context = this.executor.currentContext;
        if (context) {
            request.headers.set(correlationIdHeaderName, context.telemetry.properties.correlationId);
        }
        return next(request);
    }
}
