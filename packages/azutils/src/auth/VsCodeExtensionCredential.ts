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

    /**
     * (Optional) Called after a request that was rejected as wrong-tenant
     * succeeded against the tenant the service named (see
     * {@linkcode TenantChallengeCredential.reportTenantDiscovered}).
     */
    readonly onTenantDiscovered?: (discovery: TenantDiscovery) => void;
}

/**
 * Token options understood by {@linkcode VsCodeExtensionCredential} on top of the
 * standard {@linkcode GetTokenOptions}.
 */
export interface VsCodeGetTokenOptions extends GetTokenOptions {
    /**
     * Acquire only from an existing session, never prompting, regardless of the
     * credential's own session options.
     */
    readonly silent?: boolean;
}

/** A tenant a service said a request should have been authenticated to. */
export interface TenantDiscovery {
    /** The tenant the service named. */
    readonly tenantId: string;
    /** The subscription the request was addressed to, when its path named one. */
    readonly subscriptionId?: string;
}

/**
 * A {@linkcode TokenCredential} that can re-acquire a token for another tenant
 * without prompting, which is what lets a wrong-tenant `401` repair itself.
 *
 * Kept as a capability rather than a concrete class so the request pipeline
 * stays auth-agnostic and a credential without it simply opts out.
 */
export interface TenantChallengeCredential extends TokenCredential {
    /** The tenant the credential was configured with, if any. */
    readonly tenantId: string | undefined;

    /**
     * Acquire a token for `tenantId` from an existing session only.
     *
     * @returns `null` when no session can supply one without interaction.
     */
    getTokenSilentlyForTenant(scopes: string | string[], tenantId: string, options?: Pick<GetTokenOptions, 'abortSignal'>): Promise<AccessToken | null>;

    /** Record that `discovery.tenantId` served a request that another tenant's token could not. */
    reportTenantDiscovered(discovery: TenantDiscovery): void;
}

