/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeCredential, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { PublicAuthProviderId } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
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
});
