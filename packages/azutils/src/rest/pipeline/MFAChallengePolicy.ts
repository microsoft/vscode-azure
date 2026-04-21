/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IActionExecutor, IOutputChannel } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

const wwwAuthenticateHeaderName = 'WWW-Authenticate';
const authorizationHeaderName = 'Authorization';
const retriedRequests = new WeakSet<PipelineRequest>();

/**
 * Pipeline policy that handles MFA (step-up authentication) challenges.
 *
 * When a request returns `401` with a `WWW-Authenticate` header, this
 * policy invokes the `getNewToken` callback to request a fresh token
 * that satisfies the challenge, then retries the request exactly once.
 * Records `challenge` and `challengeSuccess` telemetry properties on
 * the current {@linkcode IActionExecutor.currentContext} when available.
 */
export class MFAChallengePolicy implements PipelinePolicy {
    public readonly name = 'MFAChallengePolicy';

    /**
     * @param executor - Used to look up the current action context for
     *   telemetry tagging.
     * @param getNewToken - Callback invoked with the
     *   `WWW-Authenticate` header contents to obtain a stepped-up
     *   session. Returning `undefined` means the challenge could not
     *   be satisfied and the original 401 response is returned.
     * @param endpoint - The Azure resource endpoint (e.g.
     *   `https://management.azure.com`). Used to derive fallback
     *   scopes for the MFA challenge.
     * @param output - Optional output channel for debug logging.
     */
    public constructor(
        private readonly executor: IActionExecutor,
        private readonly getNewToken: (request: vscode.AuthenticationWwwAuthenticateRequest) => Promise<vscode.AuthenticationSession | undefined>,
        private readonly endpoint?: string,
        private readonly output?: IOutputChannel,
    ) { }

    // TODO: future: could we instead use the builtin `bearerTokenAuthenticationPolicy` and just provide a custom `getToken` callback that handles MFA challenges?
    /** @inheritdoc */
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const context = this.executor.currentContext;
        const initialResponse = await next(request);

        if (initialResponse.status === 401 &&
            initialResponse.headers.has(wwwAuthenticateHeaderName) &&
            !retriedRequests.has(request)) {
            this.output?.debug('[rest] MFA challenge start');

            if (context) {
                context.telemetry.properties.challenge = 'true';
            }

            retriedRequests.add(request); // Prevent infinite challenge loop

            const fallbackScope = `${(this.endpoint ?? 'https://management.azure.com').replace(/\/+$/, '')}/.default`;

            const newSession = await this.getNewToken({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                wwwAuthenticate: initialResponse.headers.get(wwwAuthenticateHeaderName)!,
                fallbackScopes: [fallbackScope],
            });

            if (newSession) {
                if (context) {
                    context.telemetry.properties.challengeSuccess = 'true';
                }
                request.headers.set(authorizationHeaderName, `Bearer ${newSession.accessToken}`);
                this.output?.debug('[rest] MFA challenge complete');
                return next(request);
            } else if (context) {
                context.telemetry.properties.challengeSuccess = 'false';
            }
            this.output?.debug('[rest] MFA challenge aborted');
        }

        return initialResponse;
    }
}
