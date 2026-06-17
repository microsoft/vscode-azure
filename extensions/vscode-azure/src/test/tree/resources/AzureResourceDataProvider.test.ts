/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { ConfigurationSection } from '../../../constants';
import { AzureResourceDataProvider } from '../../../tree/resources/AzureResourceDataProvider';

describe('AzureResourceDataProvider (unit)', () => {
    const code = createMockVsCode();

    function createProvider(clientFactory?: unknown) {
        const { executor } = createTestActionExecutor();
        const createClient = clientFactory ?? mock.fn(() => ({}));
        return new AzureResourceDataProvider(code.vscode, executor, createClient as never);
    }

    describe('canHandle', () => {
        it('should return false for account nodes', () => {
            expect(createProvider().canHandle(makeAccount())).to.be.false;
        });

        it('should return false for tenant nodes', () => {
            expect(createProvider().canHandle(makeTenant())).to.be.false;
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
        it('should throw when called as a root provider', async () => {
            const provider = createProvider();
            let error: unknown;
            try {
                await provider.getChildren();
            } catch (e) {
                error = e;
            }
            expect((error as Error).message).to.include('not a root provider');
        });

        it('should return resource groups for a subscription', async () => {
            const sub = makeSubscription();
            const rgs = [{ id: 'rg1', name: 'rg1' }];
            const mockClient = { resourceGroups: { list: () => rgs } };
            const provider = createProvider(() => mockClient);

            const children = await provider.getChildren(sub);
            expect(children).to.deep.equal(rgs);
        });

        it('should return resources for a resource group', async () => {
            const rg = makeResourceGroup();
            const resources = [{ id: 'res1', name: 'res1' }];
            const mockClient = { resources: { listByResourceGroup: () => resources } };
            const provider = createProvider(() => mockClient);

            const children = await provider.getChildren(rg);
            expect(children).to.deep.equal(resources);
        });

        it('should reuse a cached client across calls for the same subscription', async () => {
            const sub = makeSubscription();
            const createClient = mock.fn(() => ({ resourceGroups: { list: () => [] } }));
            const provider = createProvider(createClient);

            await provider.getChildren(sub);
            await provider.getChildren(sub);

            expect(createClient.mock.callCount()).to.equal(1);
        });

        it('should pass configured page size to resource list calls', async () => {
            const sub = makeSubscription();
            let capturedOptions: Record<string, unknown> | undefined;
            const mockClient = {
                resourceGroups: {
                    list: (options?: Record<string, unknown>) => { capturedOptions = options; return []; },
                },
            };
            const provider = createProvider(() => mockClient);

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
});
