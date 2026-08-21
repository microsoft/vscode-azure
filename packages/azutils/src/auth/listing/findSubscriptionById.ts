/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '../AzureSubscription';
import { DiscoveryConcurrency, type AzureListingCache } from './AzureListingCache';

/**
 * Find the subscription with the given id, together with the tenant it is
 * reachable through -- the question a caller holding only a bare id cannot
 * answer for itself. ARM rejects a home-tenant token presented for a
 * subscription owned by another tenant with a 401.
 *
 * Walks concurrently even though it stops at the first match: listings past the
 * answer are cached, not wasted. It cannot prompt, since listing a tenant probes
 * for an existing session silently and the walk continues past failures.
 *
 * Unfiltered by design -- the filter governs what the tree *shows*, which is no
 * reason to be unable to authenticate to a subscription.
 *
 * @returns `undefined` when no signed-in account reaches the id, which callers
 * must degrade on rather than treat as an error.
 */
export async function findSubscriptionById(
    cache: AzureListingCache,
    subscriptionId: string,
): Promise<AzureSubscription | undefined> {
    const wanted = subscriptionId.toLowerCase();

    for await (const path of cache.walkSubscriptions({ concurrency: DiscoveryConcurrency })) {
        if (path.subscription.subscriptionId.toLowerCase() === wanted) {
            return path.subscription;
        }
    }

    return undefined;
}
