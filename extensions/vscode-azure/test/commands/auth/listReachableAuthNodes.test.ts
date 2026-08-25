/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant, type MockAzureListingFetcherOptions } from '@microsoft/vscode-azure-azutils/testing';
import { collectAsync, collectPages } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { listReachableSubscriptions, listReachableTenantPages } from '../../../src/commands/auth/listReachableAuthNodes';

describe('listReachableAuthNodes (unit)', () => {
    function createCache(options: MockAzureListingFetcherOptions) {
        const { executor } = createTestActionExecutor();
        const fetcher = createMockAzureListingFetcher(options);
        return { listings: new AzureListingCache(fetcher, executor), fetcher };
    }

    describe('listReachableSubscriptions', () => {
        it('walks account -> tenant -> subscription and returns them sorted', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            // Provided out of alphabetical order to prove the result is sorted by displayName.
            const subBeta = makeSubscription({ subscriptionId: 'sub-b', displayName: 'Beta', tenantId: tenant.tenantId, accountId: account.id });
            const subAlpha = makeSubscription({ subscriptionId: 'sub-a', displayName: 'Alpha', tenantId: tenant.tenantId, accountId: account.id });
            const { listings } = createCache({ accounts: [account], tenants: [tenant], subscriptions: [subBeta, subAlpha] });

            const { subscriptions, failures } = await listReachableSubscriptions(listings);

            expect(failures).to.deep.equal([]);
            expect(subscriptions.map(s => s.subscription.displayName)).to.deep.equal(['Alpha', 'Beta']);
            // The account/tenant that reached each subscription are threaded through.
            expect(subscriptions[0].account).to.equal(account);
            expect(subscriptions[0].tenant).to.equal(tenant);
        });

        it('returns empty results when no account is signed in', async () => {
            const { listings } = createCache({ accounts: [], tenants: [], subscriptions: [] });

            const { subscriptions, failures } = await listReachableSubscriptions(listings);

            expect(subscriptions).to.deep.equal([]);
            expect(failures).to.deep.equal([]);
        });

        it('drains every page of a tenant rather than stopping at the first', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const subscriptions = ['sub-1', 'sub-2', 'sub-3'].map(subscriptionId =>
                makeSubscription({ subscriptionId, displayName: subscriptionId, tenantId: tenant.tenantId, accountId: account.id }));
            const { listings } = createCache({ accounts: [account], tenants: [tenant], subscriptions, pageSize: 1 });

            const result = await listReachableSubscriptions(listings);

            expect(result.subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1', 'sub-2', 'sub-3']);
        });

        it('keeps both copies of a subscription reachable through two tenants', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const first = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const second = makeTenant({ tenantId: 'tenant-2', accountId: account.id });
            // One subscription, reachable through two tenants: the pick list has
            // to offer both, because the filter selects a tenant/subscription
            // pair and authorization can differ between the two.
            const viaFirst = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub', tenantId: first.tenantId, accountId: account.id });
            const viaSecond = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub', tenantId: second.tenantId, accountId: account.id });
            const { listings } = createCache({ accounts: [account], tenants: [first, second], subscriptions: [viaFirst, viaSecond] });

            const { subscriptions } = await listReachableSubscriptions(listings);

            expect(subscriptions.map(s => s.tenant.tenantId)).to.deep.equal([first.tenantId, second.tenantId]);
        });

        it('dedups a tenant/subscription pair whose ids differ only in casing', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const lower = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const upper = makeTenant({ tenantId: 'TENANT-1', accountId: account.id });
            const subLower = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub', tenantId: 'tenant-1', accountId: account.id });
            const subUpper = makeSubscription({ subscriptionId: 'SUB-1', displayName: 'Sub', tenantId: 'TENANT-1', accountId: account.id });
            const { listings } = createCache({ accounts: [account], tenants: [lower, upper], subscriptions: [subLower, subUpper] });

            const { subscriptions } = await listReachableSubscriptions(listings);

            // 'tenant-1/sub-1' and 'TENANT-1/SUB-1' name the same pair.
            expect(subscriptions).to.have.lengthOf(1);
            expect(subscriptions[0].tenant).to.equal(lower);
        });

        it('captures a tenant that cannot be listed without aborting the rest of the walk', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const good = makeTenant({ tenantId: 'good', accountId: account.id });
            const bad = makeTenant({ tenantId: 'bad', accountId: account.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Good Sub', tenantId: good.tenantId, accountId: account.id });
            const { listings } = createCache({
                accounts: [account],
                tenants: [good, bad],
                subscriptions: [sub],
                unreachableTenantIds: [bad.tenantId],
            });

            const { subscriptions, failures } = await listReachableSubscriptions(listings);

            // The good tenant's subscription still comes through, so the user can
            // select it despite one tenant refusing to mint a token...
            expect(subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1']);
            // ...and the bad tenant is reported so the caller can warn about it.
            expect(failures).to.have.lengthOf(1);
            expect(failures[0].account).to.equal(account);
            expect(failures[0].tenant).to.equal(bad);
            expect(failures[0].error).to.be.instanceOf(Error);
        });

        it('reads unfiltered, so it can widen a filter and not merely narrow it', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const sub = makeSubscription({ subscriptionId: 'sub-1', tenantId: tenant.tenantId, accountId: account.id });
            const { listings } = createCache({ accounts: [account], tenants: [tenant], subscriptions: [sub] });
            // A tree read that admits nothing: the tenant listing is cached, but
            // the tenant itself was skipped, so its subscriptions never were.
            await collectAsync(listings.listTenants(account, () => false));

            const { subscriptions } = await listReachableSubscriptions(listings);

            expect(subscriptions.map(s => s.subscription.subscriptionId)).to.deep.equal(['sub-1']);
        });
    });

    describe('listReachableTenantPages', () => {
        it('yields one page per account, sorted by display name', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenants = [
                makeTenant({ tenantId: 'tenant-2', displayName: 'Zulu', accountId: account.id }),
                makeTenant({ tenantId: 'tenant-1', displayName: 'Alpha', accountId: account.id }),
                makeTenant({ tenantId: 'tenant-3', displayName: 'Mike', accountId: account.id }),
            ];
            const { listings } = createCache({ accounts: [account], tenants, subscriptions: [], pageSize: 2 });

            const [first] = await collectPages(listReachableTenantPages(listings));

            // Accounts can belong to hundreds of tenants, and this only seeds a
            // combobox where any tenant id can be typed, so page two waits to be
            // asked for.
            expect(first.items.map(t => t.tenant.displayName)).to.deep.equal(['Alpha', 'Zulu']);
            expect(first.items[0].account).to.equal(account);
            expect(first.hasMore).to.be.true;
        });

        it('advances every account that still has more in one step', async () => {
            const first = makeAccount({ id: 'acct-1' });
            const second = makeAccount({ id: 'acct-2' });
            const tenants = [
                makeTenant({ tenantId: 'tenant-2', displayName: 'Zulu', accountId: first.id }),
                makeTenant({ tenantId: 'tenant-1', displayName: 'Alpha', accountId: first.id }),
                makeTenant({ tenantId: 'tenant-4', displayName: 'Yankee', accountId: second.id }),
                makeTenant({ tenantId: 'tenant-3', displayName: 'Bravo', accountId: second.id }),
            ];
            const pulls: string[] = [];
            const { listings } = createCache({
                accounts: [first, second],
                tenants,
                subscriptions: [],
                pageSize: 1,
                onPagePulled: (listing, pageIndex) => { if (listing === 'tenants') { pulls.push(String(pageIndex)); } },
            });

            const pages = await collectPages(listReachableTenantPages(listings));

            // Both accounts advance together, so a user with several accounts
            // waits one round trip per step rather than one per account.
            expect(pulls).to.deep.equal(['0', '0', '1', '1']);
            expect(pages.map(page => page.items.map(t => t.tenant.displayName))).to.deep.equal([
                ['Yankee', 'Zulu'],
                ['Alpha', 'Bravo', 'Yankee', 'Zulu'],
            ]);
            // Each page carries everything found so far, so a picker can show it
            // directly instead of accumulating.
            expect(pages.map(page => page.hasMore)).to.deep.equal([true, false]);
        });

        it('resumes the listing rather than restarting it on the next page', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenants = ['tenant-1', 'tenant-2', 'tenant-3', 'tenant-4'].map(tenantId =>
                makeTenant({ tenantId, displayName: tenantId, accountId: account.id }));
            const pulls: number[] = [];
            const { listings } = createCache({
                accounts: [account],
                tenants,
                subscriptions: [],
                pageSize: 2,
                onPagePulled: (listing, pageIndex) => { if (listing === 'tenants') { pulls.push(pageIndex); } },
            });

            // Read one page, abandon the walk, then start over and read on.
            const iterator = listReachableTenantPages(listings)[Symbol.asyncIterator]();
            await iterator.next();
            await collectPages(listReachableTenantPages(listings));

            // Page zero is replayed from the cache, so reading on costs only the
            // page the first walk had not reached.
            expect(pulls).to.deep.equal([0, 1]);
        });

        it('reports no more pages when the first page is the whole listing', async () => {
            const account = makeAccount({ id: 'acct-1' });
            const tenant = makeTenant({ tenantId: 'tenant-1', accountId: account.id });
            const { listings } = createCache({ accounts: [account], tenants: [tenant], subscriptions: [] });

            const pages = await collectPages(listReachableTenantPages(listings));

            expect(pages).to.have.length(1);
            expect(pages[0].hasMore).to.be.false;
        });

        it('keeps the tenants of the accounts it could list when another fails', async () => {
            const listable = makeAccount({ id: 'acct-1', label: 'Listable' });
            const blocked = makeAccount({ id: 'acct-2', label: 'Blocked' });
            const tenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Alpha', accountId: listable.id });
            const { listings } = createCache({
                accounts: [listable, blocked],
                tenants: [tenant],
                subscriptions: [],
                unlistableAccountIds: [blocked.id],
            });

            // Enumeration being blocked for one account is the very case that
            // sends a user to Sign In, so it must not empty the suggestions.
            const pages = await collectPages(listReachableTenantPages(listings));

            expect(pages[0].items.map(t => t.tenant.displayName)).to.deep.equal(['Alpha']);
        });

        it('returns nothing when no account is signed in', async () => {
            const { listings } = createCache({ accounts: [], tenants: [], subscriptions: [] });

            expect(await collectPages(listReachableTenantPages(listings))).to.deep.equal([]);
        });
    });
});
