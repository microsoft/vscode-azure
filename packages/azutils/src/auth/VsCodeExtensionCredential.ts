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

    /** (Optional) The VS Code namespace, used for localizing log messages. */
    code?: IVsCode;
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

        this.options.output?.debug(`[auth] getToken start provider=${provider} tenant=${tenantId ?? '<default>'} scopes=${JSON.stringify(scopesArray)}`);
        const session = await this.options.authentication.getSession(provider, scopesArray, this.options);

        if (!session) {
            return null;
        } else {
            const scopes = JSON.stringify(scopesArray);
            const msg = this.options.code?.l10n.t('[auth] token acquired provider={0} scopes={1} expiresOn=0', provider, scopes) // TODO: expiresOn
                ?? `[auth] token acquired provider=${provider} scopes=${scopes} expiresOn=0`; // TODO: expiresOn
            this.options.output?.info(msg);

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
