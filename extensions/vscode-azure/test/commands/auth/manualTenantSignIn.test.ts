/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache, type AzureSubscription, type AzureTenant } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, createMockCredentialFactory, makeAccount, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { collectPages } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, ManualDebounceScheduler, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { SignIn } from '../../../src/commands/auth/SignIn';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from '../../../src/constants';
import type { IAzureViewDataTree } from '../../../src/services';
import { AzureAccountDataProvider } from '../../../src/tree/resources/AzureAccountDataProvider';
import { signedInTenantIdsFor } from '../../../src/utils/signedInTenants';

const account = makeAccount({ id: 'acct-restricted', label: 'Restricted' });
const manualTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';

/** A tenant that exists and holds a subscription, but that the account cannot enumerate. */
const hiddenTenant = makeTenant({ accountId: account.id, tenantId: manualTenantId, displayName: 'Hidden Tenant' });
const hiddenSubscription = makeSubscription({ accountId: account.id, tenantId: manualTenantId, subscriptionId: 'hidden-sub', displayName: 'Hidden Sub' });

const signedInTenantsKey = `${ConfigurationSection}.${SignedInTenantsConfigurationKey}`;

/**
 * The scenario mock mode reproduces: an account whose tenants Azure will not
 * enumerate, reached only by entering a tenant id by hand.
 *
 * Everything below the command is real -- the listing cache, the data provider,
 * and the configuration round trip -- so this covers the whole path a user
 * walks, not just the command's own branch.
 */
describe('manual tenant sign-in (unit)', () => {
    function createHarness() {
        const { ctx, mock: code } = createMockCodeContext();
        const { executor } = createTestActionExecutor();

        const fetcher = createMockAzureListingFetcher({
            accounts: [account],
            tenants: [hiddenTenant],
            subscriptions: [hiddenSubscription],
            unlistableAccountIds: [account.id],
        });

        const listings = new AzureListingCache(fetcher, executor, {
            additionalTenantIds: forAccount => signedInTenantIdsFor(ctx.code, forAccount.id),
        });
        const credentialFactory = createMockCredentialFactory({ account });
        const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory, listings, new ManualDebounceScheduler());
        const invalidate = mock.fn((_target: unknown) => { /* spy */ });
        const command = new SignIn(ctx, { invalidate } as unknown as IAzureViewDataTree, listings, credentialFactory);

        return { code, provider, command, credentialFactory };
    }

    type Harness = ReturnType<typeof createHarness>;

    async function tenantsOf(provider: AzureAccountDataProvider): Promise<AzureTenant[]> {
        const pages = await collectPages(await provider.getChildren(account));
        return pages.flatMap(page => page.items as AzureTenant[]);
    }

    /** Deliver the configuration-change event VS Code raises after the setting is written. */
    function fireSignedInTenantsChanged(code: Harness['code']): void {
        code.configChangeEmitter.fire({ affectsConfiguration: section => section === signedInTenantsKey });
    }

    it('should reach a tenant that cannot be enumerated, once its id is entered', async () => {
        const { code, provider, command } = createHarness();

        // Nothing to expand, even though the tenant exists: enumeration is
        // blocked, which is what sends the user to Sign In in the first place.
        expect(await tenantsOf(provider)).to.deep.equal([]);

        respondToPrompts(code, [{ value: manualTenantId }]);
        await command.execute();
        fireSignedInTenantsChanged(code);

        const tenants = await tenantsOf(provider);
        expect(tenants.map(tenant => tenant.tenantId)).to.deep.equal([manualTenantId]);
        // The tenant has a real name, but nothing can read it while enumeration
        // is blocked, so the id stands in until enrichment upgrades it. That
        // placeholder is what marks the tenant as manually entered.
        expect(tenants[0].displayName).to.equal(manualTenantId);

        const pages = await collectPages(await provider.getChildren(tenants[0]));
        expect(pages.flatMap(page => (page.items as AzureSubscription[]).map(sub => sub.subscriptionId)))
            .to.deep.equal([hiddenSubscription.subscriptionId]);
    });

    it('should persist the tenant under the account the sign-in resolved to', async () => {
        const { code, command } = createHarness();

        respondToPrompts(code, [{ value: manualTenantId }]);
        await command.execute();

        // No account context accompanies a typed tenant, so the account is
        // whichever one the resulting session reports.
        expect(code.settings.get(signedInTenantsKey)).to.deep.equal([
            { accountId: account.id, tenantId: manualTenantId },
        ]);
    });

    it('should drive the tenant sign-in through the credential factory', async () => {
        const { code, command, credentialFactory } = createHarness();

        respondToPrompts(code, [{ value: manualTenantId }]);
        await command.execute();

        // The factory owns provider selection and auth logging, so the command
        // goes through it rather than calling getSession itself. Mocking it is
        // therefore enough to drive a sign-in with no real session behind it --
        // the request is still interactive (`createIfNone`), scoped to the
        // tenant the user typed.
        expect(code.authentication.getSession.mock.callCount()).to.equal(0);
        expect(credentialFactory.mock.calls.map(call => call.arguments[0])).to.deep.equal([
            { tenantId: manualTenantId, sessionOptions: { createIfNone: true } },
        ]);
    });
});
