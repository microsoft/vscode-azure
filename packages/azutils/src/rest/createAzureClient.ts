/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient, ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { AcceptLanguagePolicy } from './pipeline/AcceptLanguagePolicy';
import { CorrelationIdPolicy } from './pipeline/CorrelationIdPolicy';
import { DedupeRequestPolicy } from './pipeline/DedupeRequestPolicy';
import { MFAChallengePolicy } from './pipeline/MFAChallengePolicy';
import { RemoveBOMPolicy } from './pipeline/RemoveBOMPolicy';

let azureAuth: typeof import('@microsoft/vscode-azext-azureauth') | undefined;

/**
 * REST-style (`@azure-rest/core-client`) factory for SDKs whose
 * `create*(credential, options?)` free function does **not** take a
 * `subscriptionId` (e.g. `@azure/arm-resources-subscriptions`).
 *
 * Applies the standard set of pipeline policies (see
 * {@linkcode DedupeRequestPolicy}, {@linkcode CorrelationIdPolicy},
 * {@linkcode AcceptLanguagePolicy}, {@linkcode MFAChallengePolicy},
 * {@linkcode RemoveBOMPolicy}) and a user-agent prefix derived from
 * the extension id/version.
 */
export function createAzureRestClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, options?: TOptions) => TClient,
    credentialOrSubscription: TokenCredential | AzureSubscription,
    options?: TOptions,
): TClient {
    const { credential, resolvedOptions } = resolveCredentialArgs<TOptions>(credentialOrSubscription, options);
    executor.output.debug(`[rest] create rest client ${getClient.name}`);
    return getClient(credential, applyDefaults(ctx, executor, resolvedOptions));
}

/**
 * REST-style (`@azure-rest/core-client`) subscription-scoped factory.
 *
 * For the newer SDKs that export a
 * `create*Management(credential, subscriptionId, options?)` free function
 * instead of a class constructor (e.g. `@azure/arm-containerregistry`).
 *
 * Applies the standard set of pipeline policies (see
 * {@linkcode createAzureRestClient}).
 */
export function createAzureRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    subscription: AzureSubscription,
    options?: TOptions,
): TClient;
export function createAzureRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscriptionId: string,
    options?: TOptions,
): TClient;
export function createAzureRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credentialOrSubscription: TokenCredential | AzureSubscription,
    subscriptionIdOrOptions?: string | TOptions,
    optionsOrUndefined?: TOptions,
): TClient {
    const { credential, subscriptionId, resolvedOptions } = resolveSubscriptionArgs<TOptions>(credentialOrSubscription, subscriptionIdOrOptions, optionsOrUndefined);
    executor.output.debug(`[rest] create rest subscription client ${getClient.name} subscription=${subscriptionId}`);
    return getClient(credential, subscriptionId, applyDefaults(ctx, executor, resolvedOptions));
}

function isTokenCredential(value: TokenCredential | AzureSubscription): value is TokenCredential {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return !!value && typeof value === 'object' && 'getToken' in value && typeof value.getToken === 'function';
}

function resolveCredentialArgs<TOptions>(
    credentialOrSubscription: TokenCredential | AzureSubscription,
    options?: TOptions,
): { credential: TokenCredential; resolvedOptions: TOptions | undefined } {
    if (isTokenCredential(credentialOrSubscription)) {
        return { credential: credentialOrSubscription, resolvedOptions: options };
    } else {
        return {
            credential: credentialOrSubscription.credential,
            resolvedOptions: {
                ...options,
                // TODO: future: this won't work for non-ARM clients. Is that a problem? Probably not since only ARM clients care about subscriptions?
                endpoint: credentialOrSubscription.environment.resourceManagerEndpointUrl.replace(/\/+$/, ''),
            } as TOptions,
        };
    }
}

function resolveSubscriptionArgs<TOptions>(
    credentialOrSubscription: TokenCredential | AzureSubscription,
    subscriptionIdOrOptions?: string | TOptions,
    optionsOrUndefined?: TOptions,
): { credential: TokenCredential; subscriptionId: string; resolvedOptions: TOptions | undefined } {
    if (isTokenCredential(credentialOrSubscription)) {
        if (typeof subscriptionIdOrOptions !== 'string' || subscriptionIdOrOptions.length === 0) {
            throw new TypeError('Invalid arguments: when using a TokenCredential, the second argument must be a non-empty subscription ID string.');
        }

        return {
            credential: credentialOrSubscription,
            subscriptionId: subscriptionIdOrOptions,
            resolvedOptions: optionsOrUndefined,
        };
    } else {
        return {
            credential: credentialOrSubscription.credential,
            subscriptionId: credentialOrSubscription.subscriptionId,
            resolvedOptions: {
                ...subscriptionIdOrOptions as TOptions | undefined,
                // TODO: future: this won't work for non-ARM clients. Is that a problem? Probably not since only ARM clients care about subscriptions?
                endpoint: credentialOrSubscription.environment.resourceManagerEndpointUrl.replace(/\/+$/, ''),
            } as TOptions,
        };
    }
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
            {
                policy: new MFAChallengePolicy(executor, async (request) => {
                    azureAuth ??= await import('@microsoft/vscode-azext-azureauth');
                    return azureAuth.getSessionFromVSCode(request);
                }, options?.endpoint),
                position: 'perRetry',
            },
            {
                policy: new RemoveBOMPolicy(),
                position: 'perRetry',
            },
        ],
    } satisfies RestClientOptions as TOptions;
}

// TODO: future: Other policies we (maybe) need from before:
// - missing content type?
// - Status code?
