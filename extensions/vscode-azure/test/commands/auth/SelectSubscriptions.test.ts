/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, makeAccount, makeSubscription, makeTenant, type MockAzureListingFetcher, type MockAzureListingFetcherOptions } from '@microsoft/vscode-azure-azutils/testing';
import { collectAsync, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, respondToPrompts, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { SelectSubscriptions } from '../../../src/commands/auth/SelectSubscriptions';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../../../src/constants';
import { CredentialOptionsScope } from '../../../src/utils/CredentialOptionsScope';
import { createSubscriptionFilter } from '../../../src/utils/subscriptionFilter';

const selectedSubscriptionsKey = `${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`;

describe('SelectSubscriptions (unit)', () => {
    function createCommand(options: MockAzureListingFetcherOptions, fetcher?: MockAzureListingFetcher) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const actionContext = createActionContext('test');
        const listings = new AzureListingCache(fetcher ?? createMockAzureListingFetcher(options), executor);
        const command = new SelectSubscriptions(ctx, executor, listings, new CredentialOptionsScope(), actionContext);
        return { command, ctx, mockResult, actionContext, listings };
    }

    const account = makeAccount({ id: 'acct-1' });
    const tenant = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
    const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub One', tenantId: tenant.tenantId, accountId: account.id });
    const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub Two', tenantId: tenant.tenantId, accountId: account.id });
    const bothSubscriptions: MockAzureListingFetcherOptions = { accounts: [account], tenants: [tenant], subscriptions: [sub1, sub2] };

    it('should list reachable subscriptions across pages and save the selected values', async () => {
        // One subscription per page, so a command that stopped at page one would
        // never offer Sub Two.
        const { command, mockResult } = createCommand({ ...bothSubscriptions, pageSize: 1 });
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)'] }]);

        await command.execute();

        expect(mockResult.settings.get(selectedSubscriptionsKey)).to.deep.equal(['tenant-1/sub-1']);
    });

    it('should offer every subscription even while a filter is in force', async () => {
        // The command that *edits* the filter must read past it, or the user
        // could only ever narrow their selection and never widen it again.
        const { command, mockResult } = createCommand(bothSubscriptions);
        mockResult.settings.set(selectedSubscriptionsKey, ['tenant-1/sub-1']);
        respondToPrompts(mockResult, ['acceptDefault']);

        await command.execute();

        expect(mockResult.quickPicks[0].items.map(item => item.label))
            .to.deep.equal(['Sub One (sub-1)', 'Sub Two (sub-2)']);
    });

    it('should pre-check the currently-selected subscriptions case-insensitively', async () => {
        const { command, mockResult } = createCommand(bothSubscriptions);

        // Seed the filter with an UPPERCASE id: the command matches the stored
        // ids case-insensitively, so the pre-check must still match sub-2.
        mockResult.settings.set(selectedSubscriptionsKey, ['TENANT-1/SUB-2']);

        // Accept the selection unchanged. Every other response would overwrite
        // `selectedItems`, which is exactly what production pre-checked.
        respondToPrompts(mockResult, ['acceptDefault']);

        await command.execute();

        // Only sub-2 was in the (upper-cased) filter, so only it is pre-checked...
        expect(mockResult.quickPicks[0].selectedItems.map(item => item.label))
            .to.deep.equal(['Sub Two (sub-2)']);
        // ...and accepting the pre-checked set round-trips to the lowercased id.
        expect(mockResult.settings.get(selectedSubscriptionsKey)).to.deep.equal(['tenant-1/sub-2']);
    });

    it('should persist an empty filter when every reachable subscription is selected', async () => {
        const { command, mockResult } = createCommand(bothSubscriptions);
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)', 'Sub Two (sub-2)'] }]);

        await command.execute();

        expect(mockResult.settings.get(selectedSubscriptionsKey)).to.deep.equal([]);
    });

    it('should skip a tenant whose subscriptions fail to load and warn instead of aborting', async () => {
        const badTenant = makeTenant({ tenantId: 'tenant-2', displayName: 'Bad Tenant', accountId: account.id });
        const { command, mockResult } = createCommand({
            ...bothSubscriptions,
            tenants: [tenant, badTenant],
            unreachableTenantIds: [badTenant.tenantId],
        });
        respondToPrompts(mockResult, [
            'cancel',
            { pickMany: ['Sub One (sub-1)', 'Sub Two (sub-2)'] },
        ]);

        await command.execute();

        // The failing tenant is surfaced as a non-blocking warning...
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
        // ...and even though every *loaded* subscription was selected, the filter
        // is NOT collapsed to [] (which would unhide the un-enumerated tenant).
        expect(mockResult.settings.get(selectedSubscriptionsKey)).to.deep.equal(['tenant-1/sub-1', 'tenant-1/sub-2']);
    });

    it('should throw when no tenant could be enumerated', async () => {
        const { command, mockResult, actionContext } = createCommand({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [sub1],
            unreachableTenantIds: [tenant.tenantId],
        });

        let caught: unknown;
        try {
            await command.execute();
        } catch (error) {
            caught = error;
        }

        expect(caught).to.be.instanceOf(Error);
        expect((caught as Error).message).to.match(/Could not load subscriptions for any tenant/);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
        // The error is user-actionable ("sign in"), not a bug, so the toast
        // should omit the "Report Issue" button.
        expect(actionContext.errorHandling.suppress).to.equal('reportIssue');
    });

    it('should offer sign-in rather than warn when a tenant is merely not signed in', async () => {
        // An account with access to many tenants has usually signed in to only
        // some of them. Reporting the rest as failures would fire on a healthy
        // setup and train the user to ignore the warning.
        const unvisited = makeTenant({ tenantId: 'tenant-2', displayName: 'Unvisited Tenant', accountId: account.id });
        const { command, mockResult } = createCommand({
            ...bothSubscriptions,
            tenants: [tenant, unvisited],
            signedOutTenantIds: [unvisited.tenantId],
        });
        respondToPrompts(mockResult, ['cancel', { pickMany: ['Sub One (sub-1)'] }]);

        await command.execute();

        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
        expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(1);
        expect(mockResult.window.showInformationMessage.mock.calls[0].arguments[0])
            .to.match(/not signed in.*Unvisited Tenant/);
    });

    it('should warn when a tenant fails for a reason signing in will not fix', async () => {
        const broken = makeTenant({ tenantId: 'tenant-2', displayName: 'Broken Tenant', accountId: account.id });
        const unvisited = makeTenant({ tenantId: 'tenant-3', displayName: 'Unvisited Tenant', accountId: account.id });
        const { command, mockResult } = createCommand({
            ...bothSubscriptions,
            tenants: [tenant, broken, unvisited],
            unreachableTenantIds: [broken.tenantId],
            signedOutTenantIds: [unvisited.tenantId],
        });
        respondToPrompts(mockResult, ['cancel', { pickMany: ['Sub One (sub-1)'] }]);

        await command.execute();

        // One toast, not one per category, and the wording follows the worst
        // outcome present.
        expect(mockResult.window.showInformationMessage.mock.callCount()).to.equal(0);
        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);
        expect(mockResult.window.showWarningMessage.mock.calls[0].arguments[0])
            .to.match(/could not be loaded/);
    });

    it('should fetch only the listings the filtered tree skipped', async () => {
        const excluded = makeTenant({ tenantId: 'tenant-2', displayName: 'Tenant Two', accountId: account.id });
        const sub3 = makeSubscription({ subscriptionId: 'sub-3', displayName: 'Sub Three', tenantId: excluded.tenantId, accountId: account.id });
        const fetcher = createMockAzureListingFetcher({
            accounts: [account],
            tenants: [tenant, excluded],
            subscriptions: [sub1, sub2, sub3],
        });
        const { command, mockResult, listings } = createCommand({}, fetcher);
        respondToPrompts(mockResult, [{ pickMany: ['Sub One (sub-1)'] }]);

        // Stand in for the tree: a walk through the very filter the tree passes.
        await withSettings(mockResult, { [selectedSubscriptionsKey]: ['tenant-1/sub-1'] }, async () => {
            const filter = createSubscriptionFilter(mockResult.vscode);
            await collectAsync(listings.walkSubscriptions({ filter: filter?.admitsTenant }));
        });
        fetcher.fetchSubscriptions.mock.resetCalls();

        await command.execute();

        // Tenant One's subscriptions were already paid for, so the unfiltered
        // read fetches exactly the tenant the filtered walk skipped.
        expect(fetcher.fetchSubscriptions.mock.calls.map(call => call.arguments[0].tenantId)).to.deep.equal([excluded.tenantId]);
        expect(mockResult.settings.get(selectedSubscriptionsKey)).to.deep.equal(['tenant-1/sub-1']);
    });
});
