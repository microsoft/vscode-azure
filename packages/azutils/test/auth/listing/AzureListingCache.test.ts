/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync, type Page } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as assert from 'node:assert';
import type { AzureSubscriptionPath, AzureTenantFilter } from '../../../src/auth/listing/AzureListingCache';
import { AzureListingCache } from '../../../src/auth/listing/AzureListingCache';
import type { AzureSubscription, AzureTenant } from '../../../src/auth/AzureSubscription';
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

/** Admit only the named tenants. */
function onlyTenants(...tenantIds: string[]): AzureTenantFilter {
    return (tenant: AzureTenant) => tenantIds.includes(tenant.tenantId);
}

/** The tenant ids `fetchSubscriptions` was called for, in call order. */
function listedTenantIds(fetcher: ReturnType<typeof createCache>['fetcher']): string[] {
    return fetcher.fetchSubscriptions.mock.calls.map(call => call.arguments[0].tenantId);
}

/** The account ids `fetchTenants` was called for, in call order. */
function listedAccountIds(fetcher: ReturnType<typeof createCache>['fetcher']): string[] {
    return fetcher.fetchTenants.mock.calls.map(call => call.arguments[0].id);
}

function pathIds(paths: AzureSubscriptionPath[]): string[] {
    return paths.map(path => `${path.tenant.tenantId}/${path.subscription.subscriptionId}`);
}

function subscriptionIds(pages: Array<Page<AzureSubscription>>): string[] {
    return pages.flatMap(page => page.items.map(sub => sub.subscriptionId));
}

function tenantIds(pages: Array<Page<AzureTenant>>): string[] {
    return pages.flatMap(page => page.items.map(tenant => tenant.tenantId));
}

