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
            scopesArray.push(`VSCODE_TENANT:${tenantId}`);
        }

        this.options.output?.debug(`[auth] getToken start provider=${provider} tenant=${tenantId ?? '<default>'} scopes=${JSON.stringify(scopesArray)}`);
        // We have to build a new options object or else VSCode throws about not having access to the "DevDeviceId" proposed API
        const sessionOptions: vscode.AuthenticationGetSessionOptions = {
            silent: this.options.silent,
            createIfNone: this.options.createIfNone,
            clearSessionPreference: this.options.clearSessionPreference,
            forceNewSession: this.options.forceNewSession,
        };
        const session = await this.options.authentication.getSession(provider, scopesArray, sessionOptions);

        if (!session) {
            return null;
        } else {
            const { expiresOnTimestamp, refreshAfterTimestamp } = getTokenExpiry(session.idToken);

            const scopes = JSON.stringify(scopesArray);
            const msg = this.options.code?.l10n.t('[auth] token acquired provider={0} scopes={1} expiresOn={2}', provider, scopes, expiresOnTimestamp)
                ?? `[auth] token acquired provider=${provider} scopes=${scopes} expiresOn=${expiresOnTimestamp}`;
            this.options.output?.info(msg);

            return {
                token: session.accessToken,
                expiresOnTimestamp,
                refreshAfterTimestamp,
                tokenType: 'Bearer',
            };
        }
    }

    // TODO: future: interactive sign in method?
}

/**
 * Best-effort extraction of `exp` from a JWT ID token. Returns `expiresOnTimestamp`
 * in milliseconds and `refreshAfterTimestamp` at 2/3 of the remaining lifetime.
 * Falls back to `0` for both if the token is missing or unparseable.
 */
function getTokenExpiry(idToken: string | undefined): { expiresOnTimestamp: number; refreshAfterTimestamp: number } {
    if (!idToken) {
        return { expiresOnTimestamp: 0, refreshAfterTimestamp: 0 };
    }

    try {
        const parts = idToken.split('.');
        if (parts.length < 2 || !parts[1]) {
            return { expiresOnTimestamp: 0, refreshAfterTimestamp: 0 };
        }

        // JWT payloads use base64url encoding; Node's Buffer handles this natively
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload: { exp?: number } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (typeof payload.exp !== 'number') {
            return { expiresOnTimestamp: 0, refreshAfterTimestamp: 0 };
        }

        const expiresOnTimestamp = payload.exp * 1000;
        const now = Date.now();
        const remaining = expiresOnTimestamp - now;
        const refreshAfterTimestamp = remaining > 0 ? now + Math.floor(remaining * 2 / 3) : expiresOnTimestamp;

        return { expiresOnTimestamp, refreshAfterTimestamp };
    } catch {
        return { expiresOnTimestamp: 0, refreshAfterTimestamp: 0 };
    }
}
