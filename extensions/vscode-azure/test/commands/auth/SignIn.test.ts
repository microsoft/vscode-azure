/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache, createDefaultCredentialFactory, type AzureAccount, type AzureTenant, type ICredentialFactory } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, makeAccount, makeTenant, type MockAzureListingFetcher } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, collectPages, Everything, Roots, type IVsCode } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock, type Mock } from 'node:test';
import { pickTenantOrEnterId, SignIn } from '../../../src/commands/auth/SignIn';
import type { ReachableTenant } from '../../../src/commands/auth/listReachableAuthNodes';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from '../../../src/constants';
import type { IAzureViewDataTree } from '../../../src/services';
import type { SignedInTenant } from '../../../src/utils/signedInTenants';

describe('SignIn (unit)', () => {
    /**
     * A listing cache over the given accounts/tenants, plus a tree whose
     * `invalidate` is a spy, so tests can assert both what was re-listed and
     * what was discarded from the cache.
     */
    function createHarness(accounts: AzureAccount[], tenants: AzureTenant[] = []): {
        tree: IAzureViewDataTree;
        invalidate: Mock<(target: unknown) => void>;
        listings: AzureListingCache;
        fetcher: MockAzureListingFetcher;
    } {
        const { executor } = createTestActionExecutor();
        const fetcher = createMockAzureListingFetcher({ accounts, tenants, subscriptions: [] });
        const invalidate = mock.fn((_target: unknown) => { /* spy */ });
        return {
            tree: { invalidate } as unknown as IAzureViewDataTree,
            invalidate,
            listings: new AzureListingCache(fetcher, executor),
            fetcher,
        };
    }

    /** A minimal stand-in session carrying the account a tenant resolved to. */
    const fakeSession: unknown = { account: { id: 'resolved-account', label: '' } };

    /** The persisted manual-tenant entries, as stored in configuration. */
    const settingKey = `${ConfigurationSection}.${SignedInTenantsConfigurationKey}`;
    function readPersistedTenants(settings: Map<string, unknown>): SignedInTenant[] {
        return (settings.get(settingKey) as SignedInTenant[] | undefined) ?? [];
    }

    /**
     * Build a credential factory bound to the mock code context, so the default
     * sign-in path drives the same mock `authentication.getSession` as the
     * tenant-scoped path. Wrapped in `mock.fn` so it delegates to the real
     * factory while recording the inputs it was called with (assert via
     * `.mock.calls`, e.g. that an explicit `createIfNone` was passed).
     */
    function createCredentialFactory(code: IVsCode): Mock<ICredentialFactory> {
        return mock.fn(createDefaultCredentialFactory(code));
    }

    /** Make the mock `getSession` resolve a session so a default sign-in succeeds. */
    function resolveDefaultSession(mockResult: ReturnType<typeof createMockCodeContext>['mock']): void {
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
    }

    it('should perform a default sign-in and invalidate roots when signed out', async () => {
        const { tree, invalidate, listings, fetcher } = createHarness([]);
        const { ctx, mock: mockResult } = createMockCodeContext();
        resolveDefaultSession(mockResult);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // The default sign-in goes through the credential factory, which is
        // asked for an interactive session with `createIfNone` passed explicitly
        // (so it keeps prompting even if the credential's default ever changes).
        expect(credentialFactory.mock.calls.map((c) => c.arguments[0])).to.deep.equal([{ sessionOptions: { createIfNone: true } }]);

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean }];
        expect(scopes).to.have.length(1);
        expect(options.createIfNone).to.be.true;

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Roots);
        // The account set just changed, so the memoized accounts listing is told
        // to look again -- otherwise the root re-list would replay the memo and
        // still show nobody signed in.
        expect(fetcher.fetchAccounts.mock.callCount()).to.equal(2);
    });

    it('should treat an account-listing failure as signed out and offer a default sign-in', async () => {
        // Listing accounts fails (e.g. a transient error). The command should
        // fall back to the default interactive sign-in rather than failing.
        const { tree, invalidate, listings, fetcher } = createHarness([]);
        fetcher.fetchAccounts.mock.mockImplementation(() => Promise.reject(new Error('listing accounts failed')));
        const { ctx, mock: mockResult } = createMockCodeContext();
        resolveDefaultSession(mockResult);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // A plain (default) interactive sign-in was attempted, with no tenant scope.
        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes] = calls[0].arguments as [string, string[], unknown];
        expect(scopes).to.have.length(1);

        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Roots);
    });

    it('should sign in to a selected tenant when already signed in', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const tenant2 = makeTenant({ tenantId: 'tenant-2', displayName: 'Tenant Two', accountId: account.id });
        const { tree, invalidate, listings, fetcher } = createHarness([account], [tenant1, tenant2]);

        const { ctx, mock: mockResult } = createMockCodeContext();
        resolveDefaultSession(mockResult);
        respondToPrompts(mockResult, [{ pick: 'Tenant Two (tenant-2)' }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        // Prime both tenants' subscriptions, so anything re-listed afterwards
        // was re-listed because the sign-in dropped it.
        await collectPages(listings.listSubscriptions(tenant1));
        await collectPages(listings.listSubscriptions(tenant2));
        fetcher.fetchSubscriptions.mock.resetCalls();
        await command.execute();

        // Already signed in, so only the tenant-scoped sign-in happens.
        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean; account?: { id: string } }];
        expect(scopes).to.include('VSCODE_TENANT:tenant-2');
        expect(options.createIfNone).to.be.true;
        expect(options.account?.id).to.equal('acct-1');

        // Only the account's own subtree, since the sign-in can have authorized
        // subscriptions that were invisible when this tenant was last listed.
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0];
        expect(target).to.be.a('function');
        expect(target).to.not.equal(Roots);
        expect(target).to.not.equal(Everything);

        // The tenant listing itself is untouched -- what tenants an account can
        // see is not what a tenant sign-in changes.
        fetcher.fetchTenants.mock.resetCalls();
        await collectPages(listings.listTenants(account));
        expect(fetcher.fetchTenants.mock.callCount()).to.equal(0);
        // That one tenant's subscriptions are re-listed, and no other tenant's.
        await collectPages(listings.listSubscriptions(tenant2));
        await collectPages(listings.listSubscriptions(tenant1));
        expect(fetcher.fetchSubscriptions.mock.calls.map(call => call.arguments[0].tenantId)).to.deep.equal(['tenant-2']);
    });

    it('should sign in to a typed tenant ID when already signed in', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, invalidate, listings } = createHarness([account], [tenant1]);

        // Tenant IDs are GUIDs (users paste them), so the combobox only offers a
        // synthetic "sign in to <id>" item for a GUID value.
        const typedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        // The tenant-scoped sign-in resolves to a concrete account.
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
        respondToPrompts(mockResult, [{ value: typedTenantId }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(1);
        const [, scopes, options] = calls[0].arguments as [string, string[], { createIfNone?: boolean; account?: { id: string } }];
        expect(scopes).to.include(`VSCODE_TENANT:${typedTenantId}`);
        expect(options.createIfNone).to.be.true;
        expect(options.account).to.be.undefined;

        // A newly-entered tenant is persisted, and AzureAccountDataProvider's
        // configuration listener refreshes the tree in response. Nothing cached
        // is untrue -- named tenants are merged above the cache -- so SignIn
        // touches neither the tree nor the listings directly.
        expect(invalidate.mock.callCount()).to.equal(0);
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([
            { accountId: 'resolved-account', tenantId: typedTenantId.toLowerCase() },
        ]);
    });

    it('should re-list only the tenant\'s subscriptions when re-signing in to an already-saved tenant', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, invalidate, listings } = createHarness([account], [tenant1]);

        const typedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        // The tenant is already saved under the account the sign-in resolves to,
        // so persisting is a no-op and no configuration-change event fires.
        mockResult.settings.set(settingKey, [
            { accountId: 'resolved-account', tenantId: typedTenantId },
        ]);
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
        respondToPrompts(mockResult, [{ value: typedTenantId }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // No setting change => the configuration listener won't refresh, so
        // SignIn refreshes the affected account's subtree itself. Only that one
        // tenant's subscriptions are dropped from the cache; the account's
        // tenant listing, and every other tenant's subscriptions, are untouched.
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0];
        expect(target).to.be.a('function');
        expect(target).to.not.equal(Roots);
        expect(target).to.not.equal(Everything);
        // Unchanged: the pre-existing entry is left as-is.
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([
            { accountId: 'resolved-account', tenantId: typedTenantId },
        ]);
    });

    it('should fail without persisting anything when the sign-in yields no session', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, invalidate, listings } = createHarness([account], [tenant1]);

        // `createIfNone` is set, so VS Code either returns a session or throws.
        // Getting nothing back means the sign-in did not happen, and nothing
        // that follows from a sign-in may happen either.
        const typedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        respondToPrompts(mockResult, [{ value: typedTenantId }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await expect(command.execute()).to.be.rejectedWith(/returned no session/);

        expect(invalidate.mock.callCount()).to.equal(0);
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([],
            'a tenant that was never signed in to must not be recorded as signed in');
    });

    it('should persist a manually-entered tenant under the account it resolved to', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, listings } = createHarness([account], [tenant1]);

        const typedTenantId = 'AAAAAAAA-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        // The tenant-scoped sign-in resolves to a concrete account, which is the
        // account the manual tenant is persisted under.
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
        respondToPrompts(mockResult, [{ value: typedTenantId }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // Persisted under the resolved account id, with the tenant id lowercased
        // to match how listed tenants are stored.
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([
            { accountId: 'resolved-account', tenantId: typedTenantId.toLowerCase() },
        ]);
    });

    it('should not persist a manually-entered tenant that is already saved', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, listings } = createHarness([account], [tenant1]);

        const typedTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const { ctx, mock: mockResult } = createMockCodeContext();
        // Seed the setting with the same entry (different casing) already present.
        mockResult.settings.set(settingKey, [
            { accountId: 'resolved-account', tenantId: typedTenantId.toUpperCase() },
        ]);
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
        respondToPrompts(mockResult, [{ value: typedTenantId }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // Idempotent: the pre-existing entry is left untouched (not duplicated).
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([
            { accountId: 'resolved-account', tenantId: typedTenantId.toUpperCase() },
        ]);
    });

    it('should not persist anything when signing in to a listed tenant', async () => {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        const tenant1 = makeTenant({ tenantId: 'tenant-1', displayName: 'Tenant One', accountId: account.id });
        const { tree, listings } = createHarness([account], [tenant1]);

        const { ctx, mock: mockResult } = createMockCodeContext();
        mockResult.authentication.getSession.mock.mockImplementation((() => Promise.resolve(fakeSession)) as never);
        respondToPrompts(mockResult, [{ pick: 'Tenant One (tenant-1)' }]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        // A listed tenant is already reachable, so there's nothing to persist.
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([]);
    });

    it('should offer a tenant sign-in when default sign-in fails', async () => {
        const { tree, invalidate, listings } = createHarness([]);
        const { ctx, mock: mockResult } = createMockCodeContext();

        // Default sign-in (no VSCODE_TENANT scope) fails; the tenant-scoped
        // sign-in succeeds.
        mockResult.authentication.getSession.mock.mockImplementation(((_id: string, scopes: readonly string[]) => {
            return scopes.some(s => s.startsWith('VSCODE_TENANT:'))
                ? Promise.resolve(fakeSession)
                : Promise.reject(new Error('conditional access blocked'));
        }) as unknown as typeof mockResult.authentication.getSession);

        // The user accepts the "enter tenant ID" recovery prompt and pastes a
        // tenant GUID.
        const manualTenantId = 'bbbbbbbb-1111-2222-3333-444455556666';
        respondToPrompts(mockResult, [
            { button: 'Enter Tenant ID' },
            { value: manualTenantId },
        ]);
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await command.execute();

        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(1);

        const calls = mockResult.authentication.getSession.mock.calls;
        expect(calls.length).to.equal(2);
        const [, scopes, options] = calls[1].arguments as [string, string[], { account?: { id: string } }];
        expect(scopes).to.include(`VSCODE_TENANT:${manualTenantId}`);
        expect(options.account).to.be.undefined;

        // The manually-entered tenant is newly persisted, and
        // AzureAccountDataProvider's configuration listener refreshes the tree in
        // response, so SignIn does not invalidate the cache directly.
        expect(invalidate.mock.callCount()).to.equal(0);
        expect(readPersistedTenants(mockResult.settings)).to.deep.equal([
            { accountId: 'resolved-account', tenantId: manualTenantId },
        ]);
    });

    it('should cancel without another sign-in attempt when the fallback is dismissed', async () => {
        const { tree, invalidate, listings } = createHarness([]);
        const { ctx, mock: mockResult } = createMockCodeContext();

        mockResult.authentication.getSession.mock.mockImplementation((): Promise<never> => Promise.reject(new Error('conditional access blocked')));
        // No message response queued => the recovery prompt is dismissed.
        const credentialFactory = createCredentialFactory(ctx.code);

        const command = new SignIn(ctx, tree, listings, credentialFactory);
        await expect(command.execute()).to.be.rejectedWith(CancellationError);

        // Only the failed default sign-in was attempted.
        expect(mockResult.authentication.getSession.mock.calls.length).to.equal(1);
        expect(invalidate.mock.callCount()).to.equal(0);
    });
});

