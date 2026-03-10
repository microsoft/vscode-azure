/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IActionContext } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

const wwwAuthenticateHeaderName = 'WWW-Authenticate';
const challengeRetryHeaderName = 'x-azext-challenge-retry';
const authorizationHeaderName = 'Authorization';

export class MFAChallengePolicy implements PipelinePolicy {
    public readonly name = 'MFAChallengePolicy';

    public constructor(
        private readonly context: IActionContext,
        private readonly getNewToken: (request: vscode.AuthenticationWwwAuthenticateRequest) => Promise<vscode.AuthenticationSession | undefined>,
    ) { }

    // TODO: could we instead use the builtin `bearerTokenAuthenticationPolicy` and just provide a custom `getToken` callback that handles MFA challenges?
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const initialResponse = await next(request);

        if (initialResponse.status === 401 &&
            initialResponse.headers.has(wwwAuthenticateHeaderName) &&
            !initialResponse.headers.has(challengeRetryHeaderName)) {

            this.context.telemetry.properties.challenge = 'true';
            request.headers.set(challengeRetryHeaderName, 'true'); // Prevent infinite challenge loop

            const newSession = await this.getNewToken({
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                wwwAuthenticate: initialResponse.headers.get(wwwAuthenticateHeaderName)!,
                // TODO: set fallback scopes?
            });

            if (newSession) {
                this.context.telemetry.properties.challengeSuccess = 'true';
                request.headers.set(authorizationHeaderName, `Bearer ${newSession.accessToken}`);
                return next(request);
            } else {
                this.context.telemetry.properties.challengeSuccess = 'false';
            }
        }

        return initialResponse;
    }
}
