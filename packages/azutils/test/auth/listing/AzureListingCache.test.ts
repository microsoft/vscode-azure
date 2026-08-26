/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync, delay, type Page } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as assert from 'node:assert';
import type { AzureListingFailure, AzureSubscriptionPath, AzureTenantFilter } from '../../../src/auth/listing/AzureListingCache';
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

/**
 * The descent the tree's view layer makes: list an account's tenants through the
 * filter, then drill each one it admitted.
 *
 * The filter is deliberately applied by `listTenants` rather than by this
 * helper, because that is the whole guarantee under test -- an excluded tenant
 * must never reach the code that would drill it.
 */
async function treeRead(cache: AzureListingCache, filter?: AzureTenantFilter): Promise<string[]> {
    const paths: string[] = [];
    for (const page of await collectAsync(cache.listTenants(account, filter))) {
        for (const tenant of page.items) {
            for (const subPage of await collectAsync(cache.listSubscriptions(tenant))) {
                paths.push(...subPage.items.map(sub => `${tenant.tenantId}/${sub.subscriptionId}`));
            }
        }
    }
    return paths;
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

            const paths = await treeRead(cache, onlyTenants('tenant-a'));

            assert.deepStrictEqual(paths, ['tenant-a/sub-a']);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a'],
                'an excluded tenant must not have its subscriptions listed -- doing so mints a tenant-scoped token');
        });

        it('does not hand an excluded tenant to a caller that would drill it', async () => {
            const { cache } = createCache();

            const pages = await collectAsync(cache.listTenants(account, onlyTenants('tenant-b')));

            assert.deepStrictEqual(tenantIds(pages), ['tenant-b']);
        });

        it('treats an absent filter as "everything", not "nothing"', async () => {
            const { cache } = createCache();

            assert.deepStrictEqual(await treeRead(cache), ['tenant-a/sub-a', 'tenant-b/sub-b']);
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
        it('fetches only the delta when the pick list follows a filtered tree read', async () => {
            const { cache, fetcher } = createCache();

            // The tree: expand the account through the filter, then drill each
            // tenant it admitted.
            await treeRead(cache, onlyTenants('tenant-a'));
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a'],
                'the excluded tenant must cost nothing: no tenant-scoped token, no listing');

            // Select Subscriptions: unfiltered, because it edits the filter.
            const all = await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(pathIds(all), ['tenant-a/sub-a', 'tenant-b/sub-b']);
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a', 'tenant-b'],
                'only the tenant the tree skipped is paid for; the one it loaded must not be re-listed');
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1, 'the tenant listing was already cached');
            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 1, 'the accounts were already cached');
        });

        it('caches what a filtered read fetched, filter or no filter', async () => {
            const { cache, fetcher } = createCache();

            await treeRead(cache, onlyTenants('tenant-a'));
            fetcher.fetchSubscriptions.mock.resetCalls();
            const again = await treeRead(cache, onlyTenants('tenant-a'));

            assert.deepStrictEqual(again, ['tenant-a/sub-a']);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 0);
        });

        it('caches the tenants the filter excluded, so widening it needs no request', async () => {
            const { cache, fetcher } = createCache();

            const narrowed = await collectAsync(cache.listTenants(account, onlyTenants('tenant-a')));
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
            const narrowed = await treeRead(cache, onlyTenants('tenant-b'));
            const after = fetcher.fetchSubscriptions.mock.callCount() + fetcher.fetchTenants.mock.callCount();

            assert.deepStrictEqual(narrowed, ['tenant-b/sub-b']);
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

        it('keeps walking when an account\'s tenants cannot be listed', async () => {
            const otherAccount = makeAccount({ id: 'acct-2', label: 'Other' });
            const otherTenant = makeTenant({ accountId: otherAccount.id, tenantId: 'tenant-c' });
            const otherSub = makeSubscription({ accountId: otherAccount.id, tenantId: otherTenant.tenantId, subscriptionId: 'sub-c' });
            const { cache } = createCache({
                accounts: [account, otherAccount],
                tenants: [tenantA, otherTenant],
                subscriptions: [subA, otherSub],
                unlistableAccountIds: [account.id],
            });
            const failures: AzureListingFailure[] = [];

            const paths = await collectAsync(cache.walkSubscriptions({ onFailure: failure => failures.push(failure) }));

            assert.deepStrictEqual(pathIds(paths), ['tenant-c/sub-c'],
                'one account that cannot enumerate its tenants must not cost the user every other account');
            assert.deepStrictEqual(failures.map(failure => failure.account.id), [account.id]);
            assert.strictEqual(failures[0].tenant, undefined, 'the account itself failed, not a tenant under it');
        });

        it('retries an account\'s tenants after a failed listing, rather than caching it as empty', async () => {
            const { cache, fetcher } = createCache({ unlistableAccountIds: [account.id] });

            assert.deepStrictEqual(await treeRead(cache), [], 'the listing failed, so nothing is reachable');

            // The failure must not have been retained as a complete, empty
            // listing -- a transient one would otherwise blank the account for
            // the rest of the session, recoverable only by an explicit refresh.
            fetcher.fetchTenants.mock.mockImplementation(createMockAzureListingFetcher({
                accounts: [account],
                tenants: [tenantA, tenantB],
                subscriptions: [subA, subB],
            }).fetchTenants);

            assert.deepStrictEqual(await treeRead(cache), ['tenant-a/sub-a', 'tenant-b/sub-b']);
        });
    });

    describe('walk concurrency', () => {
        /**
         * A cache over `count` tenants whose subscription listings each take a
         * measurable moment, recording how many were ever in flight at once.
         */
        function createOverlappingCache(count: number) {
            const many = Array.from({ length: count }, (_unused, index) => makeTenant({
                accountId: account.id,
                tenantId: `tenant-${index}`,
            }));
            const subs = many.map(tenant => makeSubscription({
                accountId: account.id,
                tenantId: tenant.tenantId,
                subscriptionId: `sub-${tenant.tenantId}`,
            }));
            const { cache, fetcher } = createCache({ tenants: many, subscriptions: subs });

            let active = 0;
            let peak = 0;
            fetcher.fetchSubscriptions.mock.mockImplementation((tenant: AzureTenant) => (async function* () {
                active++;
                peak = Math.max(peak, active);
                await delay(10);
                active--;
                yield { items: subs.filter(sub => sub.tenantId === tenant.tenantId), hasMore: false };
            })());

            return { cache, peak: () => peak };
        }

        it('lists one tenant at a time unless asked otherwise', async () => {
            const { cache, peak } = createOverlappingCache(6);

            await collectAsync(cache.walkSubscriptions());

            assert.strictEqual(peak(), 1,
                'a walk that may stop early must not mint tokens for tenants past the one being read');
        });

        it('lists no further tenant when the reader stops early', async () => {
            const { cache, fetcher } = createCache();

            for await (const path of cache.walkSubscriptions()) {
                assert.ok(path);
                break;
            }

            // The reason the default window is 1: a wider one would have tenants
            // in flight past the one being read, minting tokens for tenants the
            // reader turned out not to want.
            assert.deepStrictEqual(listedTenantIds(fetcher), ['tenant-a']);
        });

        it('lists several tenants at once when the caller opts in', async () => {
            const { cache, peak } = createOverlappingCache(6);

            await collectAsync(cache.walkSubscriptions({ concurrency: 3 }));

            assert.strictEqual(peak(), 3, 'the window must actually fill, and never past its size');
        });

        it('yields the same subscriptions in the same order either way', async () => {
            const sequential = createOverlappingCache(6);
            const concurrent = createOverlappingCache(6);

            const inOrder = await collectAsync(sequential.cache.walkSubscriptions());
            const overlapped = await collectAsync(concurrent.cache.walkSubscriptions({ concurrency: 4 }));

            assert.deepStrictEqual(pathIds(overlapped), pathIds(inOrder),
                'concurrency is a latency choice; it must not be observable in the result');
        });

        it('still reaches every tenant when one of a concurrent batch fails', async () => {
            const { cache } = createCache({ unreachableTenantIds: [tenantA.tenantId] });
            const failures: string[] = [];

            const paths = await collectAsync(cache.walkSubscriptions({
                concurrency: 4,
                onFailure: failure => failures.push(failure.tenant?.tenantId ?? '<account>'),
            }));

            assert.deepStrictEqual(pathIds(paths), ['tenant-b/sub-b']);
            assert.deepStrictEqual(failures, ['tenant-a']);
        });

        it('walks every tenant of an account with far more than a window of them', async () => {
            const count = 50;
            const { cache, fetcher } = (() => {
                const many = Array.from({ length: count }, (_unused, index) => makeTenant({
                    accountId: account.id,
                    tenantId: `tenant-${index}`,
                }));
                const subs = many.map(tenant => makeSubscription({
                    accountId: account.id,
                    tenantId: tenant.tenantId,
                    subscriptionId: `sub-${tenant.tenantId}`,
                }));
                return createCache({ tenants: many, subscriptions: subs, pageSize: 7 });
            })();

            const paths = await collectAsync(cache.walkSubscriptions({ concurrency: 5 }));

            assert.strictEqual(paths.length, count,
                'a pick list over every reachable subscription must not quietly stop at some tenant count');
            assert.strictEqual(listedTenantIds(fetcher).length, count);
        });
    });

    describe('invalidation', () => {
        it('re-lists accounts without discarding what is cached beneath them', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateAccounts();
            await cache.listAccounts();

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 2, 'the memo must not answer "did it change?"');
            await collectAsync(cache.walkSubscriptions());
            assert.strictEqual(fetcher.fetchTenants.mock.callCount(), 1);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 2);
        });

        it('seeds the fresh accounts back, so the re-list that follows is free', async () => {
            const { cache, fetcher } = createCache();

            cache.reenumerateAccounts();
            await cache.listAccounts();
            await cache.listAccounts();

            assert.strictEqual(fetcher.fetchAccounts.mock.callCount(), 1);
        });

        it('is not undone by a fetch it overtook', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            fetcher.fetchAccounts.mock.mockImplementationOnce(async () => {
                await gate;
                return [account];
            });

            cache.reenumerateAccounts();
            const inFlight = cache.listAccounts();
            cache.reenumerateAccounts();
            release();
            assert.deepStrictEqual(await inFlight, [account], 'the caller that asked still gets its answer');

            // The abandoned accounts are only observable through the synchronous
            // peek that `reenumerateSubscriptions` uses to recover an account's
            // environment, so that is the door this looks through. It matters
            // after a cloud switch, where a key built from the previous cloud's
            // account would name a listing in the wrong environment.
            cache.reenumerateSubscriptions(tenantA);
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 0, 'the overtaken result must not seed the memo');
        });

        it('retries the accounts after a failed fetch, rather than replaying the failure', async () => {
            const { cache, fetcher } = createCache();
            let call = 0;
            fetcher.fetchAccounts.mock.mockImplementation(async () => {
                call++;
                if (call === 1) {
                    throw new Error('transient');
                }
                return Promise.resolve([account]);
            });

            await assert.rejects(cache.listAccounts(), /transient/);

            // A failed fetch must not be retained, or one offline moment during
            // the first root load would leave the tree empty for the session.
            assert.deepStrictEqual(await cache.listAccounts(), [account]);
        });

        it('is not wiped by a failed fetch it overtook', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            let call = 0;
            fetcher.fetchAccounts.mock.mockImplementation(async () => {
                call++;
                if (call === 1) {
                    throw new Error('transient');
                }
                await gate;
                return [account];
            });

            // A fetch that fails after a later one has already replaced it must
            // clean up only after itself. Clearing the memo unconditionally
            // would deregister the newer fetch, which then declines to seed the
            // accounts it successfully fetched.
            cache.reenumerateAccounts();
            const failing = cache.listAccounts();
            const settled = failing.then(() => 'resolved', () => 'rejected');

            cache.reenumerateAccounts();
            const fresh = cache.listAccounts();

            assert.strictEqual(await settled, 'rejected', 'the caller that asked still sees its failure');
            release();
            await fresh;

            // Same door as the test above: the memo is only observable through
            // the synchronous peek `reenumerateSubscriptions` uses to recover an
            // account's environment.
            cache.reenumerateSubscriptions(tenantA);
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedTenantIds(fetcher), [tenantA.tenantId],
                'the successful fetch must still seed the memo, or the eviction silently does nothing');
        });

        it('re-enumerates one tenant\'s subscriptions and no other listing', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateSubscriptions(tenantA);
            fetcher.fetchTenants.mock.resetCalls();
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedAccountIds(fetcher), [], 'the tenant set itself did not change');
            assert.deepStrictEqual(listedTenantIds(fetcher), [tenantA.tenantId],
                'signing in to one tenant says nothing about what another tenant contains');
        });

        it('re-enumerates a tenant whose account id differs only by case', async () => {
            const { cache, fetcher } = createCache();
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateSubscriptions({ accountId: account.id.toUpperCase(), tenantId: tenantA.tenantId });
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedTenantIds(fetcher), [tenantA.tenantId],
                'account ids are case-insensitive, so a differently-cased id names the same listing');
        });

        it('does not re-enumerate a listing whose key merely starts with the named one', async () => {
            // A VS Code account id is an opaque provider string and may contain
            // the separator the cache keys with, so `{acct}/{tenant-n}` must not
            // be reachable as the account `acct/tenant-n`.
            const nested = makeAccount({ id: `${account.id}/tenant-n`, label: 'Nested' });
            const nestedTenant = makeTenant({ accountId: nested.id, tenantId: 'tenant-x' });
            const nestedSub = makeSubscription({ accountId: nested.id, tenantId: nestedTenant.tenantId, subscriptionId: 'sub-x' });
            const { cache, fetcher } = createCache({
                accounts: [account, nested],
                tenants: [tenantA, nestedTenant],
                subscriptions: [subA, nestedSub],
            });
            await collectAsync(cache.walkSubscriptions());

            cache.reenumerateSubscriptions({ accountId: account.id, tenantId: 'tenant-n' });
            fetcher.fetchSubscriptions.mock.resetCalls();
            await collectAsync(cache.walkSubscriptions());

            assert.deepStrictEqual(listedTenantIds(fetcher), [],
                'the nested account\'s listing must survive -- its key is not the same, only a textual prefix match');
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
            cache.reenumerateAccounts();
            assert.deepStrictEqual(pathIds(await collectAsync(cache.walkSubscriptions())), []);

            accounts.push(account);
            cache.reenumerateAccounts();
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

        it('caches a listing that produced nothing, rather than re-fetching it as a miss', async () => {
            const { cache, fetcher } = createCache({ subscriptions: [] });

            const first = await collectAsync(cache.listSubscriptions(tenantA));
            const second = await collectAsync(cache.listSubscriptions(tenantA));

            assert.deepStrictEqual(subscriptionIds(first), []);
            assert.deepStrictEqual(subscriptionIds(second), []);
            assert.strictEqual(fetcher.fetchSubscriptions.mock.callCount(), 1,
                '"cached, and there are none" must be distinct from "not cached" -- re-listing mints the tenant token again');
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