describe('AzureListingCache (unit)', () => {
    describe('filtering', () => {
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

            assert.deepStrictEqual(tenantIds(pages), ['tenant-b']);
        });

        it('treats an absent filter as "everything", not "nothing"', async () => {
            const { cache } = createCache();

            const paths = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(paths), ['tenant-a/sub-a', 'tenant-b/sub-b']);
        });

        it('lists every subscription of an admitted tenant, leaving the choice to the caller', async () => {
            const otherSubA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: 'sub-a2' });
            const { cache } = createCache({ subscriptions: [subA, otherSubA, subB] });

            const pages = await collectAsync(cache.listSubscriptions(tenantA));

            assert.deepStrictEqual(subscriptionIds(pages), ['sub-a', 'sub-a2'],
                'the token and the listing are already paid for; which to show is the consumer\'s business');
        });
    });

    describe('caching', () => {
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

        it('caches the tenants the filter excluded, so widening it needs no request', async () => {
            const { cache, fetcher } = createCache();

            const narrowed = await collectAsync(cache.listTenants(account, { filter: onlyTenants('tenant-a') }));
            fetcher.fetchTenants.mock.resetCalls();
            const all = await collectAsync(cache.listTenants(account));

            assert.deepStrictEqual(tenantIds(narrowed), ['tenant-a']);
            assert.deepStrictEqual(tenantIds(all), ['tenant-a', 'tenant-b'],
                'the cache holds unfiltered truth -- filtering on insert loses what the filter excluded');
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 0, 'the excluded tenant was already paid for');
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

        it('collapses concurrent reads of one listing into a single fetch', async () => {
            const pulled: string[] = [];
            const { cache, fetcher } = createCache({
                pageSize: 1,
                onPagePulled: (listing, index) => pulled.push(`${listing}-${index}`),
            });

            const [first, second] = await Promise.all([
                collectAsync(cache.listTenants(account)),
                collectAsync(cache.listTenants(account)),
            ]);

            assert.deepStrictEqual(tenantIds(first), ['tenant-a', 'tenant-b']);
            assert.deepStrictEqual(tenantIds(second), tenantIds(first));
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1);
            assert.deepStrictEqual(pulled, ['tenants-0', 'tenants-1'],
                'concurrent readers must share pulls, not duplicate them');
        });
    });

    describe('multi-tenant subscriptions', () => {
        const shared = 'shared-sub';
        const viaA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: shared, displayName: 'Shared' });
        const viaB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: shared, displayName: 'Shared' });

        it('yields one node per tenant the subscription is reachable through', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });

            const paths = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(paths), [`tenant-a/${shared}`, `tenant-b/${shared}`]);
        });

        it('resolves a bare subscription id to the first copy in walk order', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });
            await collectAsync(cache.walkSubscriptions());

            const resolved = await cache.findSubscription(shared);

            assert.strictEqual(resolved?.tenantId, tenantA.tenantId);
        });

        it('honours a tenant hint over walk order', async () => {
            const { cache } = createCache({ subscriptions: [viaA, viaB] });
            await collectAsync(cache.walkSubscriptions());

            const resolved = await cache.findSubscription(shared, { tenantId: tenantB.tenantId });

            assert.strictEqual(resolved?.tenantId, tenantB.tenantId);
        });
    });

    describe('lookup', () => {
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

            const resolved = await cache.findSubscription('sub-b', { filter: onlyTenants('tenant-a') });

            assert.strictEqual(resolved, undefined,
                'a cached subscription is reached by descending through its tenant, so the filter governs it too');
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

        it('reads past the page a tree stopped at without paging it further', async () => {
            const extraTenants = Array.from({ length: 3 }, (_unused, index) => makeTenant({
                accountId: account.id,
                tenantId: `tenant-${index}`,
            }));
            const target = makeSubscription({ accountId: account.id, tenantId: 'tenant-2', subscriptionId: 'sub-late' });
            const { cache, fetcher } = createCache({ tenants: extraTenants, subscriptions: [target], pageSize: 1 });

            // A tree that rendered only the first page leaves the rest unpulled.
            await cache.listTenants(account)[Symbol.asyncIterator]().next();
            const resolved = await cache.findSubscription('sub-late');

            assert.strictEqual(resolved?.subscriptionId, 'sub-late',
                'the cached pass misses, so the real walk must still be able to find it');
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-0', 'tenant-1', 'tenant-2']);
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

    describe('failure isolation', () => {
        it('keeps walking when a tenant cannot be listed', async () => {
            const { cache } = createCache({ unreachableTenantIds: [tenantA.tenantId] });
            const failures: string[] = [];

            const paths = await collectAsync(cache.walkSubscriptions({
                onFailure: failure => failures.push(failure.tenant?.tenantId ?? '<account>'),
            }));

            assert.deepStrictEqual(pathIds(paths), ['tenant-b/sub-b'], 'every other subscription is still offered');
            assert.deepStrictEqual(failures, ['tenant-a']);
        });

        it('retries a failed listing on the next read, and only that one', async () => {
            const { cache, fetcher } = createCache({ unreachableTenantIds: [tenantA.tenantId] });
            await collectAsync(cache.walkSubscriptions({ onFailure: () => undefined }));

            await collectAsync(cache.walkSubscriptions({ onFailure: () => undefined }));

            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b', 'tenant-a'],
                'the failed listing is retried; the successful one is not');
        });

        it('serves a whole listing on the retry, never a truncated one', async () => {
            const { cache, fetcher } = createCache();
            fetcher.fetchSubscriptions.mock.mockImplementation(flakySubscriptions(tenantA));

            await assert.rejects(() => collectAsync(cache.listSubscriptions(tenantA)), /listing failed/);
            const retried = await collectAsync(cache.listSubscriptions(tenantA));

            assert.deepStrictEqual(subscriptionIds(retried), ['attempt-2-0', 'attempt-2-1', 'attempt-2-2'],
                'replaying the pages the failed attempt collected would serve a prefix as if it were the whole listing');
        });

        it('fails a reader that had advanced into a listing that then failed', async () => {
            const { cache, fetcher } = createCache();
            fetcher.fetchSubscriptions.mock.mockImplementation(flakySubscriptions(tenantA));

            // Advance one reader into the listing, then let a second reader
            // drive the pull that fails.
            const reader = cache.listSubscriptions(tenantA)[Symbol.asyncIterator]();
            const nextIds = async () => subscriptionIds([(await reader.next()).value as Page<AzureSubscription>]);
            assert.deepStrictEqual(await nextIds(), ['attempt-1-0']);
            assert.deepStrictEqual(await nextIds(), ['attempt-1-1']);

            await assert.rejects(() => collectAsync(cache.listSubscriptions(tenantA)), /listing failed/);
            await assert.rejects(() => reader.next(), /listing failed/,
                'resuming would splice a later attempt\'s tail onto this attempt\'s head');
        });
    });

    describe('invalidation', () => {
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

        it('re-enumerates one account\'s tenants while keeping their subscriptions', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateTenants(account.id);
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [account.id], 'the tenant set is re-asked');
            assert.deepStrictEqual(listedTenantIds(fetcher), [],
                'tenants come back under the keys they had, so their subscriptions re-attach untouched');
        });

        it('re-enumerates one account\'s tenants and leaves the other accounts alone', async () => {
            const other = makeAccount({ id: 'other-acct', label: 'Other' });
            const otherTenant = makeTenant({ accountId: other.id, tenantId: 'tenant-c' });
            const otherSub = makeSubscription({ accountId: other.id, tenantId: otherTenant.tenantId, subscriptionId: 'sub-c' });
            const { cache, fetcher } = createCache({
                accounts: [account, other],
                tenants: [tenantA, tenantB, otherTenant],
                subscriptions: [subA, subB, otherSub],
            });
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateTenants(account.id);
            fetcher.fetchTenants.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [account.id]);
        });

        it('re-enumerates an account whose id differs only by case', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateTenants(account.id.toUpperCase());
            fetcher.fetchTenants.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [account.id],
                'account ids are case-insensitive, so a differently-cased id names the same listing');
        });

        it('does not re-enumerate an account whose id merely starts with the named one', async () => {
            // A VS Code account id is an opaque provider string and may contain
            // the separator the cache keys with.
            const nested = makeAccount({ id: 'acct/tenant', label: 'Nested' });
            const nestedTenant = makeTenant({ accountId: nested.id, tenantId: 'tenant-n' });
            const { cache, fetcher } = createCache({
                accounts: [account, nested],
                tenants: [tenantA, tenantB, nestedTenant],
                subscriptions: [subA, subB],
            });
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateTenants(account.id);
            fetcher.fetchTenants.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [account.id],
                'the other account must survive -- its key is not the same, only a textual prefix match');
        });

        it('re-enumerates one tenant\'s subscriptions and no other listing', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateSubscriptions(account.id, tenantA.tenantId);
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [], 'the tenant set itself did not change');
            assert.deepStrictEqual(listedTenantIds(fetcher), [tenantA.tenantId],
                'signing in to one tenant says nothing about what another tenant contains');
        });

        it('keeps a signed-out account\'s listings, since nothing can reach them', async () => {
            // Sign-out is modelled by the account leaving the accounts listing.
            // Its tenants and subscriptions are then unreachable -- a node is
            // only reachable by descending the listing that produced it -- so
            // they are kept, and a re-sign-in costs nothing.
            const accounts = [account];
            const { cache, fetcher } = createCache({ accounts });
            await collectAsync(cache.walkSubscriptions());

            accounts.length = 0;
            await cache.refreshAccounts();
            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), []);

            accounts.push(account);
            await cache.refreshAccounts();
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();

            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), ['tenant-a/sub-a', 'tenant-b/sub-b']);
            assert.deepStrictEqual(listedAccountIds(fetcher), [], 'the signing-out must not have discarded the tenant listing');
            assert.deepStrictEqual(listedTenantIds(fetcher), []);
        });

        it('discards everything only when asked outright', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.clear();
            await collectAsync(cache.walkSubscriptions());

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 2);
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 2);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 4);
        });
    });

    describe('manually named tenants', () => {
        const namedId = 'AAAAAAAA-1111-2222-3333-444455556666';

        /** A cache whose named tenants come from a mutable array, as the setting does. */
        function createNamedCache(named: string[], options?: MockAzureListingFetcherOptions) {
            const fetcher = createMockAzureListingFetcher({
                accounts: [account],
                tenants: [tenantA],
                subscriptions: [subA],
                ...options,
            });
            const { executor } = createTestActionExecutor();
            return { fetcher, cache: new AzureListingCache(fetcher, executor, { additionalTenantIds: () => named }) };
        }

        it('merges named tenants into the terminal page', async () => {
            const { cache } = createNamedCache([namedId]);

            const pages = await collectAsync(cache.listTenants(account));

            assert.deepStrictEqual(tenantIds(pages), [tenantA.tenantId, namedId.toLowerCase()]);
            assert.strictEqual(pages[pages.length - 1].hasMore, false);
            assert.strictEqual(pages[pages.length - 1].items[1].displayName, namedId,
                'the id stands in as the name until something upgrades it');
        });

        it('reaches a named tenant when listing tenants is blocked outright', async () => {
            const { cache } = createNamedCache([namedId], { unlistableAccountIds: [account.id] });

            assert.deepStrictEqual(tenantIds(await collectAsync(cache.listTenants(account))), [namedId.toLowerCase()]);
        });

        it('keeps the listed display name for a tenant that is also named', async () => {
            const { cache } = createNamedCache([tenantA.tenantId.toUpperCase()]);

            const pages = await collectAsync(cache.listTenants(account));

            assert.deepStrictEqual(tenantIds(pages), [tenantA.tenantId]);
            assert.deepStrictEqual(pages[0].items.map(tenant => tenant.displayName), [tenantA.displayName]);
        });

        it('deduplicates named ids that differ only in casing', async () => {
            const { cache } = createNamedCache([namedId, namedId.toLowerCase()], { tenants: [] });

            assert.deepStrictEqual(tenantIds(await collectAsync(cache.listTenants(account))), [namedId.toLowerCase()]);
        });

        it('adds a newly named tenant without re-listing anything', async () => {
            const named: string[] = [];
            const { cache, fetcher } = createNamedCache(named);
            await collectAsync(cache.walkSubscriptions());
            fetcher.fetchAccounts.mock.resetCalls();
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();

            // The setting is written; nothing tells the cache.
            named.push(namedId);
            const paths = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(paths), ['tenant-a/sub-a'], 'the new tenant has no subscriptions in the fixture');
            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 0, 'naming a tenant falsifies no listing');
            assert.deepStrictEqual(listedAccountIds(fetcher), [], 'the account\'s tenant listing is re-merged, not re-fetched');
            assert.deepStrictEqual(listedTenantIds(fetcher), [namedId.toLowerCase()],
                'only the tenant nothing had listed yet costs a request');
        });

        it('stops listing a tenant that is no longer named, keeping its subscriptions cached', async () => {
            const namedSub = makeSubscription({ accountId: account.id, tenantId: namedId.toLowerCase(), subscriptionId: 'sub-n' });
            const named = [namedId];
            const { cache, fetcher } = createNamedCache(named, { subscriptions: [subA, namedSub] });
            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), ['tenant-a/sub-a', `${namedId.toLowerCase()}/sub-n`]);

            named.length = 0;
            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), ['tenant-a/sub-a'],
                'an unnamed tenant stops appearing');

            named.push(namedId);
            fetcher.fetchSubscriptions.mock.resetCalls();
            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), ['tenant-a/sub-a', `${namedId.toLowerCase()}/sub-n`]);
            assert.deepStrictEqual(listedTenantIds(fetcher), [],
                'un-naming must hide the tenant, not discard what it cost to list');
        });
    });

    describe('paging', () => {
        it('pulls only the pages the reader asks for', async () => {
            const extraTenants = Array.from({ length: 4 }, (_unused, index) => makeTenant({
                accountId: account.id,
                tenantId: `tenant-${index}`,
            }));
            const pulled: string[] = [];
            const { cache } = createCache({
                tenants: extraTenants,
                subscriptions: [],
                pageSize: 1,
                onPagePulled: (listing, index) => pulled.push(`${listing}-${index}`),
            });

            const first: string[] = [];
            for await (const page of cache.listTenants(account)) {
                first.push(...page.items.map(tenant => tenant.tenantId));
                break;
            }

            assert.deepStrictEqual(first, ['tenant-0']);
            assert.deepStrictEqual(pulled, ['tenants-0'],
                'a reader that stopped after one page must not have provoked more');
        });

        it('resumes a partially-read listing instead of restarting it', async () => {
            const extraTenants = Array.from({ length: 3 }, (_unused, index) => makeTenant({
                accountId: account.id,
                tenantId: `tenant-${index}`,
            }));
            const pulled: string[] = [];
            const { cache, fetcher } = createCache({
                tenants: extraTenants,
                subscriptions: [],
                pageSize: 1,
                onPagePulled: (listing, index) => pulled.push(`${listing}-${index}`),
            });

            await cache.listTenants(account)[Symbol.asyncIterator]().next();
            const all = await collectAsync(cache.listTenants(account));

            assert.deepStrictEqual(tenantIds(all), ['tenant-0', 'tenant-1', 'tenant-2']);
            assert.deepStrictEqual(pulled, ['tenants-0', 'tenants-1', 'tenants-2'],
                'each page must be produced exactly once');
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1);
        });

        it('replays a completed listing without touching the source', async () => {
            const pulled: string[] = [];
            const { cache } = createCache({
                pageSize: 1,
                onPagePulled: (listing, index) => pulled.push(`${listing}-${index}`),
            });

            const first = await collectAsync(cache.listTenants(account));
            const second = await collectAsync(cache.listTenants(account));

            assert.deepStrictEqual(tenantIds(first), ['tenant-a', 'tenant-b']);
            assert.deepStrictEqual(tenantIds(second), tenantIds(first));
            assert.deepStrictEqual(pulled, ['tenants-0', 'tenants-1']);
        });
    });
});

/**
 * A subscription listing for `tenant` that throws partway through its first
 * attempt and streams three pages on every attempt after that.
 */
function flakySubscriptions(tenant: AzureTenant) {
    let attempt = 0;
    return function (): AsyncIterable<Page<AzureSubscription>> {
        const current = ++attempt;
        return (async function* () {
            for (let index = 0; index < 3; index++) {
                if (current === 1 && index === 2) {
                    throw new Error('listing failed');
                }
                yield await Promise.resolve({
                    items: [makeSubscription({
                        accountId: tenant.accountId,
                        tenantId: tenant.tenantId,
                        subscriptionId: `attempt-${current}-${index}`,
                    })],
                    hasMore: index < 2,
                });
            }
        })();
    };
}
