/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '../AzureSubscription';
import { DiscoveryConcurrency, type AzureListingCache } from './AzureListingCache';
import type { SubscriptionTenantHints } from './SubscriptionTenantHints';

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
 * When `hints` holds a tenant a service already confirmed for this id, that
 * tenant is listed before the walk starts, so a subscription outside everything
 * the tree has browsed is found without enumerating the rest. A hint that leads
 * nowhere -- the tenant is no longer listed, or listing it fails -- costs
 * nothing but the walk that follows.
 *
 * Unfiltered by design -- the filter governs what the tree *shows*, which is no
 * reason to be unable to authenticate to a subscription.
 *
 * @param hints - (Optional) Tenants confirmed for subscription ids, consulted
 * before the walk.
 * @returns `undefined` when no signed-in account reaches the id, which callers
 * must degrade on rather than treat as an error.
 */
export async function findSubscriptionById(
    cache: AzureListingCache,
    subscriptionId: string,
    hints?: SubscriptionTenantHints,
): Promise<AzureSubscription | undefined> {
    const matches = (subscription: AzureSubscription): boolean =>
        subscription.subscriptionId.toLowerCase() === subscriptionId.toLowerCase();

    for (const path of cache.walkCachedSubscriptions()) {
        if (matches(path.subscription)) {
            return path.subscription;
        }
    }

    const hinted = await findInHintedTenant(cache, subscriptionId, hints?.get(subscriptionId));
    if (hinted) {
        return hinted;
    }

    for await (const path of cache.walkSubscriptions({ concurrency: DiscoveryConcurrency })) {
        if (matches(path.subscription)) {
            return path.subscription;
        }
    }

    return undefined;
}

/**
 * List only the hinted tenant, under every account that reaches it, looking for
 * the subscription. Never throws: a hint is an optimization, so any failure
 * leaves the caller to the full walk.
 */
async function findInHintedTenant(
    cache: AzureListingCache,
    subscriptionId: string,
    tenantId: string | undefined,
): Promise<AzureSubscription | undefined> {
    if (!tenantId) {
        return undefined;
    }

    const wantedSubscription = subscriptionId.toLowerCase();
    const wantedTenant = tenantId.toLowerCase();
    try {
        for (const account of await cache.listAccounts()) {
            for await (const tenantPage of cache.listTenants(account)) {
                for (const tenant of tenantPage.items.filter(candidate => candidate.tenantId.toLowerCase() === wantedTenant)) {
                    for await (const subscriptionPage of cache.listSubscriptions(tenant)) {
                        const match = subscriptionPage.items.find(subscription => subscription.subscriptionId.toLowerCase() === wantedSubscription);
                        if (match) {
                            return match;
                        }
                    }
                }
            }
        }
    } catch {
        return undefined;
    }

    return undefined;
}
