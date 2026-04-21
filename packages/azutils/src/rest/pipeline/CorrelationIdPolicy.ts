/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IActionExecutor, IOutputChannel } from '@microsoft/vscode-azure-utils';

const correlationIdHeaderName = 'x-ms-correlation-request-id';

/**
 * Pipeline policy that stamps every outgoing request with the
 * `x-ms-correlation-request-id` header drawn from the ambient
 * {@linkcode IActionExecutor.currentContext}'s
 * `telemetry.properties['x-ms-correlation-request-id']`.
 *
 * This links ARM requests back to the VS Code command or tree
 * operation that initiated them. The current context is established
 * by whichever scope wraps the call (command execution, provider
 * call, etc.) via `AsyncLocalStorage`, so no explicit plumbing is
 * required.
 */
export class CorrelationIdPolicy implements PipelinePolicy {
    public readonly name = 'CorrelationIdPolicy';

    public constructor(
        private readonly executor: IActionExecutor,
        private readonly output?: IOutputChannel,
    ) { }

    /** @inheritdoc */
    public sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const context = this.executor.currentContext;
        if (context) {
            const correlationId = context.telemetry.properties['x-ms-correlation-request-id'];
            request.headers.set(correlationIdHeaderName, correlationId);
            this.output?.trace(`[rest] attached correlation id=${correlationId}`);
        }
        return next(request);
    }
}
