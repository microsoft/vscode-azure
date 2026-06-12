/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient, ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import type { AzureSubscription } from '../auth/AzureSubscription';
import type { EnvironmentLike } from '../auth/Environment';
import { AcceptLanguagePolicy } from './pipeline/AcceptLanguagePolicy';
import { CorrelationIdPolicy } from './pipeline/CorrelationIdPolicy';
import { DedupeRequestPolicy } from './pipeline/DedupeRequestPolicy';

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
 */
export function createArmRestClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, options?: TOptions) => TClient,
    credential: TokenCredential,
    environment: EnvironmentLike,
    options?: TOptions,
): TClient {
    const endpoint = environment.resourceManagerEndpointUrl;
    executor.output.debug(`[rest] create rest client ${getClient.name}`);
    return getClient(credential, applyDefaults(ctx, executor, { ...options, endpoint } as TOptions));
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
 * taken from the supplied {@linkcode AzureSubscription}, and any caller-provided
 * `options` are merged over the factory defaults.
 *
 * @param credential - The token credential used to authenticate requests.
 * @param subscription - The subscription whose ID and environment endpoint are used.
 *   A subscription with an empty `subscriptionId` raises a `TypeError`.
 * @param options - Optional client options merged over the factory defaults.
 */
export function createArmRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscription: AzureSubscription,
    options?: TOptions,
): TClient {
    const subscriptionId = subscription.subscriptionId;
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
        throw new TypeError('Invalid arguments: a non-empty subscription ID string is required.');
    }

    const endpoint = subscription.environment.resourceManagerEndpointUrl;
    executor.output.debug(`[rest] create rest subscription client ${getClient.name} subscription=${subscriptionId}`);
    return getClient(credential, subscriptionId, applyDefaults(ctx, executor, { ...options, endpoint } as TOptions));
}

function applyDefaults<TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
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
                policy: new DedupeRequestPolicy(),
                position: 'perCall',
            },
            {
                policy: new CorrelationIdPolicy(executor),
                position: 'perCall',
            },
            {
                policy: new AcceptLanguagePolicy(ctx.code.env.language),
                position: 'perCall',
            },
        ],
    } satisfies RestClientOptions as TOptions;
}
