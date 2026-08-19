/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPageItems, collectPages, type Page } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { AzureListingCache, CachedPagedListing } from '../../src/auth/AzureListingCache';
import type { ConcreteAzureNode } from '../../src/models/AzureNode';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';

describe('CachedPagedListing (unit)', () => {
    /** A paged listing whose pages are produced lazily, counting each pull. */
    function countingPages(pages: number[][]) {
        const pulled: number[] = [];
        // eslint-disable-next-line @typescript-eslint/require-await
        const factory = mock.fn(() => (async function* (): AsyncIterable<Page<number>> {
            for (let i = 0; i < pages.length; i++) {
                pulled.push(i);
                yield { items: pages[i], hasMore: i < pages.length - 1 };
            }
        })());

        return { factory, pulled };
    }

    it('should replay cached pages instead of re-fetching on a second read', async () => {
        const { factory, pulled } = countingPages([[1], [2]]);
        const listing = new CachedPagedListing(factory);

        const first = await collectPageItems(listing.read());
        const second = await collectPageItems(listing.read());

        expect(first).to.deep.equal([1, 2]);
        expect(second).to.deep.equal([1, 2]);
        // The underlying listing was produced once and each page pulled once.
        expect(factory.mock.callCount()).to.equal(1);
        expect(pulled).to.deep.equal([0, 1]);
    });

    it('should not pull pages the reader never asks for', async () => {
        const { factory, pulled } = countingPages([[1], [2], [3]]);
        const listing = new CachedPagedListing(factory);

        for await (const page of listing.read()) {
            expect(page.items).to.deep.equal([1]);
            break;
        }

        // Reading only the first page must not enumerate the rest -- this is what
        // keeps a first-page-only caller cheap on an account with many tenants.
        expect(pulled).to.deep.equal([0]);
    });

    it('should resume a partially-read listing rather than restarting it', async () => {
        const { factory, pulled } = countingPages([[1], [2], [3]]);
        const listing = new CachedPagedListing(factory);

        for await (const page of listing.read()) {
            expect(page.items).to.deep.equal([1]);
            break;
        }
        const full = await collectPageItems(listing.read());

        expect(full).to.deep.equal([1, 2, 3]);
        // Page 0 came from the cache; only pages 1 and 2 were newly pulled, and
        // the listing was never re-created.
        expect(pulled).to.deep.equal([0, 1, 2]);
        expect(factory.mock.callCount()).to.equal(1);
    });

    it('should share a single in-flight pull between concurrent readers', async () => {
        let pulls = 0;
        const listing = new CachedPagedListing(() => (async function* (): AsyncIterable<Page<number>> {
            pulls++;
            await new Promise(resolve => setTimeout(resolve, 5));
            yield { items: [1], hasMore: false };
        })());

        const [a, b] = await Promise.all([collectPageItems(listing.read()), collectPageItems(listing.read())]);

        expect(a).to.deep.equal([1]);
        expect(b).to.deep.equal([1]);
        expect(pulls).to.equal(1);
    });

    it('should not cache a failed pull, so the next read retries', async () => {
        let attempts = 0;
        // eslint-disable-next-line @typescript-eslint/require-await
        const listing = new CachedPagedListing(() => (async function* (): AsyncIterable<Page<number>> {
            attempts++;
            if (attempts === 1) {
                throw new Error('transient');
            }
            yield { items: [1], hasMore: false };
        })());

        let caught: unknown;
        try {
            await collectPages(listing.read());
        } catch (error) {
            caught = error;
        }

        expect(caught).to.be.instanceOf(Error);
        // A transient failure must not strand the caller with a cached empty
        // result -- reading again re-attempts the listing.
        expect(await collectPageItems(listing.read())).to.deep.equal([1]);
    });
});

