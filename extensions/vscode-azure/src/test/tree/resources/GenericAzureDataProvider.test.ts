/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { Disposable, EventEmitter } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { ConfigurationSection } from '../../../constants';
import { GenericAzureDataProvider } from '../../../tree/resources/GenericAzureDataProvider';

describe('GenericAzureDataProvider (unit)', () => {
    const code = createMockVsCode();

    function createProvider(subscriptionProvider?: Record<string, unknown>, clientFactory?: unknown) {
        const { executor } = createTestActionExecutor();
        const subProvider = {
            signIn: mock.fn(() => Promise.resolve(true)),
            getAccounts: mock.fn(() => Promise.resolve([])),
            getTenantsForAccount: mock.fn(() => Promise.resolve([])),
            getSubscriptionsForTenant: mock.fn(() => Promise.resolve([])),
            onRefreshSuggested: () => Disposable.None,
            ...subscriptionProvider,
        };
        const createClient = clientFactory ?? mock.fn(() => ({}));
        return new GenericAzureDataProvider(code.vscode, executor, createClient as never, subProvider as never);
    }

    describe('canHandle', () => {
        it('should return true for account nodes', () => {
            expect(createProvider().canHandle(makeAccount())).to.be.true;
        });

        it('should return true for tenant nodes', () => {
            expect(createProvider().canHandle(makeTenant())).to.be.true;
        });

        it('should return true for subscription nodes', () => {
            expect(createProvider().canHandle(makeSubscription())).to.be.true;
        });

        it('should return true for resource group nodes', () => {
            expect(createProvider().canHandle(makeResourceGroup())).to.be.true;
        });

        it('should return false for generic resources', () => {
            expect(createProvider().canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for null/undefined', () => {
            const provider = createProvider();
            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle(undefined)).to.be.false;
        });

        it('should return false for non-objects', () => {
            expect(createProvider().canHandle('string')).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('should sign in and return accounts at root', async () => {
            const accounts = [makeAccount()];
            const provider = createProvider({ getAccounts: () => Promise.resolve(accounts) });

            const children = await provider.getChildren();
            expect(children).to.deep.equal(accounts);
        });

        it('should return tenants for an account', async () => {
            const account = makeAccount();
            const tenants = [makeTenant()];
            const provider = createProvider({ getTenantsForAccount: () => Promise.resolve(tenants) });

            const children = await provider.getChildren(account);
            expect(children).to.deep.equal(tenants);
        });

        it('should return subscriptions for a tenant', async () => {
            const tenant = makeTenant();
            const subs = [makeSubscription()];
            const provider = createProvider({ getSubscriptionsForTenant: () => Promise.resolve(subs) });

            const children = await provider.getChildren(tenant);
            expect(children).to.deep.equal(subs);
        });

        it('should return resource groups for a subscription', async () => {
            const sub = makeSubscription();
            const rgs = [{ id: 'rg1', name: 'rg1' }];
            const mockClient = { resourceGroups: { list: () => rgs } };
            const provider = createProvider({}, () => mockClient);

            const children = await provider.getChildren(sub);
            expect(children).to.deep.equal(rgs);
        });

        it('should return resources for a resource group', async () => {
            const rg = makeResourceGroup();
            const resources = [{ id: 'res1', name: 'res1' }];
            const mockClient = { resources: { listByResourceGroup: () => resources } };
            const provider = createProvider({}, () => mockClient);

            const children = await provider.getChildren(rg);
            expect(children).to.deep.equal(resources);
        });

        it('should only sign in once across multiple calls', async () => {
            const signIn = mock.fn(() => Promise.resolve(true));
            const provider = createProvider({ signIn, getAccounts: () => Promise.resolve([]) });

            await provider.getChildren();
            await provider.getChildren();

            expect(signIn.mock.callCount()).to.equal(1);
        });

        it('should pass configured page size to resource list calls', async () => {
            const sub = makeSubscription();
            let capturedOptions: Record<string, unknown> | undefined;
            const mockClient = {
                resourceGroups: {
                    list: (options?: Record<string, unknown>) => { capturedOptions = options; return []; },
                },
            };
            const provider = createProvider({}, () => mockClient);

            await withSettings(code, { [`${ConfigurationSection}.pageSize`]: 25 }, () => provider.getChildren(sub));
            expect(capturedOptions?.top).to.equal(25);
        });
    });

    describe('dispose', () => {
        it('should not throw when disposed', () => {
            const provider = createProvider();
            expect(() => { provider.dispose(); }).to.not.throw;
        });
    });

    describe('configuration change listener', () => {
        it('should fire onDidChange when pageSize setting changes', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            code.configChangeEmitter.fire({
                affectsConfiguration: (s: string) => s === `${ConfigurationSection}.pageSize`,
            });

            expect(listener.mock.callCount()).to.equal(1);
        });

        it('should not fire onDidChange for unrelated settings', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            code.configChangeEmitter.fire({
                affectsConfiguration: () => false,
            });

            expect(listener.mock.callCount()).to.equal(0);
        });
    });

    describe('subscription provider refresh', () => {
        it('should fire onDidChange and clear signInPromise when refresh is suggested', async () => {
            const refreshEmitter = new EventEmitter<void>();
            const signIn = mock.fn(() => Promise.resolve(true));
            const provider = createProvider({
                signIn,
                getAccounts: () => Promise.resolve([]),
                onRefreshSuggested: refreshEmitter.event,
            });

            // First call triggers sign-in
            await provider.getChildren();
            expect(signIn.mock.callCount()).to.equal(1);

            const listener = mock.fn();
            provider.onDidChange(listener);

            // Fire refresh suggested
            refreshEmitter.fire();

            expect(listener.mock.callCount()).to.equal(1);

            // Next getChildren should trigger sign-in again
            await provider.getChildren();
            expect(signIn.mock.callCount()).to.equal(2);
        });
    });
});
