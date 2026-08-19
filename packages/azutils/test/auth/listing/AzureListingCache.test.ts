/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as assert from 'node:assert';
import type { AzureListingFilter, AzureSubscriptionPath } from '../../../src/auth/listing/AzureListingCache';
import { AzureListingCache } from '../../../src/auth/listing/AzureListingCache';
import type { AzureListingNode } from '../../../src/auth/listing/AzureListingStore';
import { isSubscription, isTenant } from '../../../src/models/AzureNode';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant, type MockAzureListingFetcherOptions } from '../../mockAzure';

const account = makeAccount({ id: 'acct', label: 'Account' });
const tenantA = makeTenant({ accountId: account.id, tenantId: 'tenant-a', displayName: 'Tenant A' });
const tenantB = makeTenant({ accountId: account.id, tenantId: 'tenant-b', displayName: 'Tenant B' });
const subA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: 'sub-a', displayName: 'Sub A' });
const subB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: 'sub-b', displayName: 'Sub B' });

/** A cache over a mock fetcher holding two tenants with one subscription each. */
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

/** Admit only the named tenants (and everything that is not a tenant). */
function onlyTenants(...tenantIds: string[]): AzureListingFilter {
    return (node: AzureListingNode) => !isTenant(node) || tenantIds.includes(node.tenantId);
}

/** The tenant ids `fetchSubscriptions` was called for, in call order. */
function listedTenantIds(fetcher: ReturnType<typeof createCache>['fetcher']): string[] {
    return fetcher.fetchSubscriptions.mock.calls.map(call => call.arguments[0].tenantId);
}

function pathIds(paths: AzureSubscriptionPath[]): string[] {
    return paths.map(path => `${path.tenant.tenantId}/${path.subscription.subscriptionId}`);
}