/** Whether `credential` supports {@linkcode TenantChallengeCredential} retries. */
export function isTenantChallengeCredential(credential: TokenCredential): credential is TenantChallengeCredential {
    const candidate = credential as Partial<TenantChallengeCredential>;
    return typeof candidate.getTokenSilentlyForTenant === 'function' && typeof candidate.reportTenantDiscovered === 'function';
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
export class VsCodeExtensionCredential implements TenantChallengeCredential {
    private environment: EnvironmentLike | undefined;

    public constructor(private readonly options: VsCodeExtensionCredentialOptions) { }

    /** @inheritdoc */
    public get tenantId(): string | undefined {
        return this.options.tenantId;
    }

    /**
     * Acquire the underlying VS Code {@linkcode vscode.AuthenticationSession}
     * for the given scopes.
     *
     * This owns everything token acquisition needs from the VS Code
     * authentication API -- provider selection, scope normalization, the
     * `VSCODE_TENANT:` tenant scope, CAE/MFA claim forwarding, session-option
     * resolution, and lifecycle logging -- and returns the raw session. Prompts
     * interactive sign-in by default (see {@linkcode resolveSessionOptions}).
     *
     * Prefer {@linkcode getToken} when you only need an `AccessToken`. Reach for
     * this method when you specifically need the session itself -- for example
     * to read {@linkcode vscode.AuthenticationSession.account account.id} after a
     * tenant-targeted sign-in -- so that logic doesn't have to duplicate the
     * provider/scope construction that lives here.
     *
     * @returns The established session, or `null` when none is available (e.g.
     * silent acquisition with no existing session, or the user cancels sign-in).
     */
    public async authenticate(scopes: string | string[] = [], options?: VsCodeGetTokenOptions): Promise<vscode.AuthenticationSession | null> {
        const { code, output } = this.options;
        this.environment ??= getConfiguredAzureEnv(code);
        const provider = getAuthProviderId(this.environment);

        const scopesArray = normalizeScopes(scopes, this.environment.resourceManagerDefaultScope);

        const tenantId = options?.tenantId || this.options.tenantId;
        if (tenantId) {
            scopesArray.push(`VSCODE_TENANT:${tenantId}`);
        }

        // When the bearer-token policy hands us CAE/MFA claims, forward them to VS Code
        // as a synthetic WWW-Authenticate challenge so it can step up the session.
        const claims = options?.claims;
        const scopesOrChallenge: string[] | vscode.AuthenticationWwwAuthenticateRequest = claims
            ? { wwwAuthenticate: buildClaimsChallenge(claims), fallbackScopes: scopesArray }
            : scopesArray;

        const sessionOptions = this.resolveSessionOptions(options?.silent);

        output?.debug(`[auth] authenticate start provider=${provider} tenant=${tenantId ?? '<default>'} challenge=${claims ? 'true' : 'false'} scopes=${JSON.stringify(scopesArray)}`);
        const session = await code.authentication.getSession(provider, scopesOrChallenge, sessionOptions);

        if (session) {
            output?.info(code.l10n.t('[auth] session acquired provider={0} scopes={1}', provider, JSON.stringify(scopesArray)));
        }

        return session ?? null;
    }

    /**
     * Acquire an access token for the given scopes via the VS Code
     * authentication API. Prompts interactive sign-in by default (see
     * {@linkcode resolveSessionOptions}). Returns `null` when no session is
     * available (e.g. silent acquisition with no existing session, or the user
     * cancels sign-in).
     *
     * Thin wrapper over {@linkcode authenticate} that converts the resolved
     * session into an {@linkcode AccessToken} (deriving the token expiry).
     */
    public async getToken(scopes: string | string[], options?: VsCodeGetTokenOptions): Promise<AccessToken | null> {
        const session = await this.authenticate(scopes, options);
        if (!session) {
            return null;
        }

        const { expiresOnTimestamp, refreshAfterTimestamp } = getTokenExpiry(session.accessToken, session.idToken);

        return {
            token: session.accessToken,
            expiresOnTimestamp,
            refreshAfterTimestamp,
            tokenType: 'Bearer',
        };
    }

    /**
     * Acquire a token for `tenantId` from an existing session, never prompting.
     * The credential's own `account` scoping is kept, so the retry stays on the
     * account the original request used.
     */
    public getTokenSilentlyForTenant(scopes: string | string[], tenantId: string, options?: Pick<GetTokenOptions, 'abortSignal'>): Promise<AccessToken | null> {
        return this.getToken(scopes, { abortSignal: options?.abortSignal, tenantId, silent: true });
    }

    /** @inheritdoc */
    public reportTenantDiscovered(discovery: TenantDiscovery): void {
        this.options.onTenantDiscovered?.(discovery);
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
     *
     * A per-request `silent` forces non-interactive acquisition and drops any
     * `createIfNone` the credential was configured with.
     */
    private resolveSessionOptions(silent?: boolean): vscode.AuthenticationGetSessionOptions | undefined {
        const sessionOptions = this.options.sessionOptions;
        if (silent) {
            const { createIfNone: _createIfNone, forceNewSession: _forceNewSession, ...rest } = sessionOptions ?? {};
            return { ...rest, silent: true };
        }
        if (sessionOptions?.silent) {
            return sessionOptions;
        }
        return { createIfNone: true, ...sessionOptions };
    }
}

/**
 * Normalize scopes to an array of unique `.default` resource scopes, falling
 * back to the environment's default ARM (resource manager) scope when none are
 * provided.
 *
 * Each scope that does not already end in `.default` has the suffix appended,
 * and duplicates are removed.
 *
 * `resourceManagerDefaultScope` is the pre-built `<arm endpoint>/.default` scope
 * derived from the trailing-slash-stripped endpoint (see
 * {@linkcode createEnvironment}), so it is used as-is for the default. For
 * arbitrary scopes, a slash is inserted if missing.
 */
function normalizeScopes(scopes: string | string[], resourceManagerDefaultScope: string): string[] {
    let list = Array.isArray(scopes) ? [...scopes] : scopes ? [scopes] : [];
    if (list.length === 0) {
        list = [resourceManagerDefaultScope];
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
const FallbackTtlMs = 5 * 60 * 1000;

/**
 * Best-effort computation of the token expiry for the returned `AccessToken`.
 *
 * The access token is tried first; because it may be encrypted/opaque rather
 * than a parseable JWT, the ID token is used as a fallback. Returns
 * `expiresOnTimestamp` in milliseconds and `refreshAfterTimestamp` at 2/3 of the
 * remaining lifetime.
 *
 * When neither token yields a usable `exp`, falls back to a short positive TTL
 * ({@linkcode FallbackTtlMs}) so the token is cached briefly and refreshed
 * soon, rather than being treated as already expired.
 */
function getTokenExpiry(accessToken: string | undefined, idToken: string | undefined): { expiresOnTimestamp: number; refreshAfterTimestamp: number } {
    const now = Date.now();
    const exp = parseJwtExp(accessToken) ?? parseJwtExp(idToken);
    const expiresOnTimestamp = exp !== undefined ? exp * 1000 : now + FallbackTtlMs;

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
