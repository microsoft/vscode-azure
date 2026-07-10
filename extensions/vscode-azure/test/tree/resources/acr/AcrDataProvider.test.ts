/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { AcrDataProvider } from '../../../../src/tree/resources/acr/AcrDataProvider';
import { makeAcrRegistry } from './mockAcr';

describe('AcrDataProvider (unit)', () => {
    function createProvider(clientOverrides?: Record<string, unknown>) {
        const { executor } = createTestActionExecutor();
        const mockClient = {
            registries: {
                get: mock.fn(() => Promise.resolve({
                    loginServer: 'myreg.azurecr.io',
                    sku: { name: 'Basic', tier: 'Basic' },
                    adminUserEnabled: false,
                })),
            },
            ...clientOverrides,
        };
        const createClient = mock.fn(() => mockClient);
        return new AcrDataProvider(executor, createClient as never);
    }

    describe('canHandle', () => {
        it('should return true for ACR registry resources', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeAcrRegistry())).to.be.true;
        });

        it('should return true for virtual resources owned by an ACR registry', () => {
            const provider = createProvider();
            const vr = makeVirtualResource({
                virtualType: 'acr.repositories',
                virtualPath: 'Repositories',
                azureResource: makeAcrRegistry(),
            });
            expect(provider.canHandle(vr)).to.be.true;
        });

        it('should return false for non-ACR generic resources', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeGenericResource())).to.be.false;
        });

        it('should return false for null', () => {
            const provider = createProvider();
            expect(provider.canHandle(null)).to.be.false;
        });

        it('should return false for undefined', () => {
            const provider = createProvider();
            expect(provider.canHandle(undefined)).to.be.false;
        });

        it('should return false for non-objects', () => {
            const provider = createProvider();
            expect(provider.canHandle('string')).to.be.false;
        });
    });

    describe('enrich', () => {
        it('should fetch registry details and assign them in-place', async () => {
            const provider = createProvider();
            const registry = makeAcrRegistry();

            await provider.enrich(registry);

            expect(registry.loginServer).to.equal('myreg.azurecr.io');
            expect(registry.sku).to.deep.equal({ name: 'Basic', tier: 'Basic' });
            expect(registry.adminUserEnabled).to.equal(false);
        });

        it('should return false for non-ACR resources', async () => {
            const provider = createProvider();
            const resource = makeGenericResource();

            const changed = await provider.enrich(resource);
            expect(changed).to.be.false;
        });

        it('should handle missing loginServer with empty string fallback', async () => {
            const provider = createProvider({
                registries: {
                    get: mock.fn(() => Promise.resolve({
                        sku: { name: 'Standard', tier: 'Standard' },
                        adminUserEnabled: true,
                    })),
                },
            });
            const registry = makeAcrRegistry();

            await provider.enrich(registry);

            expect(registry.loginServer).to.equal('');
            expect(registry.adminUserEnabled).to.equal(true);
        });
    });

    describe('getChildren', () => {
        it('should return empty array for no resource', () => {
            const provider = createProvider();
            const children = provider.getChildren();
            expect(children).to.deep.equal([]);
        });

        it('should return Repositories and Webhooks categories for a registry', () => {
            const provider = createProvider();
            const registry = makeAcrRegistry();

            const children = provider.getChildren(registry);

            expect(children).to.have.length(2);
            expect(children[0]).to.have.property('virtualPath', 'Repositories');
            expect(children[1]).to.have.property('virtualPath', 'Webhooks');
            expect(children[0]).to.have.property('virtualType', 'acr.repositories');
            expect(children[1]).to.have.property('virtualType', 'acr.webhooks');
        });

        it('should return repository items for a Repositories category', () => {
            const provider = createProvider();
            const registry = makeAcrRegistry();
            const category = makeVirtualResource({
                virtualType: 'acr.repositories',
                virtualPath: 'Repositories',
                azureResource: registry,
            });

            const children = provider.getChildren(category);

            expect(children).to.have.length(3);
            expect(children[0]).to.have.property('virtualPath', 'repo-1');
        });

        it('should return webhook items for a Webhooks category', () => {
            const provider = createProvider();
            const registry = makeAcrRegistry();
            const category = makeVirtualResource({
                virtualType: 'acr.webhooks',
                virtualPath: 'Webhooks',
                azureResource: registry,
            });

            const children = provider.getChildren(category);

            expect(children).to.have.length(3);
            expect(children[0]).to.have.property('virtualPath', 'webhook-1');
        });

        it('should return empty for an unknown virtual resource type', () => {
            const provider = createProvider();
            const vr = makeVirtualResource({
                virtualType: 'acr.unknown',
                virtualPath: 'Unknown',
                azureResource: makeAcrRegistry(),
            });

            const children = provider.getChildren(vr);
            expect(children).to.deep.equal([]);
        });

        it('should return empty for a non-ACR resource', () => {
            const provider = createProvider();
            const resource = makeGenericResource();

            const children = provider.getChildren(resource);
            expect(children).to.deep.equal([]);
        });
    });
});
