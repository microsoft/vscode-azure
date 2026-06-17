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
     *
     * When omitted, the credential defaults to `createIfNone: true` so a token
     * request prompts interactive sign-in. Pass `silent: true` for
     * non-interactive acquisition.
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
 *
 * By default the credential requests interactive sign-in (`createIfNone: true`),
 * so simply acquiring a token will prompt the user when no session exists.
 * Callers wanting non-interactive acquisition pass `silent: true` via
 * {@linkcode VsCodeExtensionCredentialOptions.sessionOptions}.
 */
export class VsCodeExtensionCredential implements TokenCredential {
    private environment: EnvironmentLike | undefined;

    public constructor(private readonly options: VsCodeExtensionCredentialOptions) { }

    /**
     * Acquire an access token for the given scopes via the VS Code
     * authentication API. Prompts interactive sign-in by default (see
     * {@linkcode resolveSessionOptions}). Returns `null` when no session is
     * available (e.g. silent acquisition with no existing session, or the user
     * cancels sign-in).
     */
    public async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
        const { code, output } = this.options;
        this.environment ??= getConfiguredAzureEnv(code);
        const provider = getAuthProviderId(this.environment);

        const scopesArray = normalizeScopes(scopes, this.environment.resourceManagerEndpointUrl);

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

        const sessionOptions = this.resolveSessionOptions();

        output?.debug(`[auth] getToken start provider=${provider} tenant=${tenantId ?? '<default>'} challenge=${claims ? 'true' : 'false'} scopes=${JSON.stringify(scopesArray)}`);
        const session = await code.authentication.getSession(provider, scopesOrChallenge, sessionOptions);

        if (!session) {
            return null;
        }

        const { expiresOnTimestamp, refreshAfterTimestamp } = getTokenExpiry(session.accessToken, session.idToken);

        const scopesJson = JSON.stringify(scopesArray);
        output?.info(code.l10n.t('[auth] token acquired provider={0} scopes={1} expiresOn={2}', provider, scopesJson, expiresOnTimestamp));

        return {
            token: session.accessToken,
            expiresOnTimestamp,
            refreshAfterTimestamp,
            tokenType: 'Bearer',
        };
    }

    /**
     * Resolve the {@linkcode vscode.authentication.getSession getSession} options
     * for a token request.
     *
     * Defaults to interactive sign-in (`createIfNone: true`) so that simply
     * requesting a token will prompt the user when no session exists. Callers
     * that need non-interactive acquisition pass `silent: true` in
     * {@linkcode VsCodeExtensionCredentialOptions.sessionOptions}; because
     * `createIfNone` and `silent` are mutually exclusive in the VS Code API, the
     * `createIfNone` default is omitted in that case. Any other caller-provided
     * options (including an explicit `createIfNone: false`) override the default.
     */
    private resolveSessionOptions(): vscode.AuthenticationGetSessionOptions | undefined {
        const sessionOptions = this.options.sessionOptions;
        if (sessionOptions?.silent) {
            return sessionOptions;
        }
        return { createIfNone: true, ...sessionOptions };
    }
}

/**
 * Normalize scopes to an array of unique `.default` resource scopes, falling
 * back to the environment's ARM (resource manager) endpoint when none are
 * provided.
 *
 * Each scope that does not already end in `.default` has the suffix appended,
 * and duplicates are removed.
 *
 * `resourceManagerEndpointUrl` is guaranteed to have no trailing slash (see
 * {@linkcode createEnvironment}), so the `/.default` suffix is appended
 * directly here. For arbitrary scopes, a slash is inserted if missing.
 */
function normalizeScopes(scopes: string | string[], resourceManagerEndpointUrl: string): string[] {
    let list = Array.isArray(scopes) ? [...scopes] : scopes ? [scopes] : [];
    if (list.length === 0) {
        list = [`${resourceManagerEndpointUrl}/.default`];
    }

    const normalized = list.map(scope => {
        if (scope.endsWith('.default')) {
            return scope;
        }
        return scope.endsWith('/') ? `${scope}.default` : `${scope}/.default`;
    });
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
 * Short fallback lifetime (in milliseconds) applied when neither the access
 * token nor the ID token yields a usable `exp` claim. A small positive TTL keeps
 * the token cached briefly (so the bearer-token policy doesn't re-acquire on
 * every request) while still refreshing soon.
 */
const FALLBACK_TTL_MS = 5 * 60 * 1000;

/**
 * Best-effort computation of the token expiry for the returned `AccessToken`.
 *
 * The access token is tried first; because it may be encrypted/opaque rather
 * than a parseable JWT, the ID token is used as a fallback. Returns
 * `expiresOnTimestamp` in milliseconds and `refreshAfterTimestamp` at 2/3 of the
 * remaining lifetime.
 *
 * When neither token yields a usable `exp`, falls back to a short positive TTL
 * ({@linkcode FALLBACK_TTL_MS}) so the token is cached briefly and refreshed
 * soon, rather than being treated as already expired.
 */
function getTokenExpiry(accessToken: string | undefined, idToken: string | undefined): { expiresOnTimestamp: number; refreshAfterTimestamp: number } {
    const now = Date.now();
    const exp = parseJwtExp(accessToken) ?? parseJwtExp(idToken);
    const expiresOnTimestamp = exp !== undefined ? exp * 1000 : now + FALLBACK_TTL_MS;

    const remaining = expiresOnTimestamp - now;
    const refreshAfterTimestamp = remaining > 0 ? now + Math.floor(remaining * 2 / 3) : expiresOnTimestamp;

    return { expiresOnTimestamp, refreshAfterTimestamp };
}

/**
 * Best-effort extraction of the numeric `exp` claim (in seconds) from a JWT.
 * Returns `undefined` when the token is missing, not a parseable JWT (e.g. an
 * encrypted/opaque access token), or lacks a numeric `exp` claim.
 */
function parseJwtExp(token: string | undefined): number | undefined {
    if (!token) {
        return undefined;
    }

    try {
        const parts = token.split('.');
        if (parts.length < 2 || !parts[1]) {
            return undefined;
        }

        // JWT payloads use base64url encoding; Node's Buffer handles this natively
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload: { exp?: number } = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return typeof payload.exp === 'number' ? payload.exp : undefined;
    } catch {
        return undefined;
    }
}
