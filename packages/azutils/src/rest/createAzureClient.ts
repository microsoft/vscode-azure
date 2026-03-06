/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Client, ClientOptions } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { ServiceClient, ServiceClientOptions } from '@azure/core-client';
import { DedupeRequestPipelinePolicy } from './pipeline/DedupeRequestPipelinePolicy';

export function createAzureClient<TClient extends ServiceClient, TOptions extends ServiceClientOptions>(
    clientCtor: new (credential: TokenCredential, options?: TOptions) => TClient,
    credential: TokenCredential,
    options?: TOptions,
): Promise<TClient> {
    return Promise.resolve(new clientCtor(credential, applyDefaults(options)));
}

export function createAzureSubscriptionClient<TClient extends ServiceClient, TOptions extends ServiceClientOptions>(
    clientCtor: new (credential: TokenCredential, subscriptionId: string, options?: TOptions) => TClient,
    credential: TokenCredential,
    subscriptionId: string,
    options?: TOptions,
): Promise<TClient> {
    return Promise.resolve(new clientCtor(credential, subscriptionId, applyDefaults(options)));
}

export function createAzureRestClient<TClient extends Client, TOptions extends ClientOptions>(
    getClient: (options?: TOptions) => TClient,
    options?: TOptions,
): Promise<TClient> {
    return Promise.resolve(
        getClient(
            applyDefaults(options)
        )
    );
}

function applyDefaults<TOptions extends ClientOptions | ServiceClientOptions>(options?: TOptions): TOptions {
    return {
        ...options,
        userAgentOptions: {
            ...options?.userAgentOptions,
            userAgentPrefix: ['ms-azuretools.vscode-azure/0.1.0', options?.userAgentOptions?.userAgentPrefix].filter(Boolean).join(' '), // TODO get extension/version from caller
        },
        additionalPolicies: [
            ...(options?.additionalPolicies ?? []),
            {
                policy: new DedupeRequestPipelinePolicy(),
                position: 'perCall',
            }
        ]
    } satisfies (ClientOptions | ServiceClientOptions) as TOptions;
}

// TODO: Other policies we (maybe) need from before:
// - accept language
// - correlation ID
// - endpoint (per sovereign cloud config)
// - missing content type?
// - Byte order mark?
// - Status code?
// - MFA challenge
