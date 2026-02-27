/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/core-auth';
import { Environment } from '@azure/ms-rest-azure-env';
import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

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
}

const PublicProviderId = 'microsoft' as const;
const SovereignProviderId = 'microsoft-sovereign-cloud' as const;
const DefaultEnvironment = Environment.AzureCloud;

export class VsCodeExtensionCredential implements TokenCredential {
    public constructor(private readonly options: VsCodeExtensionCredentialOptions) { }

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

        const session = await this.options.authentication.getSession(provider, scopesArray, this.options);

        if (!session) {
            return null;
        } else {
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
