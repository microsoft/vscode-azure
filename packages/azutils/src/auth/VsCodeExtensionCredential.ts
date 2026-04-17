/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/core-auth';
import { Environment } from '@azure/ms-rest-azure-env';
import type { IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/**
 * Options for constructing a {@linkcode VsCodeExtensionCredential}.
 */
export interface VsCodeExtensionCredentialOptions extends vscode.AuthenticationGetSessionOptions {
    /**
     * (Required) The namespace the credential will use to access VS Code APIs. Pass in
     * `vscode.authentication` for easiest use.
     */
    authentication: IVsCode['authentication'];

    /**
     * (Optional) The tenant ID to authenticate to. Defaults to the tenant of the currently signed-in account.
     */
    tenantId?: string;

    /**
     * (Optional) The Azure environment to authenticate to. Defaults to `Azure`, the public Azure cloud.
     */
    environment?: Environment;

    /** (Optional) Output channel for auth lifecycle logging. */
    output?: IOutputChannel;
}

const PublicProviderId = 'microsoft' as const;
const SovereignProviderId = 'microsoft-sovereign-cloud' as const;
const DefaultEnvironment = Environment.AzureCloud;

/**
 * A `TokenCredential` implementation that defers to the VS Code
 * `authentication` API to acquire Microsoft/Azure access tokens.
 *
 * Selects the `microsoft` auth provider for the public Azure cloud and
 * `microsoft-sovereign-cloud` for sovereign clouds based on
 * {@linkcode VsCodeExtensionCredentialOptions.environment}.
 */
export class VsCodeExtensionCredential implements TokenCredential {
    private readonly sessionCache = new Map<string, vscode.AuthenticationSession>();

    public constructor(private readonly options: VsCodeExtensionCredentialOptions) { }

    /**
     * Acquire an access token for the given scopes via the VS Code
     * authentication API. Returns `null` when no session is available.
     */
    // TODO: handle interactive challenge request (by pipeline? or errors?)
    public async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
        const scopesArray = Array.isArray(scopes) ? scopes : [scopes];

        let provider: string;
        if (!this.options.environment || this.options.environment.name === DefaultEnvironment.name) {
            provider = PublicProviderId;
        } else {
            provider = SovereignProviderId;
        }

        const tenantId = options?.tenantId || this.options.tenantId;
        if (tenantId) {
            scopesArray.push(`VSCODE_TENANT_ID:${tenantId}`); // TODO: right magic scope?
        }

        this.options.output?.debug('[auth] getToken start provider=%s tenant=%s scopes=%o', provider, tenantId ?? '<default>', scopesArray);
        const cacheKey = `${provider}|${scopesArray.join(' ')}`;
        const cachedSession = this.sessionCache.get(cacheKey);
        if (cachedSession) {
            this.options.output?.debug('[auth] session cache hit provider=%s tenant=%s', provider, tenantId ?? '<default>');
            return {
                token: cachedSession.accessToken,
                expiresOnTimestamp: 0,
                refreshAfterTimestamp: 0,
                tokenType: 'Bearer',
            };
        }

        let session: vscode.AuthenticationSession | undefined;
        try {
            session = await this.options.authentication.getSession(provider, scopesArray, this.options);
        } catch (error) {
            const firstErrorMessage = error instanceof Error ? error.message : String(error);
            this.options.output?.warn('[auth] getToken first attempt failed provider=%s tenant=%s message=%s', provider, tenantId ?? '<default>', firstErrorMessage);
            this.options.output?.warn('[auth] getToken retry provider=%s tenant=%s scopes=%o', provider, tenantId ?? '<default>', scopesArray);
            try {
                session = await this.options.authentication.getSession(provider, scopesArray, this.options);
            } catch (retryError) {
                this.options.output?.error(retryError instanceof Error ? retryError : new Error(String(retryError)));
                throw retryError;
            }
        }

        if (!session && !this.options.createIfNone) {
            this.options.output?.info('[auth] interactive sign-in provider=%s tenant=%s scopes=%o', provider, tenantId ?? '<default>', scopesArray);
            session = await this.options.authentication.getSession(provider, scopesArray, {
                ...this.options,
                createIfNone: true,
            });
        }

        if (!session) {
            return null;
        } else {
            this.sessionCache.set(cacheKey, session);
            this.options.output?.info('[auth] token acquired provider=%s scopes=%o expiresOn=%d', provider, scopesArray, 0);
            return {
                token: session.accessToken,
                expiresOnTimestamp: 0, // TODO: get from ID token
                refreshAfterTimestamp: 0, // TODO: get?
                tokenType: 'Bearer',
            };
        }
    }

    // TODO: interactive sign in method?
}
