/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResourceClient } from '../rest/resources';

/**
 * Resolves the correct {@link ResourceClient} for a given account + tenant
 * pair. Each pair uses its own `TokenCredential`, so a separate client is
 * needed per identity.
 *
 * Implementations should cache/memoize client instances — creating a new
 * `ResourceClient` on every call is unnecessary.
 */
export type ResourceClientResolver = (accountId: string, tenantId: string) => ResourceClient;
