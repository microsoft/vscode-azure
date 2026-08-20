/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectAsync, type Page } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as assert from 'node:assert';
import { mock } from 'node:test';
import type { AzureSubscription, AzureTenant } from '../../../src/auth/AzureSubscription';
import type { CredentialFactoryOptions, ICredentialFactory } from '../../../src/auth/CredentialFactory';
import { AzurePublicCloud } from '../../../src/auth/Environment';
import { AzureListingFetcher } from '../../../src/auth/listing/AzureListingFetcher';
import { PublicAuthProviderId } from '../../../src/auth/Environment';
import { SubscriptionClient } from '../../../src/rest/clients/SubscriptionClient';
import { createMockSubscriptionClient, makeAccount, makeCredential, makeTenant, type MockSubscriptionClientOptions } from '../../mockAzure';

describe('AzureListingFetcher (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    function createFetcher(credentialFactory?: ICredentialFactory) {
        const { ctx, mock: code } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const fetcher = new AzureListingFetcher(ctx, executor, credentialFactory ?? (() => makeCredential()));
        return { fetcher, code };
    }

    /** Serve `tenants.list` / `subscriptions.list` from canned pages. */
    function mockSubscriptionClient(options: MockSubscriptionClientOptions) {
        return mock.method(SubscriptionClient, 'create', () => createMockSubscriptionClient(options) as never);
    }

    /** Serve a client whose `tenants.list` rejects, as conditional access does. */
    function mockFailingTenantList(error: Error) {
        const throwing: AsyncIterable<never> = {
            [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
        };
        return mock.method(SubscriptionClient, 'create', () => ({
            tenants: { list: () => throwing },
            subscriptions: { list: () => createMockSubscriptionClient().subscriptions.list(), listLocations: () => Promise.resolve([]) },
        }) as never);
    }

    function tenantIds(pages: Page<AzureTenant>[]): string[] {
        return pages.flatMap(page => page.items.map(tenant => tenant.tenantId));
    }

    describe('fetchAccounts', () => {
        it('lists signed-in accounts sorted by label with the environment attached', async () => {
            const { fetcher, code } = createFetcher();
            code.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([
                { id: 'b-id', label: 'Beta' },
                { id: 'a-id', label: 'Alpha' },
            ]));

            const accounts = await fetcher.fetchAccounts();

            assert.deepStrictEqual(accounts.map(account => account.label), ['Alpha', 'Beta']);
            assert.ok(accounts.every(account => account.environment === AzurePublicCloud));
        });

        it('queries the auth provider for the configured environment', async () => {
            const { fetcher, code } = createFetcher();
            code.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));

            await fetcher.fetchAccounts();

            assert.strictEqual(code.authentication.getAccounts.mock.calls[0].arguments[0], PublicAuthProviderId);
        });

        it('acquires no credential, so listing accounts cannot prompt', async () => {
            const credentialFactory = mock.fn<ICredentialFactory>(() => makeCredential());
            const { fetcher, code } = createFetcher(credentialFactory);
            code.authentication.getAccounts.mock.mockImplementation(() => Promise.resolve([]));

            await fetcher.fetchAccounts();

            assert.strictEqual(credentialFactory.mock.callCount(), 0);
        });
    });

    describe('fetchTenants', () => {
        it('streams pages, preserving hasMore', async () => {
            const { fetcher } = createFetcher();
            mockSubscriptionClient({
                tenantPages: [
                    { items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: true },
                    { items: [{ tenantId: 't2', displayName: 'Tenant Two' }], hasMore: false },
                ],
            });

            const pages = await collectAsync(fetcher.fetchTenants(makeAccount()));

            assert.deepStrictEqual(pages.map(page => page.hasMore), [true, false]);
            assert.deepStrictEqual(tenantIds(pages), ['t1', 't2']);
        });

        it('attaches the account id and environment to each tenant', async () => {
            const { fetcher } = createFetcher();
            const account = makeAccount();
            mockSubscriptionClient({ tenantPages: [{ items: [{ tenantId: 't1', displayName: 'Tenant One' }], hasMore: false }] });

            const pages = await collectAsync(fetcher.fetchTenants(account));

            assert.strictEqual(pages[0].items[0].accountId, account.id);
            assert.strictEqual(pages[0].items[0].environment, AzurePublicCloud);
        });

        it('drops tenants missing an id or display name', async () => {
            const { fetcher } = createFetcher();
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

            const pages = await collectAsync(fetcher.fetchTenants(makeAccount()));

            assert.deepStrictEqual(tenantIds(pages), ['t3']);
        });

        it('yields an empty terminal page when listing is blocked outright', async () => {
            const { fetcher } = createFetcher();
            mockFailingTenantList(new Error('conditional access'));

            const pages = await collectAsync(fetcher.fetchTenants(makeAccount()));

            assert.deepStrictEqual(tenantIds(pages), []);
            assert.strictEqual(pages[pages.length - 1].hasMore, false);
        });
    });

    describe('fetchSubscriptions', () => {
        it('streams pages, preserving hasMore', async () => {
            const { fetcher } = createFetcher();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [
                    { items: [{ subscriptionId: 's1', tenantId: tenant.tenantId, displayName: 'Sub One' }], hasMore: true },
                    { items: [{ subscriptionId: 's2', tenantId: tenant.tenantId, displayName: 'Sub Two' }], hasMore: false },
                ],
            });

            const pages = await collectAsync(fetcher.fetchSubscriptions(tenant));

            assert.deepStrictEqual(pages.map(page => page.hasMore), [true, false]);
            assert.deepStrictEqual(pages.flatMap(page => page.items.map(sub => sub.subscriptionId)), ['s1', 's2']);
        });

        it('records the tenant it listed through, not the one ARM reports', async () => {
            const { fetcher } = createFetcher();
            const guestTenant = makeTenant({ tenantId: 'guest-tenant', accountId: 'acct' });
            mockSubscriptionClient({
                subscriptionPages: [{ items: [{ subscriptionId: 's1', tenantId: 'home-tenant', displayName: 'Sub One' }], hasMore: false }],
            });

            const pages = await collectAsync(fetcher.fetchSubscriptions(guestTenant));

            const subscription: AzureSubscription = pages[0].items[0];
            // The tenant a credential must target is the one it was reached
            // through; recording ARM's owner here would collapse a subscription
            // reachable through two tenants into one node.
            assert.strictEqual(subscription.tenantId, 'guest-tenant');
            assert.strictEqual(subscription.accountId, guestTenant.accountId);
            assert.strictEqual(subscription.environment, guestTenant.environment);
        });

        it('drops subscriptions missing an id or display name', async () => {
            const { fetcher } = createFetcher();
            const tenant = makeTenant();
            mockSubscriptionClient({
                subscriptionPages: [{
                    items: [
                        { subscriptionId: undefined, tenantId: tenant.tenantId, displayName: 'No Id' },
                        { subscriptionId: 's3', tenantId: tenant.tenantId, displayName: undefined },
                        { subscriptionId: 's4', tenantId: tenant.tenantId, displayName: 'Valid' },
                    ],
                    hasMore: false,
                }],
            });

            const pages = await collectAsync(fetcher.fetchSubscriptions(tenant));

            assert.deepStrictEqual(pages[0].items.map(sub => sub.subscriptionId), ['s4']);
        });

        it('scopes the credential to the tenant and account, leaving interactivity to the caller', async () => {
            const inputs: CredentialFactoryOptions[] = [];
            const { fetcher } = createFetcher(input => {
                inputs.push(input as CredentialFactoryOptions);
                return makeCredential();
            });
            const tenant = makeTenant();
            mockSubscriptionClient({ subscriptionPages: [{ items: [], hasMore: false }] });

            await collectAsync(fetcher.fetchSubscriptions(tenant));

            assert.strictEqual(inputs[0]?.tenantId, tenant.tenantId);
            assert.strictEqual(inputs[0]?.sessionOptions?.account?.id, tenant.accountId);
            assert.strictEqual(inputs[0]?.sessionOptions?.silent, undefined, 'ambient options belong to the credential factory');
        });
    });
});
