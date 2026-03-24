/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { GenericAzureDataProvider } from '../../../tree/resources/GenericAzureDataProvider';

describe('GenericAzureDataProvider (unit)', () => {
    function createProvider(subscriptionProvider?: Record<string, unknown>, clientFactory?: unknown) {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const subProvider = {
            signIn: mock.fn(() => Promise.resolve(true)),
            getAccounts: mock.fn(() => Promise.resolve([])),
            getTenantsForAccount: mock.fn(() => Promise.resolve([])),
            getSubscriptionsForTenant: mock.fn(() => Promise.resolve([])),
            ...subscriptionProvider,
        };
        const createClient = clientFactory ?? mock.fn(() => Promise.resolve({}));
        return new GenericAzureDataProvider(executor, createClient as never, subProvider as never);
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
            const provider = createProvider({}, () => Promise.resolve(mockClient));

            const children = await provider.getChildren(sub);
            expect(children).to.deep.equal(rgs);
        });

        it('should return resources for a resource group', async () => {
            const rg = makeResourceGroup();
            const resources = [{ id: 'res1', name: 'res1' }];
            const mockClient = { resources: { listByResourceGroup: () => resources } };
            const provider = createProvider({}, () => Promise.resolve(mockClient));

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
    });
});