describe('pickTenantOrEnterId (unit)', () => {
    function makeReachableTenant(tenantId: string, displayName: string): ReachableTenant {
        const account = makeAccount({ id: 'acct-1', label: 'Account One' });
        return { account, tenant: makeTenant({ tenantId, displayName, accountId: account.id }) };
    }

    it('should offer a synthetic sign-in item for a pasted tenant GUID', async () => {
        const { ctx, mock } = createMockCodeContext();
        const tenantId = 'aaaaaaaa-1111-2222-3333-444455556666';

        const resultPromise = pickTenantOrEnterId(ctx, [makeReachableTenant('tenant-1', 'Tenant One')]);

        const qp = mock.quickPicks[0];
        qp.changeValue(tenantId);

        // The synthetic "sign in to <id>" item is listed after the suggestion.
        const synthetic = qp.items[qp.items.length - 1];
        expect(synthetic.label).to.equal(`Sign in to tenant: ${tenantId}`);

        qp.accept();
        const pick = await resultPromise;
        expect(pick.tenantId).to.equal(tenantId);
        // A typed tenant ID has no known account context.
        expect(pick.accountId).to.be.undefined;
    });

    it('should not offer a synthetic item when the typed value is not a GUID', async () => {
        const { ctx, mock } = createMockCodeContext();

        const resultPromise = pickTenantOrEnterId(ctx, [makeReachableTenant('tenant-1', 'Tenant One')]);

        const qp = mock.quickPicks[0];
        // Users never type a tenant GUID -- a non-GUID value is a filter, so no
        // synthetic sign-in item should be offered.
        qp.changeValue('Tenant');

        expect(qp.items.some(item => item.label.startsWith('Sign in to tenant:'))).to.be.false;
        expect(qp.items).to.have.length(1);

        // Activate and accept the remaining suggestion so the prompt resolves
        // (the mock does not auto-activate filtered items the way VS Code does).
        qp.activeItems = [qp.items[0]];
        qp.accept();
        const pick = await resultPromise;
        expect(pick.tenantId).to.equal('tenant-1');
        expect(pick.accountId).to.equal('acct-1');
    });
});
