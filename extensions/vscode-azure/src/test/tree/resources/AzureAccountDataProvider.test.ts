/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzurePublicCloud, PublicAuthProviderId, SubscriptionClient, type AzureAccount, type AzureSubscription, type AzureTenant, type ConcreteAzureNode, type CredentialFactoryOptions, type ICredentialFactory } from '@microsoft/vscode-azure-azutils';
import { createMockSubscriptionClient, makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant, type MockSubscriptionClientOptions } from '@microsoft/vscode-azure-azutils/testing';
import { Everything, Roots, type ChildResult, type DataProviderChangeEvent, type Page } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AzureAccountDataProvider } from '../../../tree/resources/AzureAccountDataProvider';
import { runWithCredentialOptions } from '../../../tree/resources/credentialOptionsScope';

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

    async function collectPages<T>(result: ChildResult<T> | null | undefined): Promise<Array<Page<T>>> {
        const collected: Array<Page<T>> = [];
        for await (const page of result as AsyncIterable<Page<T>>) {
            collected.push(page);
        }
        return collected;
    }

    /**
     * Drain pending microtasks (e.g. the async session-change reconcile) while
     * fake timers are enabled. `setImmediate` is not faked, so awaiting it lets
     * queued promise continuations -- the `await listAccounts()` chain in the
     * debounced session handler -- run to completion.
     */
    async function flushMicrotasks(): Promise<void> {
        await new Promise(resolve => setImmediate(resolve));
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
            provider.onDidChange(() => { fired++; });

            await provider.getChildren();

            // Advance past the suppression window. An account then signs in, so
            // the resumed event represents a real change.
            mock.timers.tick(1001);
            vscodeMock.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([{ id: 'a-id', label: 'Alpha' }]));
            vscodeMock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });
            mock.timers.tick(500);
            await flushMicrotasks();

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

        it('should apply ambient credential options when inside a runWithCredentialOptions scope', async () => {
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

            await runWithCredentialOptions({ sessionOptions: { silent: true } }, async () => {
                await collectPages(await provider.getChildren(tenant));
            });

            // Ambient sessionOptions are merged beneath the call's account scoping.
            expect(inputs[0]?.sessionOptions?.silent).to.equal(true);
            expect(inputs[0]?.sessionOptions?.account?.id).to.equal(tenant.accountId);
            expect(inputs[0]?.tenantId).to.equal(tenant.tenantId);
        });

        it('should acquire the token interactively by default (no silent flag)', async () => {
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

            expect(inputs[0]?.sessionOptions?.silent).to.be.undefined;
        });
    });
});