describe('AzureListingCache (unit)', () => {
    const account = makeAccount({ id: 'acct-1' });
    const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });

    /** A source that records how many times each listing was requested. */
    function createCountingSource() {
        const calls = { accounts: 0, tenants: 0, subscriptions: 0 };
        const source = {
            listAccounts: () => {
                calls.accounts++;
                return Promise.resolve([account]);
            },
            listTenantsForAccount: () => {
                calls.tenants++;
                // eslint-disable-next-line @typescript-eslint/require-await
                return (async function* (): AsyncIterable<Page<ConcreteAzureNode>> {
                    yield { items: [tenant], hasMore: false };
                })();
            },
            listSubscriptionsForTenant: () => {
                calls.subscriptions++;
                // eslint-disable-next-line @typescript-eslint/require-await
                return (async function* (): AsyncIterable<Page<ConcreteAzureNode>> {
                    yield { items: [makeSubscription({ subscriptionId: 'sub-1', tenantId: tenant.tenantId, accountId: account.id })], hasMore: false };
                })();
            },
        };

        return { source, calls };
    }

    it('should fetch each listing once and serve later callers from the cache', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await cache.listAccounts();
        await cache.listAccounts();
        await collectPages(cache.listTenantsForAccount(account));
        await collectPages(cache.listTenantsForAccount(account));
        await collectPages(cache.listSubscriptionsForTenant(tenant));
        await collectPages(cache.listSubscriptionsForTenant(tenant));

        expect(calls).to.deep.equal({ accounts: 1, tenants: 1, subscriptions: 1 });
    });

    it('should share one account request between concurrent callers', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await Promise.all([cache.listAccounts(), cache.listAccounts()]);

        expect(calls.accounts).to.equal(1);
    });

    it('should retry after a failed account listing rather than caching the rejection', async () => {
        let attempts = 0;
        const cache = new AzureListingCache({
            ...createCountingSource().source,
            listAccounts: () => {
                attempts++;
                return attempts === 1 ? Promise.reject(new Error('transient')) : Promise.resolve([account]);
            },
        });

        await expect(cache.listAccounts()).to.be.rejectedWith('transient');

        expect(await cache.listAccounts()).to.deep.equal([account]);
    });

    it('should re-fetch everything after clear', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await cache.listAccounts();
        await collectPages(cache.listTenantsForAccount(account));
        cache.clear();
        await cache.listAccounts();
        await collectPages(cache.listTenantsForAccount(account));

        expect(calls).to.deep.equal({ accounts: 2, tenants: 2, subscriptions: 0 });
    });

    it('should keep tenant listings when the account list is refreshed', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await cache.listAccounts();
        await collectPages(cache.listTenantsForAccount(account));
        expect(await cache.refreshAccounts()).to.deep.equal([account]);
        await cache.listAccounts();
        await collectPages(cache.listTenantsForAccount(account));

        // The refresh itself re-lists accounts, and reseeds the memo so the
        // subsequent read is served from cache. Signing a *new* account in does
        // not make the existing account's tenants untrue, so they must not be
        // re-fetched.
        expect(calls).to.deep.equal({ accounts: 2, tenants: 1, subscriptions: 0 });
    });

    it('should drop the tenants and subscriptions of a single cleared account', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await collectPages(cache.listTenantsForAccount(account));
        await collectPages(cache.listSubscriptionsForTenant(tenant));
        cache.clearAccount(account.id.toUpperCase());
        await collectPages(cache.listTenantsForAccount(account));
        await collectPages(cache.listSubscriptionsForTenant(tenant));

        // Matched case-insensitively, and the tenant's subscriptions go with it.
        expect(calls).to.deep.equal({ accounts: 0, tenants: 2, subscriptions: 2 });
    });

    it('should leave other accounts untouched when one is cleared', async () => {
        const { source, calls } = createCountingSource();
        const cache = new AzureListingCache(source);

        await collectPages(cache.listTenantsForAccount(account));
        cache.clearAccount('some-other-account');
        await collectPages(cache.listTenantsForAccount(account));

        expect(calls.tenants).to.equal(1);
    });
});
