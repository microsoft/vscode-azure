/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getClient, type Client as RestClient, type ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import { bearerTokenAuthenticationPolicy, type ChallengeCallbacks } from '@azure/core-rest-pipeline';
import type { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import type { AzureSubscriptionTarget } from '../auth/AzureSubscription';
import type { EnvironmentLike } from '../auth/Environment';
import { AcceptLanguagePolicy } from './pipeline/AcceptLanguagePolicy';
import { CorrelationIdPolicy } from './pipeline/CorrelationIdPolicy';
import { DedupeRequestPolicy, type DedupeRequestIdentity } from './pipeline/DedupeRequestPolicy';

export type { ChallengeCallbacks } from '@azure/core-rest-pipeline';
export type { DedupeRequestIdentity } from './pipeline/DedupeRequestPolicy';

/**
 * REST-style (`@azure-rest/core-client`) factory for SDKs whose
 * `create*(credential, options?)` free function does **not** take a
 * `subscriptionId` (e.g. `@azure/arm-resources-subscriptions`).
 *
 * Applies the standard set of pipeline policies (see
 * {@linkcode DedupeRequestPolicy}, {@linkcode CorrelationIdPolicy},
 * {@linkcode AcceptLanguagePolicy}), a user-agent prefix derived from the
 * extension id/version, and merges any caller-provided `options`.
 *
 * CAE and MFA step-up challenges are handled by the SDK's built-in
 * `bearerTokenAuthenticationPolicy` together with the supplied
 * {@linkcode TokenCredential} (see `VsCodeExtensionCredential`).
 *
 * @param credential - The token credential used to authenticate requests.
 * @param environment - The Azure environment (cloud) whose ARM endpoint is used.
 * @param options - Optional client options merged over the factory defaults.
 * @param dedupeIdentity - Optional stable account and tenant identity. When
 * omitted, deduplication is limited to clients sharing `credential`.
 */
export function createArmRestClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, options?: TOptions) => TClient,
    credential: TokenCredential,
    environment: EnvironmentLike,
    options?: TOptions,
    dedupeIdentity?: DedupeRequestIdentity,
): TClient {
    const endpoint = environment.resourceManagerEndpointUrl;
    const requestIdentity = getDedupeIdentity(dedupeIdentity ?? credential, options);
    executor.output.debug(`[rest] create rest client ${getClient.name}`);
    return getClient(credential, applyDefaults(ctx, executor, requestIdentity, { ...options, endpoint } as TOptions));
}

/**
 * REST-style (`@azure-rest/core-client`) subscription-scoped factory.
 *
 * For the newer SDKs that export a
 * `create*Management(credential, subscriptionId, options?)` free function
 * instead of a class constructor (e.g. `@azure/arm-containerregistry`).
 *
 * Applies the standard set of pipeline policies (see
 * {@linkcode createArmRestClient}). The subscription ID and ARM endpoint are
 * taken from the supplied {@linkcode AzureSubscriptionTarget}, and any
 * caller-provided `options` are merged over the factory defaults.
 *
 * @param credential - The token credential used to authenticate requests.
 * @param subscription - The subscription whose ID and environment endpoint are used.
 *   A subscription with an empty `subscriptionId` raises a `TypeError`. It also
 *   serves as the deduplication identity, which partitions by account and tenant
 *   when those are known and per-client otherwise.
 * @param options - Optional client options merged over the factory defaults.
 */
export function createArmRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscription: AzureSubscriptionTarget,
    options?: TOptions,
): TClient {
    const subscriptionId = subscription.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
        throw new TypeError('Invalid arguments: a non-empty subscription ID string is required.');
    }

    const endpoint = subscription.environment.resourceManagerEndpointUrl;
    const requestIdentity = getDedupeIdentity(subscription, options);
    executor.output.debug(`[rest] create rest subscription client ${getClient.name} subscription=${subscriptionId}`);
    return getClient(credential, subscriptionId, applyDefaults(ctx, executor, requestIdentity, { ...options, endpoint } as TOptions));
}

/**
 * Identifies a data-plane service endpoint and how requests to it are
 * authenticated.
 *
 * Data-plane services differ from ARM in that each has its own host and its own
 * token audience, and some will not accept an Entra ID token directly at all.
 */
