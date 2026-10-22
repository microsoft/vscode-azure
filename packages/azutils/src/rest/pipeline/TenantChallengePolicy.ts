/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PipelinePolicy, PipelineRequest, PipelineResponse, SendRequest } from '@azure/core-rest-pipeline';
import type { IOutputChannel } from '@microsoft/vscode-azure-utils';
import type { EnvironmentLike } from '../../auth/Environment';
import type { TenantChallengeCredential } from '../../auth/VsCodeExtensionCredential';

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const subscriptionPathPattern = /\/subscriptions\/([^/?#]+)/i;

/** Options for {@linkcode TenantChallengePolicy}. */
export interface TenantChallengePolicyOptions {
    /** Re-acquires the token for the tenant the service names. */
    readonly credential: TenantChallengeCredential;
    /** The cloud whose {@linkcode EnvironmentLike.loginHosts login hosts} an authority must belong to. */
    readonly environment: EnvironmentLike;
    /** Scopes the retry token is requested for. */
    readonly scopes: readonly string[];
    /** Receives debug output about each decision. */
    readonly output: IOutputChannel;
}

/**
 * Repairs a request ARM rejected because its token came from the wrong tenant.
 *
 * ARM answers such a request with a `401` whose `WWW-Authenticate` challenge
 * names the authority that would have worked. When the challenge is trustworthy
 * this policy re-acquires a token for that tenant **silently** and sends the
 * request once more; if it cannot, the original `401` is returned untouched, so
 * a failure degrades rather than prompts.
 *
 * Must sit *after* the bearer-token policy (a per-retry policy), which would
 * otherwise overwrite the retry's `Authorization` header with its cached
 * wrong-tenant token. Challenges the bearer policy owns -- those carrying
 * `claims` for CAE / MFA step-up -- are left alone.
 *
 * The retry is bounded by construction: one extra send per request, only for a
 * `401`, only for a tenant other than the one just tried. The authority URI is
 * never followed; only a tenant id from an allowlisted host is extracted.
 */
export class TenantChallengePolicy implements PipelinePolicy {
    public readonly name = 'TenantChallengePolicy';

    public constructor(private readonly options: TenantChallengePolicyOptions) { }

    /** @inheritdoc */
    public async sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse> {
        const response = await next(request);
        if (response.status !== 401) {
            return response;
        }

        const tenantId = this.getChallengedTenant(request, response);
        if (!tenantId) {
            return response;
        }

        const { credential, scopes, output } = this.options;
        let token;
        try {
            token = await credential.getTokenSilentlyForTenant([...scopes], tenantId, { abortSignal: request.abortSignal });
        } catch (error) {
            output.debug(`[rest] tenant challenge: silent token acquisition failed (${error instanceof Error ? error.name : typeof error})`);
            return response;
        }
        if (!token) {
            output.debug('[rest] tenant challenge: no session could supply a token silently');
            return response;
        }

        output.debug('[rest] tenant challenge: retrying once with the tenant named by the service');
        request.headers.set('Authorization', `${token.tokenType ?? 'Bearer'} ${token.token}`);
        const retried = await next(request);
        if (retried.status !== 401) {
            credential.reportTenantDiscovered({ tenantId, subscriptionId: getSubscriptionId(request.url) });
        }
        return retried;
    }

    /**
     * The tenant to retry with, or `undefined` when the response is not a
     * challenge that is safe and useful to act on.
     */
    private getChallengedTenant(request: PipelineRequest, response: PipelineResponse): string | undefined {
        const { credential, environment, output } = this.options;

        const challenge = parseBearerChallenge(response.headers.get('WWW-Authenticate'));
        if (!challenge || challenge.claims !== undefined || challenge.error?.toLowerCase() !== 'invalid_token') {
            return undefined;
        }

        const tenantId = getTenantFromAuthorityUri(challenge.authorizationUri, environment);
        if (!tenantId) {
            output.debug('[rest] tenant challenge: ignored, no trusted tenant in the challenge');
            return undefined;
        }

        if (!isReplayable(request.body)) {
            output.debug('[rest] tenant challenge: ignored, the request body cannot be replayed');
            return undefined;
        }

        const triedTenant = getTenantFromAuthorizationHeader(request.headers.get('Authorization')) ?? credential.tenantId;
        if (triedTenant?.toLowerCase() === tenantId.toLowerCase()) {
            return undefined;
        }

        return tenantId;
    }
}

/** The parameters of a `Bearer` challenge that matter to {@linkcode TenantChallengePolicy}. */
export interface BearerChallenge {
    readonly authorizationUri?: string;
    readonly error?: string;
    readonly claims?: string;
}

/**
 * Parse the first `Bearer` challenge in a `WWW-Authenticate` header value.
 *
 * Understands quoted parameters only, which is how Entra ID and ARM emit them,
 * and tolerates several challenges in one header.
 *
 * @returns `undefined` when the header is absent or holds no `Bearer` challenge.
 */
export function parseBearerChallenge(header: string | undefined): BearerChallenge | undefined {
    if (!header) {
        return undefined;
    }

    const challengePattern = /(\w+)\s+((?:\w+=(?:"[^"]*"|[^,]*),?\s*)+)/g;
    for (const challenge of header.matchAll(challengePattern)) {
        if (challenge[1].toLowerCase() !== 'bearer') {
            continue;
        }

        const params = new Map<string, string>();
        for (const param of challenge[2].matchAll(/(\w+)="([^"]*)"/g)) {
            params.set(param[1].toLowerCase(), param[2]);
        }
        return {
            authorizationUri: params.get('authorization_uri') ?? params.get('authorization'),
            error: params.get('error'),
            claims: params.get('claims'),
        };
    }

    return undefined;
}

/**
 * Extract the tenant id from a challenge's authority URI, accepting it only if
 * it is an `https` URI on one of the environment's login hosts and its first
 * path segment is a GUID. Anything else is treated as untrusted network input.
 */
function getTenantFromAuthorityUri(authorityUri: string | undefined, environment: EnvironmentLike): string | undefined {
    if (!authorityUri) {
        return undefined;
    }

    let uri: URL;
    try {
        uri = new URL(authorityUri);
    } catch {
        return undefined;
    }

    if (uri.protocol !== 'https:' || !environment.loginHosts.includes(uri.hostname.toLowerCase())) {
        return undefined;
    }

    const tenantId = uri.pathname.split('/').find(segment => segment.length > 0);
    return tenantId && guidPattern.test(tenantId) ? tenantId : undefined;
}

/** The `tid` claim of the bearer token a request carried, when it is a parseable JWT. */
function getTenantFromAuthorizationHeader(header: string | undefined): string | undefined {
    const token = header?.split(/\s+/)[1];
    const payload = token?.split('.')[1];
    if (!payload) {
        return undefined;
    }

    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { tid?: unknown };
        return typeof claims.tid === 'string' ? claims.tid : undefined;
    } catch {
        return undefined;
    }
}

/** Whether a request body can be sent a second time -- a stream is consumed by the first send. */
function isReplayable(body: PipelineRequest['body']): boolean {
    return body === undefined || body === null || typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

function getSubscriptionId(url: string): string | undefined {
    const id = subscriptionPathPattern.exec(url)?.[1];
    return id && guidPattern.test(id) ? id : undefined;
}