describe('AzureListingCache (unit)', () => {
    describe('filtering (R1)', () => {
        it('issues no request for a tenant the filter excludes', async () => {
            const { cache, fetcher } = createCache();

            const paths = await collectAsync(cache.walkSubscriptions({ filter: onlyTenants('tenant-a') }));

            assert.deepStrictEqual(pathIds(paths), ['tenant-a/sub-a']);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a'],
                'an excluded tenant must not have its subscriptions listed -- doing so mints a tenant-scoped token');
        });

        it('does not hand an excluded tenant to a caller that would drill it', async () => {
            const { cache } = createCache();

            const pages = await collectAsync(cache.listTenants(account, { filter: onlyTenants('tenant-b') }));

            assert.deepStrictEqual(pages.flatMap(page => page.items.map(tenant => tenant.tenantId)), ['tenant-b']);
        });

        it('does not hand out an excluded subscription, which would be drillable', async () => {
            const { cache } = createCache();
            const filter: AzureListingFilter = node => !isSubscription(node) || node.subscriptionId === 'sub-a';

            const pages = await collectAsync(cache.listSubscriptions(tenantA, { filter }));
            const excluded = await collectAsync(cache.listSubscriptions(tenantB, { filter }));

            assert.deepStrictEqual(pages.flatMap(page => page.items.map(sub => sub.subscriptionId)), ['sub-a']);
            assert.deepStrictEqual(excluded.flatMap(page => page.items), []);
        });

        it('treats an absent filter as "everything", not "nothing"', async () => {
            const { cache } = createCache();

            const paths = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(paths), ['tenant-a/sub-a', 'tenant-b/sub-b']);
        });
    });

    describe('caching (R3, R3a)', () => {
        it('fetches only the delta when an unfiltered read follows a filtered one', async () => {
            const { cache, fetcher } = createCache();

            await collectAsync(cache.walkSubscriptions({ filter: onlyTenants('tenant-a') }));
            const all = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(all), ['tenant-a/sub-a', 'tenant-b/sub-b']);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b'],
                'the unfiltered pass must list only the tenant the filtered pass skipped');
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1, 'the tenant listing was already cached');
            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 1, 'the accounts listing was already cached');
        });

        it('caches what a filtered read fetched, filter or no filter', async () => {
            const { cache, fetcher } = createCache();

            await collectAsync(cache.walkSubscriptions({ filter: onlyTenants('tenant-a') }));
            fetcher.fetchSubscriptions.mock.resetCalls();
            const again = await collectAsync(cache.walkSubscriptions({ filter: onlyTenants('tenant-a') }));

            assert.deepStrictEqual(pathIds(again), ['tenant-a/sub-a']);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 0);
        });

        it('caches the items the filter excluded, so widening the filter needs no request', async () => {
            const otherSubA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: 'sub-a2', displayName: 'Sub A2' });
            const { cache, fetcher } = createCache({ subscriptions: [subA, otherSubA, subB] });
            const filter: AzureListingFilter = node => !isSubscription(node) || node.subscriptionId === 'sub-a';

            const narrowed = await collectAsync(cache.listSubscriptions(tenantA, { filter }));
            fetcher.fetchSubscriptions.mock.resetCalls();
            const all = await collectAsync(cache.listSubscriptions(tenantA));

            assert.deepStrictEqual(narrowed.flatMap(page => page.items.map(sub => sub.subscriptionId)), ['sub-a']);
            assert.deepStrictEqual(all.flatMap(page => page.items.map(sub => sub.subscriptionId)), ['sub-a', 'sub-a2'],
                'the cache holds unfiltered truth -- filtering on insert loses what the filter excluded');
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 0, 'the excluded subscription was already paid for');
        });

        it('issues nothing when only the filter changes', async () => {
            const { cache, fetcher } = createCache();

            await collectAsync(cache.walkSubscriptions());
            const before = fetcher.fetchSubscriptions.mock.callCount() + fetcher.fetchTenants.mock.callCount();
            const narrowed = await collectAsync(cache.walkSubscriptions({ filter: onlyTenants('tenant-b') }));
            const after = fetcher.fetchSubscriptions.mock.callCount() + fetcher.fetchTenants.mock.callCount();

            assert.deepStrictEqual(pathIds(narrowed), ['tenant-b/sub-b']);
            assert.strictEqual(after, before, 'a filter change makes no cached listing untrue');
        });
    });

    describe('multi-tenant subscriptions (R4)', () => {
        const shared = 'shared-sub';
        const viaA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: shared, displayName: 'Shared', homeTenantId: tenantB.tenantId });
        const viaB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: shared, displayName: 'Shared', homeTenantId: tenantB.tenantId });

        it('yields one node per tenant the subscription is reachable through', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });

            const paths = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(paths), [`tenant-a/${shared}`, `tenant-b/${shared}`]);
        });

        it('resolves a bare subscription id to the copy listed through its home tenant', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });
            await collectAsync(cache.walkSubscriptions());

            const resolved = await cache.findSubscription(shared);

            assert.strictEqual(resolved?.tenantId, tenantB.tenantId,
                'the tie-break must be explicit, not "whichever was cached first"');
        });

        it('honours a tenant hint over the tie-break', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });
            await collectAsync(cache.walkSubscriptions());

            const resolved = await cache.findSubscription(shared, { tenantId: tenantA.tenantId });

            assert.strictEqual(resolved?.tenantId, tenantA.tenantId);
        });
    });

    describe('lookup (R2)', () => {
        it('does not resolve, or request, a subscription in an excluded tenant', async () => {
            const { cache, fetcher } = createCache();

            const resolved = await cache.findSubscription('sub-b', { filter: onlyTenants('tenant-a') });

            assert.strictEqual(resolved, undefined, 'the caller degrades gracefully rather than prompting');
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a']);
        });

        it('does not resolve a cached subscription whose tenant the filter excludes', async () => {
            const { cache, fetcher } = createCache();
            // Pay for everything first, the way Select Subscriptions does, so
            // the excluded tenant's subscription is sitting in the cache.
            await collectAsync(cache.walkSubscriptions());
            fetcher.fetchSubscriptions.mock.resetCalls();

            // A filter that names only tenants still governs what lies beneath
            // them: a cached node is reached without passing through its
            // ancestors, so the lookup has to replay those levels itself.
            const resolved = await cache.findSubscription('sub-b', { filter: onlyTenants('tenant-a') });

            assert.strictEqual(resolved, undefined);
            assert.deepStrictEqual(listedTenantIds(fetcher), []);
        });

        it('answers from the cache without issuing anything', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());
            fetcher.fetchAccounts.mock.resetCalls();
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();

            const resolved = await cache.findSubscription('sub-b');

            assert.strictEqual(resolved?.subscriptionId, 'sub-b');
            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 0);
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 0);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 0);
        });

        it('narrows the walk to the tenant it was given', async () => {
            const { cache, fetcher } = createCache();

            const resolved = await cache.findSubscription('sub-b', { tenantId: tenantB.tenantId });

            assert.strictEqual(resolved?.subscriptionId, 'sub-b');
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-b']);
        });

        it('returns undefined for an id nothing exposes', async () => {
            const { cache } = createCache();

            assert.strictEqual(await cache.findSubscription('no-such-sub'), undefined);
        });
    });

    describe('failure isolation (R7)', () => {
        it('keeps walking when a tenant cannot be listed', async () => {
            const { cache } = createCache({ unreachableTenantIds: [tenantA.tenantId] });
            const failures: string[] = [];

            const paths = await collectAsync(cache.walkSubscriptions({
                onFailure: failure => failures.push(failure.tenant?.tenantId ?? '<account>'),
            }));

            assert.deepStrictEqual(pathIds(paths), ['tenant-b/sub-b'], 'every other subscription is still offered');
            assert.deepStrictEqual(failures, ['tenant-a']);
        });

        it('retries a failed listing on the next read', async () => {
            const { cache, fetcher } = createCache({ unreachableTenantIds: [tenantA.tenantId] });
            await collectAsync(cache.walkSubscriptions({ onFailure: () => undefined }));

            await collectAsync(cache.walkSubscriptions({ onFailure: () => undefined }));

            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b', 'tenant-a'],
                'the failed listing is retried; the successful one is not');
        });
    });

    describe('invalidation (R5, R6)', () => {
        it('re-lists accounts without discarding what is cached beneath them', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            await cache.refreshAccounts();

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 2, 'the memo must not answer "did it change?"');
            await collectAsync(cache.walkSubscriptions());
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 2);
        });

        it('seeds the fresh accounts back, so the re-list that follows is free', async () => {
            const { cache, fetcher } = createCache();

            await cache.refreshAccounts();
            await cache.listAccounts();

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 1);
        });

        it('evicts one account subtree and leaves the others alone', async () => {
            const other = makeAccount({ id: 'other-acct', label: 'Other' });
            const otherTenant = makeTenant({ accountId: other.id, tenantId: 'tenant-c' });
            const otherSub = makeSubscription({ accountId: other.id, tenantId: otherTenant.tenantId, subscriptionId: 'sub-c' });
            const { cache, fetcher } = createCache({
                accounts: [account, other],
                tenants: [tenantA, tenantB, otherTenant],
                subscriptions: [subA, subB, otherSub],
            });
            await collectAsync(cache.walkSubscriptions());

            cache.clearAccount(account.id);
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(fetcher.fetchTenants.mock.calls.map(call => call.arguments[0].id), [account.id]);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b']);
        });

        it('re-lists what is under an account that signed in, keeping the account', async () => {
            // The home tenant is listed second, so the cached lookup and the
            // walk fallthrough disagree -- which is what makes it observable
            // whether the account survived as a cached node.
            const shared = 'shared-sub';
            const viaA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: shared, homeTenantId: tenantB.tenantId });
            const viaB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: shared, homeTenantId: tenantB.tenantId });
            const { cache, fetcher } = createCache({ subscriptions: [viaA, viaB] });
            await collectAsync(cache.walkSubscriptions());

            // What Sign In does: the account set may have changed, and anything
            // listed under this account predates an authorization that may have
            // widened it.
            await cache.refreshAccounts();
            cache.clearAccountContents(account.id);
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b']);

            // Evicting the account instead would only unindex it -- it stays in
            // the accounts listing, which replays rather than re-indexing -- so
            // it could never be looked up again. A filtered lookup has to check
            // a cached node's ancestors, so it would miss and fall through to a
            // walk, taking first-match order instead of the tie-break.
            const resolved = await cache.findSubscription(shared, { filter: onlyTenants('tenant-a', 'tenant-b') });
            assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        });

        it('discards everything when the data itself stops being true', async () => {            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.clear();
            await collectAsync(cache.walkSubscriptions());

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 2);
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 2);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 4);
        });
    });

    describe('paging (R8)', () => {
        it('pulls only the pages the reader asks for', async () => {
            const extraTenants = Array.from({ length: 4 }, (_unused, index) => makeTenant({
                accountId: account.id,
                tenantId: `tenant-${index}`,
            }));
            const { cache } = createCache({ tenants: extraTenants, subscriptions: [], pageSize: 1 });

            const first: string[] = [];
            for await (const page of cache.listTenants(account)) {
                first.push(...page.items.map(tenant => tenant.tenantId));
                break;
            }

            assert.deepStrictEqual(first, ['tenant-0']);
        });
    });
});
