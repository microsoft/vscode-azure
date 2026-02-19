/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored REST client factory for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

import type { ClientOptions } from '@azure-rest/core-client';
import { getClient } from '@azure-rest/core-client';
import type { TokenCredential } from '@azure/core-auth';
import type { ResourceClient } from './clientDefinitions.js';

/** Optional parameters for the ResourceClient. */
export interface ResourceClientOptions extends ClientOptions {
    /** The API version to use. Defaults to "2024-03-01". */
    apiVersion?: string;
}

/**
 * Creates a new ResourceClient for the Microsoft.Resources API.
 *
 * @param credentials - A TokenCredential for authenticating requests.
 * @param options - Optional client configuration.
 * @returns A ResourceClient instance.
 *
 * @example
 * ```ts
 * import createResourceClient from './resourceClient/index.js';
 *
 * const client = createResourceClient(credential);
 * const groups = await client.path("/subscriptions/{subscriptionId}/resourcegroups", subscriptionId).get();
 * const resources = await client.path("/subscriptions/{subscriptionId}/resources", subscriptionId).get();
 * ```
 */
export default function createClient(
    credentials: TokenCredential,
    { apiVersion = '2024-03-01', ...options }: ResourceClientOptions = {},
): ResourceClient {
    const endpointUrl = options.endpoint ?? `https://management.azure.com`;
    const userAgentInfo = `azsdk-js-arm-resources-rest/1.0.0-beta.1`;
    const userAgentPrefix =
        options.userAgentOptions?.userAgentPrefix
            ? `${options.userAgentOptions.userAgentPrefix} ${userAgentInfo}`
            : userAgentInfo;

    const client = getClient(endpointUrl, credentials, {
        ...options,
        userAgentOptions: { userAgentPrefix },
        credentials: {
            scopes: options.credentials?.scopes ?? [`${endpointUrl}/.default`],
        },
    }) as ResourceClient;

    client.pipeline.removePolicy({ name: 'ApiVersionPolicy' });

    if (apiVersion) {
        client.pipeline.addPolicy({
            name: 'ClientApiVersionPolicy',
            sendRequest: (req, next) => {
                // Use the apiVersion defined in request url directly.
                // Append one if there is no apiVersion and we have one at client options.
                const url = new URL(req.url);
                if (!url.searchParams.get('api-version')) {
                    req.url = `${req.url}${Array.from(url.searchParams.keys()).length > 0 ? '&' : '?'}api-version=${apiVersion}`;
                }
                return next(req);
            },
        });
    }

    return client;
}
