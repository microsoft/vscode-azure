/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzurePublicCloud, PublicAuthProviderId, SubscriptionClient, type AzureAccount, type AzureSubscription, type AzureTenant, type ConcreteAzureNode, type CredentialFactoryOptions, type ICredentialFactory } from '@microsoft/vscode-azure-azutils';
import { createMockSubscriptionClient, makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant, type MockSubscriptionClientOptions } from '@microsoft/vscode-azure-azutils/testing';
import { Everything, Roots, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { collectPages, createMockCodeContext, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AzureAccountDataProvider } from '../../../src/tree/resources/AzureAccountDataProvider';
import { ConfigurationSection, SignedInTenantsConfigurationKey } from '../../../src/constants';

describe('AzureAccountDataProvider (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    function createProvider() {
        const { ctx, mock } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credentialFactory = () => makeCredential();
        const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory);
        return { provider, mock };
    }

    /**
     * Replaces the static {@linkcode SubscriptionClient.create} factory with a
     * {@linkcode createMockSubscriptionClient} whose `tenants.list` /
     * `subscriptions.list` yield the supplied pages, so the provider's lazy page
     * streaming can be asserted without real HTTP.
     */
    function mockSubscriptionClient(options: MockSubscriptionClientOptions) {
        return mock.method(SubscriptionClient, 'create', () => createMockSubscriptionClient(options) as never);
    }

    /**
     * Replaces {@linkcode SubscriptionClient.create} with a client whose
     * `tenants.list` throws when iterated, simulating a tenant-listing failure
     * (e.g. conditional access blocking tenant enumeration).
     */
    function mockSubscriptionClientFailingTenantList(error: Error) {
        const throwingTenants: AsyncIterable<never> = {
            [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
        };
        const emptySubscriptions: AsyncIterable<never> = {
            [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
        };
        return mock.method(SubscriptionClient, 'create', () => ({
            tenants: { list: () => throwingTenants },
            subscriptions: { list: () => emptySubscriptions, listLocations: () => Promise.resolve([]) },
        }) as never);
    }

    /**
     * Yield several event-loop turns (e.g. to let the async session-change
     * reconcile complete) while fake timers are enabled. `setImmediate` is not
     * faked, so awaiting it advances past one event-loop turn, allowing queued
     * promise continuations -- the `await listAccounts()` chain in the
     * debounced session handler -- to run to completion.
     *
     * The reconcile is dispatched fire-and-forget (`void reconcile()`) from the
     * debounce timer callback, and `reconcile -> listAccounts -> await
     * getAccounts` spans several async hops. A single `setImmediate` is not
     * guaranteed to let that whole chain settle before the caller asserts on it:
     * depending on how the host event loop interleaves the (faked) timer
     * callback with real microtasks and immediates, the reconcile can still be
     * in flight after one turn, which made the assertions flaky. Awaiting a few
     * turns settles the chain deterministically -- once it has finished, the
     * extra turns are harmless no-ops.
     */
    async function flushMicrotasks(turns = 5): Promise<void> {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    describe('canHandle', () => {
        it('should return true for account nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeAccount())).to.be.true;
        });

        it('should return true for tenant nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeTenant())).to.be.true;
        });

        it('should return false for subscription nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeSubscription())).to.be.false;
        });

        it('should return false for resource group nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeResourceGroup())).to.be.false;
        });

        it('should return false for generic resources', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for null/undefined', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle(undefined)).to.be.false;
        });
    });

    describe('getTtl', () => {
        it('should return Infinity so account/tenant/subscription data never goes stale on its own', () => {
            const { provider } = createProvider();
            expect(provider.getTtl()).to.equal(Infinity);
        });
    });

    describe('isRoot', () => {
        it('should be a root provider', () => {
            const { provider } = createProvider();
            expect(provider.isRoot).to.be.true;
        });
    });

    describe('onDidChange', () => {
        // Session-change handling debounces via setTimeout and gates on
        // Date.now(); fake both so the timing can be driven deterministically.
        beforeEach(() => {
            mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        });

        afterEach(() => {
            mock.timers.reset();
        });

        it('should emit a reconciling root re-list (debounced) on the first authentication session change for the Microsoft provider', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });

            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            // Debounced: nothing fires until the timer elapses.
            expect(fired).to.equal(0);

            mock.timers.tick(500);
            await flushMicrotasks();

            // First event (no prior known set), so the reconcile fires. A
            // reconciling root re-list (target Roots) preserves tenant /
            // subscription subtrees under surviving accounts.
            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Roots);
        });

        it('should not fire on authentication session changes for unrelated providers', () => {
            const { provider, mock: vscodeMock } = createProvider();
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: 'github', label: 'GitHub' } });
            mock.timers.tick(500);

            expect(fired).to.equal(0);
        });

        it('should coalesce a burst of session changes into a single re-list', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            for (let i = 0; i < 5; i++) {
                vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            }
            mock.timers.tick(500);
            await flushMicrotasks();

            expect(fired).to.equal(1);
        });

        it('should fire a reconciling re-list when an account is added (sign-in)', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });

            // Prime the known account set with a single account.
            await provider.getChildren();
            // Move past the self-induced suppression window armed by listAccounts.
            mock.timers.tick(1001);

            // A new account signs in.
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([
                { id: 'a-id', label: 'Alpha' },
                { id: 'b-id', label: 'Beta' },
            ]));
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Roots);
        });

        it('should fire a reconciling re-list when an account is removed (sign-out)', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([
                { id: 'a-id', label: 'Alpha' },
                { id: 'b-id', label: 'Beta' },
            ]));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            await provider.getChildren();
            mock.timers.tick(1001);

            // One account signs out.
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            expect(fired).to.equal(1);
        });

        it('should NOT fire when the signed-in account set is unchanged', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            // Prime the known account set, then move past the suppression window.
            await provider.getChildren();
            mock.timers.tick(1001);

            // A session event arrives but the account set is identical: the vast
            // majority of onDidChangeSessions events (token refreshes, re-auth,
            // other extensions' activity) look like this and must be ignored.
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            expect(fired).to.equal(0);
        });

        it('should not loop when listing accounts itself emits onDidChangeSessions', async () => {
            // Guards against a historical auth-provider bug where calling
            // getAccounts() re-emitted onDidChangeSessions, which could otherwise
            // feed back into another re-list. Two defenses combine here: the
            // in-flight suppression window swallows the re-entrant event, and the
            // unchanged-account-set check stops any event that slips through.
            const { provider, mock: vscodeMock } = createProvider();
            const getAccountsMock = vscodeMock.authentication.getAccounts.mock;
            getAccountsMock.mockImplementation(() => {
                // Re-emit a session change synchronously, as the buggy provider did.
                vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
                return Promise.resolve([{ id: 'a-id', label: 'Alpha' }]);
            });
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            // The first event drives exactly one reconcile (one getAccounts call)
            // and one onDidChange; the re-entrant event it triggers is suppressed.
            expect(getAccountsMock.callCount()).to.equal(1);
            expect(fired).to.equal(1);

            // Advancing time must not surface any further re-lists.
            mock.timers.tick(5000);
            await flushMicrotasks();
            expect(getAccountsMock.callCount()).to.equal(1);
            expect(fired).to.equal(1);
        });

        it('should swallow a listAccounts failure during reconcile instead of rejecting', async () => {
            // The debounced reconcile runs fire-and-forget, and listAccounts can
            // throw (a transient getAccounts failure, or getConfiguredAzureEnv
            // throwing on a misconfigured custom cloud). It must be caught so it
            // does not surface as an unhandled rejection.
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.reject(new Error('transient auth failure')));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            // No change event fired, and the rejection was swallowed (the test
            // completing without an unhandled rejection is the assertion).
            expect(fired).to.equal(0);
        });

        it('should suppress session-change events that occur within its own getAccounts window', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            // Listing accounts opens the suppression window.
            await provider.getChildren();

            // An event arriving inside the window is ignored, so nothing is scheduled.
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

            expect(fired).to.equal(0);
        });

        it('should resume handling session-change events after the suppression window elapses', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));
            let fired = 0;
            const didChange = new Promise<void>(resolve => {
                provider.onDidChange(() => {
                    fired++;
                    resolve();
                });
            });

            await provider.getChildren();

            // Advance past the suppression window. An account then signs in, so
            // the resumed event represents a real change.
            mock.timers.tick(1001);
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await didChange;

            expect(fired).to.equal(1);
        });

        it('should keep suppressing while getAccounts is in flight, even past the trailing-window duration', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            let resolveGetAccounts!: (accounts: AzureAccount[]) => void;
            vscodeMock.authentication.getAccounts.mock.mockImplementation(
                () => new Promise<AzureAccount[]>(resolve => { resolveGetAccounts = resolve; }),
            );
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            // Start listing accounts; getAccounts() stays pending (a slow call).
            const childrenPromise = provider.getChildren();

            // Simulate a slow call by advancing well past GetAccountsSuppressionMs
            // (1000ms) while getAccounts() has not yet resolved. A purely
            // timestamp-based window would have lapsed by now.
            mock.timers.tick(5000);

            // A self-induced event arriving mid-call must still be suppressed.
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();
            expect(fired).to.equal(0);

            // Let the in-flight call complete so the promise settles.
            resolveGetAccounts([]);
            await childrenPromise;
        });

        it('should emit a full invalidation (undebounced) when the sovereign cloud configuration changes', () => {
            const { provider, mock: vscodeMock } = createProvider();
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });

            vscodeMock.configChangeEmitter.fire({ affectsConfiguration: section => section === 'microsoft-sovereign-cloud' });

            // Configuration changes invalidate immediately (the environment changed).
            expect(fired).to.equal(1);
            // The environment itself changed, so every listing fetched against
            // the old endpoint is invalid -- wipe everything.
            expect(event?.target).to.equal(Everything);
        });

        it('should emit a full invalidation when the signed-in tenants configuration changes', () => {
            const { provider, mock: vscodeMock } = createProvider();
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });

            const key = `${ConfigurationSection}.${SignedInTenantsConfigurationKey}`;
            vscodeMock.configChangeEmitter.fire({ affectsConfiguration: section => section === key });

            // The manually-entered tenants (folded into each account's tenant
            // listing) changed, so re-list to surface added/removed tenants.
            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Everything);
        });

        it('should ignore unrelated configuration changes', () => {
            const { provider, mock: vscodeMock } = createProvider();
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            vscodeMock.configChangeEmitter.fire({ affectsConfiguration: () => false });

            expect(fired).to.equal(0);
        });
    });

    describe('getChildren', () => {
        it('should list signed-in accounts sorted by label with the environment attached', async () => {
            const { provider, mock } = createProvider();
            mock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([
                { id: 'b-id', label: 'Beta' },
                { id: 'a-id', label: 'Alpha' },
            ]));

            const accounts = await provider.getChildren() as AzureAccount[];

            expect(accounts.map(a => a.label)).to.deep.equal(['Alpha', 'Beta']);
            expect(accounts.every(a => a.environment === AzurePublicCloud)).to.be.true;
        });

        it('should query accounts using the configured environment auth provider', async () => {
            const { provider, mock } = createProvider();
            mock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));

            await provider.getChildren();

            expect(mock.authentication.getAccounts.mock.calls[0].arguments[0]).to.equal(PublicAuthProviderId);
        });

        it('should not eagerly acquire a credential when listing accounts at the root', async () => {
            const getToken = mock.fn(() => Promise.resolve({ token: 'tok', expiresOnTimestamp: Date.now() + 3600000 }));
            const { ctx, mock: vscodeMock } = createMockCodeContext();
            const { executor } = createTestActionExecutor();
            const provider = new AzureAccountDataProvider(ctx, executor, () => ({ getToken }));
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));

            await provider.getChildren();

            // The root list only enumerates already-signed-in accounts; the user
            // is prompted lazily when an operation needs a credential.
            expect(getToken.mock.callCount()).to.equal(0);
        });

        it('should throw for an unsupported resource type', async () => {
            const { provider, mock } = createProvider();
            mock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));

            let error: unknown;
            try {
                await provider.getChildren(makeGenericResource());
            } catch (e) {
                error = e;
            }
            expect((error as Error).message).to.include('Unsupported resource type');
        });
    });

    describe('getChildren tenant paging', () => {
        it('should stream tenants across multiple pages preserving hasMore', async () => {
            const { provider } = createProvider();
            const account = makeAccount();
            mockSubscriptionClient({
                tenantPages: [
                    { items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: true },
                    { items: [{ tenantId: 't2', displayName: 'Tenant Two' }], hasMore: false },
                ],
            });

            const pages = await collectPages(await provider.getChildren(account));

            expect(pages).to.have.length(2);
            expect(pages[0].hasMore).to.be.true;
            expect(pages[1].hasMore).to.be.false;
            expect(pages.flatMap(p => (p.items as AzureTenant[]).map(t => t.tenantId))).to.deep.equal(['t1', 't2']);
        });

        it('should attach the account id and environment to each tenant', async () => {
            const { provider } = createProvider();
            const account = makeAccount();
            mockSubscriptionClient({
                tenantPages: [{ items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: false }],
            });

            const pages = await collectPages(await provider.getChildren(account));

            const tenant = (pages[0].items as AzureTenant[])[0];
            expect(tenant.accountId).to.equal(account.id);
            expect(tenant.environment).to.equal(AzurePublicCloud);
        });

        it('should filter out tenants missing a tenantId or displayName', async () => {
            const { provider } = createProvider();
            const account = makeAccount();
            mockSubscriptionClient({
                tenantPages: [{
                    items: [
                        { tenantId: undefined, displayName: 'No Id' },
                        { tenantId: 't2', displayName: undefined },
                        { tenantId: 't3', displayName: 'Valid' },
                    ],
                    hasMore: false,
                }],
            });

            const pages = await collectPages(await provider.getChildren(account));

            expect((pages[0].items as AzureTenant[]).map(t => t.tenantId)).to.deep.equal(['t3']);
        });
    });

    describe('getChildren tenant paging with manually-entered tenants', () => {
        const signedInTenantsKey = `${ConfigurationSection}.${SignedInTenantsConfigurationKey}`;

        /**
         * Run `callback` with the persisted manual-tenant setting seeded in the
         * mock configuration, restoring the previous value afterward. `entries`
         * is typed loosely so tests can also feed deliberately malformed data.
         */
        function withSignedInTenants<T>(
            mockVsCode: ReturnType<typeof createProvider>['mock'],
            entries: readonly unknown[],
            callback: () => T | Promise<T>,
        ): T | Promise<T> {
            return withSettings(mockVsCode, { [signedInTenantsKey]: entries }, callback);
        }

        // Signed-in tenant ids must be canonical GUIDs (non-GUID entries are
        // treated as malformed and dropped).
        const manualTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const otherTenantId = 'bbbbbbbb-1111-2222-3333-444455556666';
        const listedTenantId = 'cccccccc-1111-2222-3333-444455556666';

        it('should append a saved tenant (not in the listing) to the final page', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClient({
                tenantPages: [{ items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: false }],
            });

            await withSignedInTenants(vscodeMock, [{ accountId: 'acct-1', tenantId: manualTenantId }], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                expect(pages).to.have.length(1);
                const tenants = pages[0].items as AzureTenant[];
                // Listed tenant first, saved tenant appended after it.
                expect(tenants.map(t => t.tenantId)).to.deep.equal(['t1', manualTenantId]);
                // No display name is available for a saved tenant, so the id stands in.
                const manual = tenants.find(t => t.tenantId === manualTenantId)!;
                expect(manual.displayName).to.equal(manualTenantId);
                expect(manual.accountId).to.equal('acct-1');
            });
        });

        it('should append saved tenants only to the final page when listing spans multiple pages', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClient({
                tenantPages: [
                    { items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: true },
                    { items: [{ tenantId: 't2', displayName: 'Tenant Two' }], hasMore: false },
                ],
            });

            await withSignedInTenants(vscodeMock, [{ accountId: 'acct-1', tenantId: manualTenantId }], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                expect(pages).to.have.length(2);
                expect((pages[0].items as AzureTenant[]).map(t => t.tenantId)).to.deep.equal(['t1']);
                expect(pages[0].hasMore).to.be.true;
                // The saved tenant rides along on the terminal page, not an earlier one.
                expect((pages[1].items as AzureTenant[]).map(t => t.tenantId)).to.deep.equal(['t2', manualTenantId]);
                expect(pages[1].hasMore).to.be.false;
            });
        });

        it('should deduplicate a saved tenant that is also listed, preferring the listed display name', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClient({
                tenantPages: [{ items: [{ tenantId: listedTenantId.toUpperCase(), displayName: 'Tenant One' }], hasMore: false }],
            });

            // Saved id matches a listed tenant (case-insensitively).
            await withSignedInTenants(vscodeMock, [{ accountId: 'acct-1', tenantId: listedTenantId }], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                const tenants = pages[0].items as AzureTenant[];
                expect(tenants.map(t => t.tenantId)).to.deep.equal([listedTenantId]);
                // The listed tenant wins, keeping its real display name.
                expect(tenants[0].displayName).to.equal('Tenant One');
            });
        });

        it('should only include saved tenants belonging to the account being listed', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            // Listing yields no tenants (default single empty page).
            mockSubscriptionClient({ tenantPages: [{ items: [], hasMore: false }] });

            await withSignedInTenants(vscodeMock, [
                { accountId: 'other-acct', tenantId: otherTenantId },
                { accountId: 'acct-1', tenantId: manualTenantId },
            ], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                const tenantIds = pages.flatMap(p => (p.items as AzureTenant[]).map(t => t.tenantId));
                expect(tenantIds).to.deep.equal([manualTenantId]);
            });
        });

        it('should match a saved tenant whose account id differs only in casing', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'Acct-1' });
            mockSubscriptionClient({ tenantPages: [{ items: [], hasMore: false }] });

            // Saved under a different casing than the account being listed; the
            // account id is compared case-insensitively so it still matches.
            await withSignedInTenants(vscodeMock, [{ accountId: 'acct-1', tenantId: manualTenantId }], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                const tenantIds = pages.flatMap(p => (p.items as AzureTenant[]).map(t => t.tenantId));
                expect(tenantIds).to.deep.equal([manualTenantId]);
            });
        });

        it('should fall back to saved tenants when listing tenants fails outright', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClientFailingTenantList(new Error('conditional access blocked'));

            await withSignedInTenants(vscodeMock, [{ accountId: 'acct-1', tenantId: manualTenantId }], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                // The thrown listing error is swallowed; the saved tenant is surfaced
                // as the terminal page so the tree can still reach it.
                const tenants = pages.flatMap(p => p.items as AzureTenant[]);
                expect(tenants.map(t => t.tenantId)).to.deep.equal([manualTenantId]);
                expect(pages[pages.length - 1].hasMore).to.be.false;
            });
        });

        it('should yield an empty terminal page when listing fails and no tenants are saved', async () => {
            const { provider } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClientFailingTenantList(new Error('conditional access blocked'));

            const pages = await collectPages(await provider.getChildren(account));

            const tenants = pages.flatMap(p => p.items as AzureTenant[]);
            expect(tenants).to.have.length(0);
            expect(pages[pages.length - 1].hasMore).to.be.false;
        });

        it('should ignore malformed saved entries (user-editable setting)', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClientFailingTenantList(new Error('conditional access blocked'));

            // The setting is hand-editable, so tolerate junk: missing fields, an
            // empty tenant id, a non-object, and a tenant id that isn't a GUID are
            // all dropped; only the well-formed entry for this account surfaces.
            await withSignedInTenants(vscodeMock, [
                { accountId: 'acct-1' },
                { tenantId: otherTenantId },
                { accountId: 'acct-1', tenantId: '' },
                { accountId: 'acct-1', tenantId: 'not-a-guid' },
                'not-an-object',
                { accountId: 'acct-1', tenantId: manualTenantId },
            ], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                const tenantIds = pages.flatMap(p => (p.items as AzureTenant[]).map(t => t.tenantId));
                expect(tenantIds).to.deep.equal([manualTenantId]);
            });
        });

        it('should deduplicate saved tenants that differ only in casing', async () => {
            const { provider, mock: vscodeMock } = createProvider();
            const account = makeAccount({ id: 'acct-1' });
            mockSubscriptionClientFailingTenantList(new Error('conditional access blocked'));

            // The setting is hand-editable, so the same tenant can be saved more
            // than once (e.g. differing casing); it must surface only once.
            await withSignedInTenants(vscodeMock, [
                { accountId: 'acct-1', tenantId: manualTenantId.toUpperCase() },
                { accountId: 'acct-1', tenantId: manualTenantId },
            ], async () => {
                const pages = await collectPages(await provider.getChildren(account));

                const tenantIds = pages.flatMap(p => (p.items as AzureTenant[]).map(t => t.tenantId));
                expect(tenantIds).to.deep.equal([manualTenantId]);
            });
        });
    });

    describe('getChildren subscription paging', () => {
        it('should stream subscriptions across multiple pages preserving hasMore', async () => {
            const { provider } = createProvider();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [
                    { items: [{ subscriptionId: 's1', tenantId: tenant.tenantId, displayName: 'Sub One' }], hasMore: true },
                    { items: [{ subscriptionId: 's2', tenantId: tenant.tenantId, displayName: 'Sub Two' }], hasMore: false },
                ],
            });

            const pages = await collectPages(await provider.getChildren(tenant));

            expect(pages).to.have.length(2);
            expect(pages[0].hasMore).to.be.true;
            expect(pages[1].hasMore).to.be.false;
            expect(pages.flatMap(p => (p.items as AzureSubscription[]).map(s => s.subscriptionId))).to.deep.equal(['s1', 's2']);
        });

        it('should attach the account id and environment to each subscription', async () => {
            const { provider } = createProvider();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [{ items: [{ subscriptionId: 's1', tenantId: tenant.tenantId, displayName: 'Sub One' }], hasMore: false }],
            });

            const pages = await collectPages(await provider.getChildren(tenant));

            const sub = (pages[0].items as AzureSubscription[])[0];
            expect(sub.tenantId).to.equal(tenant.tenantId);
            expect(sub.accountId).to.equal(tenant.accountId);
            expect(sub.environment).to.equal(tenant.environment);
        });

        it('should filter out subscriptions missing a subscriptionId, tenantId, or displayName', async () => {
            const { provider } = createProvider();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [{
                    items: [
                        { subscriptionId: undefined, tenantId: tenant.tenantId, displayName: 'No Id' },
                        { subscriptionId: 's2', tenantId: undefined, displayName: 'No Tenant' },
                        { subscriptionId: 's3', tenantId: tenant.tenantId, displayName: undefined },
                        { subscriptionId: 's4', tenantId: tenant.tenantId, displayName: 'Valid' },
                    ],
                    hasMore: false,
                }],
            });

            const pages = await collectPages(await provider.getChildren(tenant));

            expect((pages[0].items as AzureSubscription[]).map(s => s.subscriptionId)).to.deep.equal(['s4']);
        });

        it('should scope the per-tenant credential to the tenant and account without requesting silent auth', async () => {
            const inputs: CredentialFactoryOptions[] = [];
            const { ctx } = createMockCodeContext();
            const { executor } = createTestActionExecutor();
            const credentialFactory: ICredentialFactory = (input) => {
                inputs.push(input as CredentialFactoryOptions);
                return makeCredential();
            };
            const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory);
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [{ items: [{ subscriptionId: 's1', tenantId: tenant.tenantId, displayName: 'Sub One' }], hasMore: false }],
            });

            await collectPages(await provider.getChildren(tenant));

            // The provider forwards only per-node scoping; ambient options (e.g.
            // silent) are applied by the credential factory, not the provider.
            expect(inputs[0]?.tenantId).to.equal(tenant.tenantId);
            expect(inputs[0]?.sessionOptions?.account?.id).to.equal(tenant.accountId);
            expect(inputs[0]?.sessionOptions?.silent).to.be.undefined;
        });
    });

    describe('enrich', () => {
        // A manually-entered tenant carries a placeholder display name equal to
        // its id (lowercased), because listing was blocked when it was saved.
        const manualTenantId = 'aaaaaaaa-1111-2222-3333-444455556666';
        const otherTenantId = 'bbbbbbbb-1111-2222-3333-444455556666';

        /** Build a placeholder (manually-entered) tenant: displayName === id. */
        function makePlaceholderTenant(overrides?: Partial<AzureTenant>): AzureTenant {
            return makeTenant({ tenantId: manualTenantId, displayName: manualTenantId, accountId: 'acct-1', ...overrides });
        }

        it('should upgrade a placeholder tenant to its real display name', async () => {
            const { provider } = createProvider();
            const tenant = makePlaceholderTenant();
            mockSubscriptionClient({
                // Match returned case-insensitively; the real name differs from the id.
                tenantPages: [{ items: [{ tenantId: manualTenantId.toUpperCase(), displayName: 'Contoso' }], hasMore: false }],
            });

            const includeChildren = await provider.enrich(tenant);

            expect(tenant.displayName).to.equal('Contoso');
            // The name doesn't affect subscriptions, so children are untouched.
            expect(includeChildren).to.be.false;
        });

        it('should enrich even when the tenant id is not lowercase (case-insensitive match)', async () => {
            const { provider } = createProvider();
            // A mixed-case id defies the producer's lowercase invariant; enrich
            // must still match the (lowercase) listing entry and upgrade the
            // placeholder rather than silently no-op.
            const tenant = makeTenant({ tenantId: manualTenantId.toUpperCase(), displayName: manualTenantId.toUpperCase(), accountId: 'acct-1' });
            mockSubscriptionClient({
                tenantPages: [{ items: [{ tenantId: manualTenantId, displayName: 'Contoso' }], hasMore: false }],
            });

            await provider.enrich(tenant);

            expect(tenant.displayName).to.equal('Contoso');
        });

        it('should leave a placeholder tenant untouched when the listing is still blocked', async () => {
            const { provider } = createProvider();
            const tenant = makePlaceholderTenant();
            mockSubscriptionClientFailingTenantList(new Error('conditional access'));

            const includeChildren = await provider.enrich(tenant);

            // Silent acquisition / listing failed: keep the id placeholder, no throw.
            expect(tenant.displayName).to.equal(manualTenantId);
            expect(includeChildren).to.be.false;
        });

        it('should ignore a matching entry that still only carries the id', async () => {
            const { provider } = createProvider();
            const tenant = makePlaceholderTenant();
            mockSubscriptionClient({
                // The service echoes the id as the name (no real name yet).
                tenantPages: [{ items: [{ tenantId: manualTenantId, displayName: manualTenantId }], hasMore: false }],
            });

            await provider.enrich(tenant);

            expect(tenant.displayName).to.equal(manualTenantId);
        });

        it('should leave a placeholder tenant untouched when the listing omits it', async () => {
            const { provider } = createProvider();
            const tenant = makePlaceholderTenant();
            mockSubscriptionClient({
                // The listing succeeds but returns a different tenant, so there is no match.
                tenantPages: [{ items: [{ tenantId: otherTenantId, displayName: 'Fabrikam' }], hasMore: false }],
            });

            const includeChildren = await provider.enrich(tenant);

            expect(tenant.displayName).to.equal(manualTenantId);
            expect(includeChildren).to.be.false;
        });

        it('should skip a tenant that was listed normally without any network call', async () => {
            const { provider } = createProvider();
            // A listed tenant already carries a real name (displayName !== id).
            const tenant = makeTenant({ tenantId: manualTenantId, displayName: 'Already Named', accountId: 'acct-1' });
            const createSpy = mockSubscriptionClient({ tenantPages: [] });

            const includeChildren = await provider.enrich(tenant);

            expect(tenant.displayName).to.equal('Already Named');
            expect(createSpy.mock.callCount()).to.equal(0);
            expect(includeChildren).to.be.false;
        });

        it('should skip account nodes without any network call', async () => {
            const { provider } = createProvider();
            const createSpy = mockSubscriptionClient({ tenantPages: [] });

            const includeChildren = await provider.enrich(makeAccount({ id: 'acct-1' }));

            expect(createSpy.mock.callCount()).to.equal(0);
            expect(includeChildren).to.be.false;
        });

        it('should request a tenant-scoped, silent credential and its own client per tenant', async () => {
            const inputs: CredentialFactoryOptions[] = [];
            const { ctx } = createMockCodeContext();
            const { executor } = createTestActionExecutor();
            const credentialFactory: ICredentialFactory = (input) => {
                inputs.push(input as CredentialFactoryOptions);
                return makeCredential();
            };
            const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory);
            const createSpy = mockSubscriptionClient({
                tenantPages: [{
                    items: [
                        { tenantId: manualTenantId, displayName: 'Contoso' },
                        { tenantId: otherTenantId, displayName: 'Fabrikam' },
                    ],
                    hasMore: false,
                }],
            });

            const first = makePlaceholderTenant();
            const second = makePlaceholderTenant({ tenantId: otherTenantId, displayName: otherTenantId });
            await Promise.all([provider.enrich(first), provider.enrich(second)]);

            expect(first.displayName).to.equal('Contoso');
            expect(second.displayName).to.equal('Fabrikam');
            // Each tenant needs its own tenant-scoped token, so each builds its
            // own client -- there is no sharing (and nothing to dedupe): the
            // account-scoped listing is exactly what conditional access blocks.
            expect(createSpy.mock.callCount()).to.equal(2);
            expect(inputs).to.have.length(2);
            for (const input of inputs) {
                expect(input.tenantId).to.be.oneOf([manualTenantId, otherTenantId]);
                expect(input.sessionOptions?.account?.id).to.equal('acct-1');
                expect(input.sessionOptions?.silent).to.be.true;
            }
            expect(inputs.map(i => i.tenantId)).to.have.members([manualTenantId, otherTenantId]);
        });
    });
});
