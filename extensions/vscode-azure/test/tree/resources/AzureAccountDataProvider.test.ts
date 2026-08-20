/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureListingCache, PublicAuthProviderId, SubscriptionClient, type AzureSubscription, type AzureTenant, type ConcreteAzureNode, type CredentialFactoryOptions, type IAzureListingFetcher, type ICredentialFactory } from '@microsoft/vscode-azure-azutils';
import { createMockAzureListingFetcher, createMockSubscriptionClient, makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant, type MockSubscriptionClientOptions } from '@microsoft/vscode-azure-azutils/testing';
import { collectPages, Everything, Roots, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, ManualDebounceScheduler, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey, SignedInTenantsConfigurationKey } from '../../../src/constants';
import { AzureAccountDataProvider } from '../../../src/tree/resources/AzureAccountDataProvider';

const account = makeAccount({ id: 'acct-1', label: 'Alpha' });
const tenantA = makeTenant({ accountId: account.id, tenantId: 'aaaaaaaa-1111-2222-3333-444455556666', displayName: 'Tenant A' });
const tenantB = makeTenant({ accountId: account.id, tenantId: 'bbbbbbbb-1111-2222-3333-444455556666', displayName: 'Tenant B' });
const subA = makeSubscription({ accountId: account.id, tenantId: tenantA.tenantId, subscriptionId: 'sub-a', displayName: 'Sub A' });
const subB = makeSubscription({ accountId: account.id, tenantId: tenantB.tenantId, subscriptionId: 'sub-b', displayName: 'Sub B' });

const selectedSubscriptionsKey = `${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`;