export interface DataPlaneClientConfig {
    /** Short service name, used only to label debug output, e.g. `acr`. */
    readonly name: string;
    /** Absolute base URL of the service, e.g. `https://contoso.azurecr.io`. */
    readonly endpoint: string;
    /**
     * Credential for the `Authorization` header.
     *
     * Omit for an endpoint that authenticates from the request body instead,
     * such as a token-exchange endpoint -- attaching a bearer token there would
     * recurse into the very challenge the exchange exists to satisfy.
     */
    readonly credential?: TokenCredential;
    /** Token scopes, e.g. `['https://api.loganalytics.io/.default']`. Unused when {@linkcode credential} is omitted. */
    readonly scopes?: readonly string[];
    /**
     * Handles a `401` whose `WWW-Authenticate` demands more than a re-issued
     * Entra ID token. A service that trades that token for a service-scoped one
     * supplies the exchange here; the callback receives the challenge, so the
     * scope comes from the service rather than being guessed up front.
     */
    readonly challengeCallbacks?: ChallengeCallbacks;
    /**
     * Optional stable account and tenant identity. When omitted, deduplication
     * is limited to clients sharing the credential.
     */
    readonly dedupeIdentity?: DedupeRequestIdentity;
}

/**
 * REST-style (`@azure-rest/core-client`) factory for a data-plane service.
 *
 * Applies the same pipeline as the ARM factories (see
 * {@linkcode createArmRestClient}), so a data-plane request carries the same
 * correlation id, `Accept-Language`, deduplication, and user-agent prefix as a
 * management request does.
 *
 * @param config - The endpoint and its authentication.
 * @param options - Optional client options merged over the factory defaults.
 */
export function createDataPlaneRestClient(
    ctx: ICodeContext,
    executor: IActionExecutor,
    config: DataPlaneClientConfig,
    options?: RestClientOptions,
): RestClient {
    const { name, endpoint, credential, scopes, challengeCallbacks, dedupeIdentity } = config;
    const requestIdentity = getDedupeIdentity(dedupeIdentity ?? credential ?? {}, options);
    const defaults = applyDefaults(ctx, executor, requestIdentity, { ...options, endpoint });
    executor.output.debug(`[rest] create data-plane rest client ${name} endpoint=${endpoint}`);

    if (!credential) {
        return getClient(endpoint, defaults);
    }

    if (!challengeCallbacks) {
        return getClient(endpoint, credential, {
            ...defaults,
            credentials: { ...defaults.credentials, scopes: scopes ? [...scopes] : undefined },
        });
    }

    // `getClient` derives its bearer policy from `credentials.scopes` alone and
    // exposes no hook for the challenge, so the policy is added afterwards to a
    // client built without a credential. Going through the standard policy
    // rather than a bespoke one keeps Entra ID token caching and conditional
    // access step-up on the underlying credential.
    const client = getClient(endpoint, defaults);
    client.pipeline.addPolicy(bearerTokenAuthenticationPolicy({
        credential,
        scopes: scopes ? [...scopes] : [],
        challengeCallbacks,
    }));
    return client;
}

function applyDefaults<TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    dedupeIdentity: DedupeRequestIdentity | object,
    options?: TOptions,
): TOptions {
    const extensionUserAgentPrefix = `${ctx.extensionContext.extension.id}/${(ctx.extensionContext.extension.packageJSON as { version: string }).version}`;

    return {
        ...options,
        userAgentOptions: {
            ...options?.userAgentOptions,
            userAgentPrefix: [extensionUserAgentPrefix, options?.userAgentOptions?.userAgentPrefix].filter(Boolean).join(' '),
        },
        additionalPolicies: [
            ...(options?.additionalPolicies ?? []),
            {
                policy: new CorrelationIdPolicy(executor),
                position: 'perCall',
            },
            {
                policy: new AcceptLanguagePolicy(ctx.code.env.language),
                position: 'perCall',
            },
            {
                policy: new DedupeRequestPolicy(dedupeIdentity),
                position: 'perCall',
            },
        ],
    } satisfies RestClientOptions as TOptions;
}

function getDedupeIdentity(identity: DedupeRequestIdentity | object, options: RestClientOptions | undefined): DedupeRequestIdentity | object {
    // Response-affecting options can change transport or pipeline semantics, so
    // a unique object keeps in-flight requests local to this client.
    return hasResponseAffectingClientOptions(options) ? {} : identity;
}

function hasResponseAffectingClientOptions(options: RestClientOptions | undefined): boolean {
    return !!options && (
        !!options.httpClient
        || !!options.pipeline
        || !!options.additionalPolicies?.length
        || !!options.retryOptions
        || !!options.redirectOptions
        || !!options.credentials
        || !!options.proxyOptions
        || !!options.agent
        || !!options.tlsOptions
    );
}
