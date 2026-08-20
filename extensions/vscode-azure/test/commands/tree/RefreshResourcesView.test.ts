/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { collectAsync, Everything } from '@microsoft/vscode-azure-utils';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { RefreshResourcesView } from '../../../src/commands/tree/RefreshResourcesView';
import type { IAzureViewDataTree } from '../../../src/services';

describe('RefreshResourcesView (unit)', () => {
    it('should invalidate everything on the data tree', () => {
        const invalidate = mock.fn();
        const tree: IAzureViewDataTree = { invalidate } as never;
        const listings: AzureListingCache = { clear: () => { /* no-op */ } } as never;

        const cmd = new RefreshResourcesView(tree, listings);
        cmd.execute();

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should re-list accounts, tenants, and subscriptions', async () => {
        // Nothing else discards the listings, and they never expire, so a
        // refresh that skipped them could not pick up a new subscription.
        const account = makeAccount({ id: 'acct' });
        const tenant = makeTenant({ accountId: account.id, tenantId: 'tenant-a' });
        const fetcher = createMockAzureListingFetcher({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [makeSubscription({ accountId: account.id, tenantId: tenant.tenantId, subscriptionId: 'sub-a' })],
        });
        const { executor } = createTestActionExecutor();
        const listings = new AzureListingCache(fetcher, executor);
        await collectAsync(listings.walkSubscriptions());

        const tree: IAzureViewDataTree = { invalidate: () => { /* no-op */ } } as never;
        new RefreshResourcesView(tree, listings).execute();
        await collectAsync(listings.walkSubscriptions());

        expect(fetcher.fetchAccounts.mock.callCount()).to.equal(2);
        expect(fetcher.fetchTenants.mock.callCount()).to.equal(2);
        expect(fetcher.fetchSubscriptions.mock.callCount()).to.equal(2);
    });
});