describe('AzureAccountDataProvider (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    function createProvider(fetcherOverrides?: Partial<IAzureListingFetcher>) {
        const { ctx, mock: code } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const fetcher = Object.assign(
            createMockAzureListingFetcher({
                accounts: [account],
                tenants: [tenantA, tenantB],
                subscriptions: [subA, subB],
            }),
            fetcherOverrides,
        );
        const listings = new AzureListingCache(fetcher, executor);
        const scheduler = new ManualDebounceScheduler();
        const credentialFactory: ICredentialFactory = () => makeCredential();
        const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory, listings, scheduler);
        return { provider, code, scheduler, fetcher, listings };
    }

    /** Serve `tenants.list` from canned pages, for the enrichment path. */
    function mockSubscriptionClient(options: MockSubscriptionClientOptions) {
        return mock.method(SubscriptionClient, 'create', () => createMockSubscriptionClient(options) as never);
    }

    /** Serve a client whose `tenants.list` rejects, as conditional access does. */
    function mockSubscriptionClientFailingTenantList(error: Error) {
        const throwing: AsyncIterable<never> = {
            [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
        };
        return mock.method(SubscriptionClient, 'create', () => ({
            tenants: { list: () => throwing },
            subscriptions: { list: () => createMockSubscriptionClient().subscriptions.list(), listLocations: () => Promise.resolve([]) },
        }) as never);
    }

    /** The tenant ids the provider handed out for the account. */
    async function tenantIdsOf(provider: AzureAccountDataProvider): Promise<string[]> {
        const pages = await collectPages(await provider.getChildren(account));
        return pages.flatMap(page => (page.items as AzureTenant[]).map(tenant => tenant.tenantId));
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

    describe('getChildren', () => {
        it('should list accounts, tenants, and subscriptions', async () => {
            const { provider } = createProvider();

            const accounts = await provider.getChildren() as ConcreteAzureNode[];
            const tenants = await collectPages(await provider.getChildren(account));
            const subscriptions = await collectPages(await provider.getChildren(tenantA));

            expect(accounts).to.deep.equal([account]);
            expect(tenants.flatMap(page => page.items)).to.deep.equal([tenantA, tenantB]);
            expect(subscriptions.flatMap(page => page.items)).to.deep.equal([subA]);
        });

        it('should throw for an unsupported resource type', () => {
            const { provider } = createProvider();

            // `getChildren` is not `async`, so this surfaces as a synchronous throw.
            expect(() => provider.getChildren(makeGenericResource())).to.throw('Unsupported resource type');
        });
    });

    describe('getChildren with a subscription filter', () => {
        it('should issue no request for a tenant the filter excludes', async () => {
            const { provider, code, fetcher } = createProvider();

            await withSettings(code, { [selectedSubscriptionsKey]: [`${tenantA.tenantId}/${subA.subscriptionId}`] }, async () => {
                const tenants = await tenantIdsOf(provider);
                for (const tenant of [tenantA, tenantB]) {
                    if (tenants.includes(tenant.tenantId)) {
                        await collectPages(await provider.getChildren(tenant));
                    }
                }
            });

            expect(fetcher.fetchSubscriptions.mock.calls.map(call => call.arguments[0].tenantId)).to.deep.equal([tenantA.tenantId]);
        });

        it('should not hand out an excluded tenant, so nothing beneath it can be drilled', async () => {
            const { provider, code } = createProvider();

            const tenants = await withSettings(code, { [selectedSubscriptionsKey]: [`${tenantB.tenantId}/${subB.subscriptionId}`] }, () => tenantIdsOf(provider));

            expect(tenants).to.deep.equal([tenantB.tenantId]);
        });

        it('should not hand out an excluded subscription', async () => {
            const { provider, code } = createProvider();

            const pages = await withSettings(code, { [selectedSubscriptionsKey]: [`${tenantA.tenantId}/other-sub`] }, async () => {
                return collectPages(await provider.getChildren(tenantA));
            });

            expect(pages.flatMap(page => page.items)).to.deep.equal([]);
        });

        it('should match the tenant/subscription pair, not the subscription id alone', async () => {
            const shared = 'shared-sub';
            const { provider, code, fetcher } = createProvider();
            fetcher.fetchSubscriptions.mock.mockImplementation((tenant: AzureTenant) => (async function* () {
                yield await Promise.resolve({
                    items: [makeSubscription({ accountId: tenant.accountId, tenantId: tenant.tenantId, subscriptionId: shared })],
                    hasMore: false,
                });
            })());

            const admitted = await withSettings(code, { [selectedSubscriptionsKey]: [`${tenantB.tenantId}/${shared}`] }, async () => {
                const viaA = await collectPages(await provider.getChildren(tenantA));
                const viaB = await collectPages(await provider.getChildren(tenantB));
                return { viaA: viaA.flatMap(page => page.items), viaB: viaB.flatMap(page => page.items) };
            });

            // The same subscription is reachable through both tenants, but the
            // user selected only the copy under tenant B.
            expect(admitted.viaA).to.deep.equal([]);
            expect((admitted.viaB as AzureSubscription[]).map(sub => sub.tenantId)).to.deep.equal([tenantB.tenantId]);
        });

        it('should treat an empty filter as "show everything"', async () => {
            const { provider, code } = createProvider();

            const tenants = await withSettings(code, { [selectedSubscriptionsKey]: [] }, () => tenantIdsOf(provider));

            expect(tenants).to.deep.equal([tenantA.tenantId, tenantB.tenantId]);
        });
    });

    describe('onDidChange', () => {
        it('should emit a reconciling root re-list (debounced) on a session change for the Microsoft provider', async () => {
            const { provider, code, scheduler } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            // Debounced: nothing fires while the scheduled reconcile is pending.
            expect(onChange.mock.callCount()).to.equal(0);

            await scheduler.flush();

            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0].target).to.equal(Roots);
        });

        it('should not fire on authentication session changes for unrelated providers', () => {
            const { provider, code, scheduler } = createProvider();
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            code.sessionsChangeEmitter.fire({ provider: { id: 'github', label: 'GitHub' } });

            expect(fired).to.equal(0);
            expect(scheduler.hasPending).to.be.false;
        });

        it('should coalesce a burst of session changes into a single re-list', async () => {
            const { provider, code, scheduler, fetcher } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            for (let i = 0; i < 5; i++) {
                code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            }
            await scheduler.flush();

            expect(scheduler.debounce.mock.callCount()).to.equal(5);
            expect(fetcher.fetchAccounts.mock.callCount()).to.equal(1);
            expect(onChange.mock.callCount()).to.equal(1);
        });

        it('should detect a sign-in even though the accounts listing is memoized', async () => {
            const { provider, code, scheduler, fetcher } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            // Prime the known account set (and the memo behind it).
            await provider.getChildren();

            const added = makeAccount({ id: 'acct-2', label: 'Beta' });
            fetcher.fetchAccounts.mock.mockImplementation(() => Promise.resolve([account, added]));
            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            await scheduler.flush();

            expect(onChange.mock.callCount()).to.equal(1);
            expect(onChange.mock.calls[0].arguments[0].target).to.equal(Roots);
            expect(await provider.getChildren()).to.deep.equal([account, added]);
        });

        it('should evict only the signed-out account from the listing cache', async () => {
            const other = makeAccount({ id: 'acct-2', label: 'Beta' });
            const otherTenant = makeTenant({ accountId: other.id, tenantId: 'cccccccc-1111-2222-3333-444455556666' });
            const { provider, code, scheduler, fetcher } = createProvider();
            fetcher.fetchAccounts.mock.mockImplementation(() => Promise.resolve([account, other]));
            fetcher.fetchTenants.mock.mockImplementation((forAccount: typeof account) => (async function* () {
                yield await Promise.resolve({ items: forAccount.id === other.id ? [otherTenant] : [tenantA, tenantB], hasMore: false });
            })());
            const onDidRemoveAccounts = mock.fn();
            provider.onDidRemoveAccounts(onDidRemoveAccounts);

            await provider.getChildren();
            await collectPages(await provider.getChildren(account));
            await collectPages(await provider.getChildren(other));
            fetcher.fetchTenants.mock.resetCalls();

            fetcher.fetchAccounts.mock.mockImplementation(() => Promise.resolve([account]));
            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            await scheduler.flush();

            expect(onDidRemoveAccounts.mock.calls[0].arguments[0]).to.deep.equal([other.id]);
            // The surviving account's tenants are still cached, so re-listing
            // them costs nothing.
            await collectPages(await provider.getChildren(account));
            expect(fetcher.fetchTenants.mock.callCount()).to.equal(0);
        });

        it('should NOT fire when the signed-in account set is unchanged', async () => {
            const { provider, code, scheduler } = createProvider();
            const onChange = mock.fn();
            const onDidRemoveAccounts = mock.fn();
            provider.onDidChange(onChange);
            provider.onDidRemoveAccounts(onDidRemoveAccounts);

            await provider.getChildren();

            // The vast majority of onDidChangeSessions events (token refreshes,
            // re-auth, other extensions' activity) look like this.
            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            await scheduler.flush();

            expect(onChange.mock.callCount()).to.equal(0);
            expect(onDidRemoveAccounts.mock.callCount()).to.equal(0);
        });

        it('should ignore the session change its own reconcile provokes', async () => {
            const { provider, code, scheduler, fetcher } = createProvider();
            await provider.getChildren();
            fetcher.fetchAccounts.mock.resetCalls();

            // Reconciling calls getAccounts(), which itself raises a session
            // change; acting on that echo would reconcile forever.
            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            await scheduler.flush();
            expect(fetcher.fetchAccounts.mock.callCount()).to.equal(1);

            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });

            expect(scheduler.hasPending).to.be.false;
            expect(fetcher.fetchAccounts.mock.callCount()).to.equal(1);
        });

        it('should swallow a listing failure during reconcile instead of rejecting', async () => {
            const { provider, code, scheduler, fetcher } = createProvider();
            fetcher.fetchAccounts.mock.mockImplementation(() => Promise.reject(new Error('transient auth failure')));
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            code.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            await scheduler.flush();

            // The reconcile runs fire-and-forget, so the rejection must be
            // caught: the test completing without an unhandled rejection is
            // half the assertion.
            expect(fired).to.equal(0);
        });
    });

    describe('configuration changes', () => {
        it('should re-enumerate accounts when the sovereign cloud changes', async () => {
            const { provider, code, fetcher } = createProvider();
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });
            await provider.getChildren();

            code.configChangeEmitter.fire({ affectsConfiguration: section => section === 'microsoft-sovereign-cloud' });

            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Everything);
            // The accounts listing is the one taken against the ambient cloud.
            // Everything below it is keyed by environment, so the two clouds'
            // listings coexist instead of colliding.
            await provider.getChildren();
            expect(fetcher.fetchAccounts.mock.callCount()).to.equal(2);
        });

        it('should re-merge without re-listing anything when the signed-in tenants change', async () => {
            const { provider, code, fetcher } = createProvider();
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });
            await collectPages(await provider.getChildren(account));

            code.configChangeEmitter.fire({ affectsConfiguration: section => section === `${ConfigurationSection}.${SignedInTenantsConfigurationKey}` });

            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Everything);
            // Manually-named tenants are merged over the cached listing on every
            // read, so naming or un-naming one falsifies nothing.
            await collectPages(await provider.getChildren(account));
            expect(fetcher.fetchTenants.mock.callCount()).to.equal(1);
        });

        it('should re-apply the filter without re-listing anything when it changes', async () => {
            const { provider, code, fetcher } = createProvider();
            let event: DataProviderChangeEvent<ConcreteAzureNode> | undefined;
            let fired = 0;
            provider.onDidChange(e => { event = e; fired++; });
            await provider.getChildren();
            await collectPages(await provider.getChildren(account));
            await collectPages(await provider.getChildren(tenantA));
            const before = fetcher.fetchAccounts.mock.callCount() + fetcher.fetchTenants.mock.callCount() + fetcher.fetchSubscriptions.mock.callCount();

            code.configChangeEmitter.fire({ affectsConfiguration: section => section === selectedSubscriptionsKey });
            await provider.getChildren();
            await collectPages(await provider.getChildren(account));
            await collectPages(await provider.getChildren(tenantA));

            // The tree re-walks, but a filter change makes no cached listing
            // untrue, so not one request is issued.
            expect(fired).to.equal(1);
            expect(event?.target).to.equal(Everything);
            const after = fetcher.fetchAccounts.mock.callCount() + fetcher.fetchTenants.mock.callCount() + fetcher.fetchSubscriptions.mock.callCount();
            expect(after).to.equal(before);
        });

        it('should fire for every filter change, even in rapid succession', async () => {
            // Unselecting and immediately re-selecting is an ordinary user
            // gesture. If the second change were folded into the debounce or
            // silence window that the first one opened, the tree would be left
            // showing the first selection.
            const { provider, code, scheduler } = createProvider();
            let fired = 0;
            provider.onDidChange(() => { fired++; });
            await provider.getChildren();

            const filterChange = { affectsConfiguration: (section: string) => section === selectedSubscriptionsKey };
            code.configChangeEmitter.fire(filterChange);
            code.configChangeEmitter.fire(filterChange);

            expect(fired).to.equal(2, 'an explicit user action must never be suppressed');
            expect(scheduler.hasPending, 'routing a filter change through the debouncer would collapse the second change into the first').to.be.false;
        });

        it('should ignore unrelated configuration changes', () => {
            const { provider, code } = createProvider();
            let fired = 0;
            provider.onDidChange(() => { fired++; });

            code.configChangeEmitter.fire({ affectsConfiguration: () => false });

            expect(fired).to.equal(0);
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
                tenantPages: [{ items: [{ tenantId: otherTenantId, displayName: 'Fabrikam' }], hasMore: false }],
            });

            const includeChildren = await provider.enrich(tenant);

            expect(tenant.displayName).to.equal(manualTenantId);
            expect(includeChildren).to.be.false;
        });

        it('should skip a tenant that was listed normally without any network call', async () => {
            const { provider } = createProvider();
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
            const fetcher = createMockAzureListingFetcher();
            const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory, new AzureListingCache(fetcher, executor));
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
