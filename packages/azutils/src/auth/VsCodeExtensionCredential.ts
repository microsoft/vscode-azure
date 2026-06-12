/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/core-auth';
import type { IOutputChannel, IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';
import { getAuthProviderId, getConfiguredAzureEnv, type EnvironmentLike } from './Environment';

/**
 * Options for constructing a {@linkcode VsCodeExtensionCredential}.
 */
export interface VsCodeExtensionCredentialOptions {
    /**
     * (Required) The VS Code namespace. Used to read the configured Azure
     * environment (to select the auth provider for sovereign clouds), call the
     * `authentication` API, and localize log messages.
     */
    readonly code: IVsCode;

    /**
     * (Optional) The tenant ID to authenticate to. Defaults to the tenant of the currently signed-in account.
     */
    readonly tenantId?: string;

    /** (Optional) Output channel for auth lifecycle logging. */
    readonly output?: IOutputChannel;

    /**
     * (Optional) Options forwarded to {@linkcode vscode.authentication.getSession getSession}.
     * Controls session creation behavior (e.g. `silent`, `createIfNone`, `account`).
     */
    readonly sessionOptions?: vscode.AuthenticationGetSessionOptions;
}

/**
 * A `TokenCredential` implementation that defers to the VS Code
 * `authentication` API to acquire Microsoft/Azure access tokens.
 *
 * The credential owns the decision of which authentication provider to use: it
 * reads the configured Azure environment (the `microsoft-sovereign-cloud`
 * setting) once, on the first token request, and caches the resolved
 * environment for its lifetime, deriving the provider id from it on each
 * request. It selects the `microsoft` provider for the public cloud or
 * `microsoft-sovereign-cloud` for sovereign / custom clouds. A cloud switch is
 * rare and recreates the credential graph, so the per-instance cache stays correct.
 *
 * CAE and MFA step-up challenges are handled transparently: when the built-in
 * `bearerTokenAuthenticationPolicy` re-invokes {@linkcode getToken} with
 * {@linkcode GetTokenOptions.claims claims}, the credential forwards them to
 * `getSession` as a `WWW-Authenticate` challenge so VS Code can satisfy the
 * step-up.
 */
export class VsCodeExtensionCredential implements TokenCredential {
    private environment: EnvironmentLike | undefined;

    public constructor(private readonly options: VsCodeExtensionCredentialOptions) { }

    /**
     * Acquire an access token for the given scopes via the VS Code
     * authentication API. Returns `null` when no session is available.
     */
    public async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
        const { code, output } = this.options;
        this.environment ??= getConfiguredAzureEnv(code);
        const provider = getAuthProviderId(this.environment);

        const scopesArray = normalizeScopes(scopes, this.environment.managementEndpointUrl);

        const tenantId = options?.tenantId || this.options.tenantId;
        if (tenantId) {
            scopesArray.push(`VSCODE_TENANT:${tenantId}`);
        }

        // When the bearer-token policy hands us CAE/MFA claims, forward them to VS
        // Code as a synthetic WWW-Authenticate challenge so it can step up the session.
        const claims = options?.claims;
        const scopesOrChallenge: string[] | vscode.AuthenticationWwwAuthenticateRequest = claims
            ? { wwwAuthenticate: buildClaimsChallenge(claims), fallbackScopes: scopesArray }
            : scopesArray;

        output?.debug(`[auth] getToken start provider=${provider} tenant=${tenantId ?? '<default>'} challenge=${claims ? 'true' : 'false'} scopes=${JSON.stringify(scopesArray)}`);
        const session = await code.authentication.getSession(provider, scopesOrChallenge, this.options.sessionOptions);

        if (!session) {
            return null;
        }

        const { expiresOnTimestamp, refreshAfterTimestamp } = getTokenExpiry(session.idToken);

        const scopesJson = JSON.stringify(scopesArray);
        output?.info(code.l10n.t('[auth] token acquired provider={0} scopes={1} expiresOn={2}', provider, scopesJson, expiresOnTimestamp));

        return {
            token: session.accessToken,
            expiresOnTimestamp,
            refreshAfterTimestamp,
            tokenType: 'Bearer',
        };
    }
}

/**
 * Normalize scopes to an array of unique `.default` resource scopes, falling
 * back to the environment's management endpoint when none are provided.
 *
 * Each scope that does not already end in `.default` has the suffix appended,
 * and duplicates are removed.
 *
 * `managementEndpointUrl` is guaranteed to have no trailing slash (see
 * {@linkcode createEnvironment}), so the slash required by the AAD `.default`
 * scope is appended directly here.
 */
function normalizeScopes(scopes: string | string[], managementEndpointUrl: string): string[] {
    let list = Array.isArray(scopes) ? [...scopes] : scopes ? [scopes] : [];
    if (list.length === 0) {
        list = [`${managementEndpointUrl}/.default`];
    }

    const normalized = list.map(scope => (scope.endsWith('.default') ? scope : `${scope}.default`));
    return Array.from(new Set(normalized));
}

/**
 * Build a synthetic `WWW-Authenticate` header value carrying a CAE/MFA claims
 * challenge that VS Code's authentication provider can parse. The `claims`
 * received from the bearer-token policy are the decoded challenge string; VS
 * Code expects them base64-encoded in the header.
 */
function buildClaimsChallenge(claims: string): string {
    const encoded = Buffer.from(claims, 'utf8').toString('base64');
    return `Bearer error="insufficient_claims", claims="${encoded}"`;
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
