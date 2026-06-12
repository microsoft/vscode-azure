/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzurePublicCloud, PublicAuthProviderId, type AzureAccount } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AzureAccountDataProvider } from '../../../tree/resources/AzureAccountDataProvider';

describe('AzureAccountDataProvider (unit)', () => {
    function createProvider() {
        const { ctx, mock } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const credentialFactory = () => makeCredential();
        const provider = new AzureAccountDataProvider(ctx, executor, credentialFactory);
        return { provider, mock };
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
});
