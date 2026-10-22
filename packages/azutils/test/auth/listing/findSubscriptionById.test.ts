/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as assert from 'node:assert';
import { AzureListingCache } from '../../../src/auth/listing/AzureListingCache';
import { findSubscriptionById } from '../../../src/auth/listing/findSubscriptionById';
import { SubscriptionTenantHints } from '../../../src/auth/listing/SubscriptionTenantHints';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant, type MockAzureListingFetcherOptions } from '../../mockAzure';

const account = makeAccount({ id: 'acct', label: 'Account' });
const tenantA = makeTenant({ accountId: account.id, tenantId: 'tenant-a', displayName: 'Tenant A' });
const tenantB = makeTenant({ accountId: account.id, tenantId: 'tenant-b', displayName: 'Tenant B' });
const subA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: 'sub-a', displayName: 'Sub A' });
const subB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: 'sub-b', displayName: 'Sub B' });

function createCache(options?: MockAzureListingFetcherOptions) {
    const fetcher = createMockAzureListingFetcher({
        accounts: [account],
        tenants: [tenantA, tenantB],
        subscriptions: [subA, subB],
        ...options,
    });
    const { executor } = createTestActionExecutor();
    return { fetcher, cache: new AzureListingCache(fetcher, executor) };
}

describe('findSubscriptionById (unit)', () => {
    it('names the tenant a subscription must be authenticated through', async () => {
        const { cache } = createCache();

        const resolved = await findSubscriptionById(cache, subB.subscriptionId);

        // The caller had only an id, and a token minted for any other tenant is
        // one ARM rejects.
        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        assert.strictEqual(resolved.accountId, account.id);
    });

    it('matches an id whose casing differs from the listing', async () => {
        const { cache } = createCache();

        const resolved = await findSubscriptionById(cache, subB.subscriptionId.toUpperCase());

        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
    });

    it('answers from the cache without listing any tenant the walk had not reached', async () => {
        const { cache, fetcher } = createCache();

        // Warm the cache the way the tree does: accounts, tenants, then tenant
        // B's subscriptions. B is last in the listing order.
        await cache.listAccounts();
        await collectAsync(cache.listTenants(account));
        await collectAsync(cache.listSubscriptions(tenantB));
        const beforeResolve = fetcher.fetchSubscriptions.mock.callCount();

        const resolved = await findSubscriptionById(cache, subB.subscriptionId);

        // The walk visits tenants in order, so without a cache-first pass this
        // would list tenant A -- work the answer never needed.
        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), beforeResolve,
            'a subscription already in the cache must cost no listing at all');
    });

    it('falls back to the walk for a subscription the cache cannot name', async () => {
        const { cache, fetcher } = createCache();

        await cache.listAccounts();
        await collectAsync(cache.listTenants(account));
        await collectAsync(cache.listSubscriptions(tenantA));

        const resolved = await findSubscriptionById(cache, subB.subscriptionId);

        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        assert.ok(fetcher.fetchSubscriptions.mock.calls.some(call => call.arguments[0].tenantId === tenantB.tenantId),
            'the uncached tenant must still be listed');
    });

    it('replays a listing the tree already paid for instead of re-fetching it', async () => {
        const { cache, fetcher } = createCache();

        await collectAsync(cache.listSubscriptions(tenantB));
        const resolved = await findSubscriptionById(cache, subB.subscriptionId);

        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        const timesListed = fetcher.fetchSubscriptions.mock.calls
            .filter(call => call.arguments[0].tenantId === tenantB.tenantId).length;
        assert.strictEqual(timesListed, 1, 'the cached tenant must be replayed, not listed a second time');
    });

    it('leaves what it listed in the cache, so the tree that follows pays nothing', async () => {
        const { cache, fetcher } = createCache();

        await findSubscriptionById(cache, subA.subscriptionId);
        const afterResolve = fetcher.fetchSubscriptions.mock.callCount();

        for (const page of await collectAsync(cache.listTenants(account))) {
            for (const tenant of page.items) {
                await collectAsync(cache.listSubscriptions(tenant));
            }
        }

        assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), afterResolve,
            'resolution is not throwaway work -- every listing it paid for is cached');
    });

    it('returns undefined when no signed-in account reaches the id', async () => {
        const { cache } = createCache();

        assert.strictEqual(await findSubscriptionById(cache, 'sub-nobody-has'), undefined);
    });

    it('keeps looking past a tenant that cannot be listed', async () => {
        const { cache } = createCache({
            signedOutTenantIds: [tenantA.tenantId],
        });

        // The answer lies beyond the unreachable tenant.
        const resolved = await findSubscriptionById(cache, subB.subscriptionId);

        assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
    });

    describe('with a tenant hint', () => {
        it('lists the hinted tenant without touching the tenants ahead of it', async () => {
            const { cache, fetcher } = createCache();
            const hints = new SubscriptionTenantHints();
            hints.record(subB.subscriptionId, tenantB.tenantId);

            const resolved = await findSubscriptionById(cache, subB.subscriptionId, hints);

            assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
            assert.ok(fetcher.fetchSubscriptions.mock.calls.every(call => call.arguments[0].tenantId === tenantB.tenantId),
                'only the hinted tenant should have been listed');
        });

        it('falls back to the walk when the hinted tenant does not hold the subscription', async () => {
            const { cache } = createCache();
            const hints = new SubscriptionTenantHints();
            hints.record(subB.subscriptionId, tenantA.tenantId);

            const resolved = await findSubscriptionById(cache, subB.subscriptionId, hints);

            assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        });

        it('falls back to the walk when the hinted tenant is not listed', async () => {
            const { cache } = createCache();
            const hints = new SubscriptionTenantHints();
            hints.record(subB.subscriptionId, 'tenant-unknown');

            const resolved = await findSubscriptionById(cache, subB.subscriptionId, hints);

            assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        });
    });
});
