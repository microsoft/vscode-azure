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
 * Answers from the cache when it can, and only then walks. The walk visits
 * tenants in listing order, so without the first pass a subscription the user
 * has already browsed to would still wait behind every uncached tenant ahead of
 * it. Since the tree caches whatever it lists, the common case -- resolving a
 * subscription the user just deployed into -- usually costs no request at all.
 *
 * The walk is concurrent even though it stops at the first match: listings past
 * the answer are cached, not wasted. It cannot prompt, since listing a tenant
 * probes for an existing session silently and the walk continues past failures.
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
    const matches = (subscription: AzureSubscription): boolean =>
        subscription.subscriptionId.toLowerCase() === subscriptionId.toLowerCase();

    for (const path of cache.walkCachedSubscriptions()) {
        if (matches(path.subscription)) {
            return path.subscription;
        }
    }

    for await (const path of cache.walkSubscriptions({ concurrency: DiscoveryConcurrency })) {
        if (matches(path.subscription)) {
            return path.subscription;
        }
    }

    return undefined;
}
