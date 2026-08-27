/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient } from '@azure-rest/core-client';
import type { AuthorizeRequestOnChallengeOptions, AuthorizeRequestOptions, ChallengeCallbacks } from '@azure/core-rest-pipeline';

/**
 * A container registry will not accept an Entra ID token. It answers an
 * unauthenticated request with a `401` naming the registry and the scope the
 * caller needs, and that token has to be traded for a registry-issued one in
 * two steps:
 *
 * 1. `POST /oauth2/exchange` trades the Entra ID token for a registry *refresh*
 *    token. Scope-independent and comparatively long-lived.
 * 2. `POST /oauth2/token` trades that refresh token for an *access* token good
 *    for one scope, e.g. `repository:store/api:metadata_read`.
 *
 * Both endpoints authenticate from the form body rather than a header, so they
 * must be called by a credential-less client -- otherwise the auth policy
 * recurses into the challenge this exchange exists to satisfy.
 */

/** Parsed fields of a `WWW-Authenticate: Bearer ...` challenge. */
interface RegistryChallenge {
    readonly service: string;
    readonly scope: string;
}

/** Response body of `POST /oauth2/exchange`. Mirrors `AcrRefreshToken`, whose SDK property is `refreshToken`. */
interface RefreshTokenResponse {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- OAuth 2.0 wire field
    readonly refresh_token?: string;
}

/** Response body of `POST /oauth2/token`. Mirrors `AcrAccessToken`, whose SDK property is `accessToken`. */
interface AccessTokenResponse {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- OAuth 2.0 wire field
    readonly access_token?: string;
}

/**
 * Performs the registry's two-step token exchange.
 *
 * One instance is bound to one registry. The refresh token is cached as a
 * *promise* rather than a value, so a fan-out that challenges on many
 * repositories at once shares a single exchange instead of issuing one per
 * repository.
 */
export class AcrTokenExchange {
    private refreshToken: Promise<string> | undefined;

    /**
     * @param authClient - A client for the registry that attaches **no**
     *   `Authorization` header.
     */
    constructor(private readonly authClient: RestClient) { }

    /**
     * Returns an access token for one challenge scope.
     *
     * @param getEntraToken - Supplies the Entra ID token to trade. Called at
     *   most once per instance, and only when no refresh token is cached yet.
     * @throws If either exchange step fails or returns no token.
     */
    public async getAccessToken(challenge: RegistryChallenge, getEntraToken: () => Promise<string>): Promise<string> {
        // Assigned before the first await so concurrent callers join this
        // exchange rather than starting their own.
        this.refreshToken ??= this.exchangeForRefreshToken(challenge.service, getEntraToken);

        let refreshToken: string;
        try {
            refreshToken = await this.refreshToken;
        } catch (error) {
            // A failed exchange must not poison every later request on this
            // client; the next caller retries from scratch.
            this.refreshToken = undefined;
            throw error;
        }

        const response = await this.authClient.pathUnchecked('/oauth2/token').post({
            contentType: 'application/x-www-form-urlencoded',
            body: new URLSearchParams([
                ['grant_type', 'refresh_token'],
                ['service', challenge.service],
                ['scope', challenge.scope],
                ['refresh_token', refreshToken],
            ]).toString(),
        });

        if (response.status !== '200') {
            throw new Error(`Container registry refused an access token for scope '${challenge.scope}' (HTTP ${response.status}).`);
        }

        const accessToken = (response.body as AccessTokenResponse).access_token;
        if (!accessToken) {
            throw new Error(`Container registry returned no access token for scope '${challenge.scope}'.`);
        }
        return accessToken;
    }

    private async exchangeForRefreshToken(service: string, getEntraToken: () => Promise<string>): Promise<string> {
        const entraToken = await getEntraToken();

        // `tenant` is deliberately omitted: the registry reads it from the
        // token, and supplying a mismatched one is rejected.
        const response = await this.authClient.pathUnchecked('/oauth2/exchange').post({
            contentType: 'application/x-www-form-urlencoded',
            body: new URLSearchParams([
                ['grant_type', 'access_token'],
                ['service', service],
                ['access_token', entraToken],
            ]).toString(),
        });

        if (response.status !== '200') {
            throw new Error(`Container registry refused the token exchange for '${service}' (HTTP ${response.status}).`);
        }

        const refreshToken = (response.body as RefreshTokenResponse).refresh_token;
        if (!refreshToken) {
            throw new Error(`Container registry returned no refresh token for '${service}'.`);
        }
        return refreshToken;
    }
}

/**
 * Adapts {@linkcode AcrTokenExchange} to the pipeline's challenge hook.
 *
 * The scope is read from the challenge rather than predicted, because a
 * registry scopes reads per repository and the correct value is only known once
 * the service has asked for it.
 */
export class AcrChallengeCallbacks implements ChallengeCallbacks {
    private lastAccessToken: string | undefined;

    constructor(private readonly exchange: AcrTokenExchange) { }

    /**
     * Attaches the most recently issued token on the chance that this request
     * needs the same scope. A token for the wrong scope simply draws a fresh
     * challenge, which is cheaper than skipping the attempt every time.
     */
    public authorizeRequest(options: AuthorizeRequestOptions): Promise<void> {
        if (this.lastAccessToken) {
            options.request.headers.set('Authorization', `Bearer ${this.lastAccessToken}`);
        }
        return Promise.resolve();
    }

    /** @inheritdoc */
    public async authorizeRequestOnChallenge(options: AuthorizeRequestOnChallengeOptions): Promise<boolean> {
        const header = options.response.headers.get('WWW-Authenticate');
        const challenge = header ? parseRegistryChallenge(header) : undefined;
        if (!challenge) {
            // Nothing actionable in the response, so let the 401 surface rather
            // than retrying an identical request.
            return false;
        }

        const accessToken = await this.exchange.getAccessToken(challenge, async () => {
            // Going through the policy's own getter keeps the Entra ID token in
            // the pipeline's cache and lets the underlying credential handle
            // conditional access step-up.
            const entraToken = await options.getAccessToken(options.scopes, {
                abortSignal: options.request.abortSignal,
                tracingOptions: options.request.tracingOptions,
            });
            if (!entraToken) {
                throw new Error('No Azure credential is available for the container registry.');
            }
            return entraToken.token;
        });

        options.request.headers.set('Authorization', `Bearer ${accessToken}`);
        this.lastAccessToken = accessToken;
        return true;
    }
}

/**
 * Reads `service` and `scope` out of a `WWW-Authenticate` header.
 *
 * Returns `undefined` when either is absent, which is how a challenge that we
 * cannot satisfy is distinguished from one that we can.
 */
function parseRegistryChallenge(header: string): RegistryChallenge | undefined {
    const params: Record<string, string> = {};
    const pattern = /(\w+)="([^"]*)"/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(header)) !== null) {
        params[match[1]] = match[2];
    }

    return params.service && params.scope
        ? { service: params.service, scope: params.scope }
        : undefined;
}
