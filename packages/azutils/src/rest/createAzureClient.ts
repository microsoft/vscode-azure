/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client as RestClient, ClientOptions as RestClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { ServiceClient, ServiceClientOptions } from '@azure/core-client';
import type { IActionExecutor, ICodeContext } from '@microsoft/vscode-azure-utils';
import { AcceptLanguagePolicy } from './pipeline/AcceptLanguagePolicy';
import { CorrelationIdPolicy } from './pipeline/CorrelationIdPolicy';
import { DedupeRequestPolicy } from './pipeline/DedupeRequestPolicy';
import { MFAChallengePolicy } from './pipeline/MFAChallengePolicy';
import { RemoveBOMPolicy } from './pipeline/RemoveBOMPolicy';

export function createAzureClient<TClient extends ServiceClient, TOptions extends ServiceClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    clientCtor: new (credential: TokenCredential, options?: TOptions) => TClient,
    credential: TokenCredential,
    options?: TOptions,
): TClient {
    return new clientCtor(credential, applyDefaults(ctx, executor, options));
}

export function createAzureSubscriptionClient<TClient extends ServiceClient, TOptions extends ServiceClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    clientCtor: new (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscriptionId: string,
    options?: TOptions,
): TClient {
    return new clientCtor(credential, subscriptionId, applyDefaults(ctx, executor, options));
}

export function createAzureRestClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, options?: TOptions) => TClient,
    credential: TokenCredential,
    options?: TOptions,
): TClient {
    return getClient(credential, applyDefaults(ctx, executor, options));
}

export function createAzureRestSubscriptionClient<TClient extends RestClient, TOptions extends RestClientOptions>(
    ctx: ICodeContext,
    executor: IActionExecutor,
    getClient: (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscriptionId: string,
    options?: TOptions,
): TClient {
    return getClient(credential, subscriptionId, applyDefaults(ctx, executor, options));
}

function applyDefaults<TOptions extends RestClientOptions | ServiceClientOptions>(ctx: ICodeContext, executor: IActionExecutor, options?: TOptions): TOptions {
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
                policy: new MFAChallengePolicy(executor, () => Promise.resolve(undefined)), // TODO: pass in real get new token function
                position: 'perRetry',
            },
            {
                policy: new RemoveBOMPolicy(),
                position: 'perRetry',
            },
        ],
    } satisfies (RestClientOptions | ServiceClientOptions) as TOptions;
}

// TODO: Other policies we (maybe) need from before:
// - missing content type?
// - Status code?
