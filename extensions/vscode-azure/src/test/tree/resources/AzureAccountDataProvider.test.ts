/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzurePublicCloud, PublicAuthProviderId, SubscriptionClient, type AzureAccount, type AzureSubscription, type AzureTenant } from '@microsoft/vscode-azure-azutils';
import { createMockSubscriptionClient, makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant, type MockSubscriptionClientOptions } from '@microsoft/vscode-azure-azutils/testing';
import type { ChildResult, Page } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AzureAccountDataProvider } from '../../../tree/resources/AzureAccountDataProvider';

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
        it('should fire on authentication session changes for the Microsoft provider', () => {
            const { provider, mock } = createProvider();
            let fired = false;
            provider.onDidChange(() => { fired = true; });

            mock.sessionsChangeEmitter.fire({ provider: { id: PublicAuthProviderId, label: 'Microsoft' } });

            expect(fired).to.be.true;
        });

        it('should not fire on authentication session changes for unrelated providers', () => {
            const { provider, mock } = createProvider();
            let fired = false;
            provider.onDidChange(() => { fired = true; });

            mock.sessionsChangeEmitter.fire({ provider: { id: 'github', label: 'GitHub' } });

            expect(fired).to.be.false;
        });

        it('should fire when the sovereign cloud configuration changes', () => {
            const { provider, mock } = createProvider();
            let fired = false;
            provider.onDidChange(() => { fired = true; });

            mock.configChangeEmitter.fire({ affectsConfiguration: section => section === 'microsoft-sovereign-cloud' });

            expect(fired).to.be.true;
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

        it('should attach the account and environment to each tenant', async () => {
            const { provider } = createProvider();
            const account = makeAccount();
            mockSubscriptionClient({
                tenantPages: [{ items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: false }],
            });

            const pages = await collectPages(await provider.getChildren(account));

            const tenant = (pages[0].items as AzureTenant[])[0];
            expect(tenant.account).to.equal(account);
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

        it('should attach the tenant, account, and environment to each subscription', async () => {
            const { provider } = createProvider();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [{ items: [{ subscriptionId: 's1', tenantId: tenant.tenantId, displayName: 'Sub One' }], hasMore: false }],
            });

            const pages = await collectPages(await provider.getChildren(tenant));

            const sub = (pages[0].items as AzureSubscription[])[0];
            expect(sub.tenant).to.equal(tenant);
            expect(sub.account).to.equal(tenant.account);
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
    });
});
