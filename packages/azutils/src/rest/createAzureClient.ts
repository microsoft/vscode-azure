/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientOptions } from '@azure-rest/core-client';
import { DedupeRequestPipelinePolicy } from './pipeline/DedupeRequestPipelinePolicy';

export function createAzureClient<TClient extends Client, TOptions extends ClientOptions>(
    getClient: (options?: TOptions) => TClient,
    options?: TOptions,
): Promise<TClient> {
    return Promise.resolve(
        getClient(
            applyDefaults(options)
        )
    );
}

function applyDefaults<TOptions extends ClientOptions>(options?: TOptions): TOptions {
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
    } satisfies ClientOptions as TOptions;
}

// TODO: Other policies we (maybe) need from before:
// - User agent? prefix of `${extensionName}/${extensionVersion}`
// - accept language
// - correlation ID
// - endpoint (per sovereign cloud config)
// - missing content type?
// - Byte order mark?
// - Status code?
// - Insecure connection? (no way?)
// - MFA challenge
// - Basic auth? (no way?)
