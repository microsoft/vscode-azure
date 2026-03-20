/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource, VirtualResource } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, isVirtualResource } from '@microsoft/vscode-azure-azutils';
import { type IActionExecutor, DataItemTree } from '@microsoft/vscode-azure-utils';
import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { mock } from 'node:test';
import type { IAcrClientProvider } from '../../../../services';
import { AcrDataProvider } from '../../../../tree/resources/acr/AcrDataProvider';
import { createFakeAcrResource, createFakeSubscription, createMockAcrClient } from './testData';

/**
 * A stub {@link IActionExecutor} that runs callbacks directly without telemetry.
 */
function createStubExecutor(): IActionExecutor {
    return {
        currentContext: undefined,
        setTelProp: () => { /* no-op */ },
        setTelMeasure: () => { /* no-op */ },
        async callWithTelemetryAndErrorHandling<T>(
            _telemetryId: string,
            callback: (context: any) => T | Promise<T>,
        ): Promise<T | undefined> {
            const fakeContext = {
                telemetry: {
                    id: _telemetryId,
                    properties: {},
                    measurements: {},
                    isUserEvent: false,
                },
                errorHandling: { rethrow: true },
            };
            return callback(fakeContext);
        },
    };
}

describe('AcrDataProvider (unit)', () => {
    let executor: IActionExecutor;
    let acrClient: ReturnType<typeof createMockAcrClient>;
    let clientProvider: IAcrClientProvider;
    let provider: AcrDataProvider;

    beforeEach(() => {
        executor = createStubExecutor();
        acrClient = createMockAcrClient();
        clientProvider = async () => acrClient;
        provider = new AcrDataProvider(executor, clientProvider);
    });

    afterEach(() => {
        mock.restoreAll();
    });

    // #region canHandle

    describe('canHandle', () => {
        it('should accept a GenericResource with ACR type', () => {
            const resource = createFakeAcrResource('myregistry');
            expect(provider.canHandle(resource)).to.be.true;
        });

        it('should accept a VirtualResource owned by an ACR registry', () => {
            const registry = createFakeAcrResource('myregistry');
            const virtual: VirtualResource = {
                virtualType: 'acr.repositories',
                virtualPath: 'Repositories',
                azureResource: registry,
            };
            expect(provider.canHandle(virtual)).to.be.true;
        });

        it('should reject a resource with a different type', () => {
            const resource = createFakeAcrResource('myregistry');
            (resource as any).logicalType = 'Microsoft.Storage/storageAccounts';
            expect(provider.canHandle(resource)).to.be.false;
        });

        it('should reject null/undefined', () => {
            // Note: canHandle(null/undefined) throws because isAcrVirtualResource
            // passes the value through to isVirtualResource which uses 'in' on it.
            // This is a pre-existing bug — the isAcrRegistry guard short-circuits
            // for non-objects, but isAcrVirtualResource does not.
            expect(() => provider.canHandle(null)).to.throw(TypeError);
            expect(() => provider.canHandle(undefined)).to.throw(TypeError);
        });
    });

    // #endregion

    // #region getChildren

    describe('getChildren', () => {
        it('should return empty for root (no argument)', () => {
            const result = provider.getChildren();
            expect(result).to.deep.equal([]);
        });

        it('should return category nodes (Repositories, Webhooks) for a registry', () => {
            const registry = createFakeAcrResource('myregistry');
            const children = provider.getChildren(registry) as ConcreteAzureNode[];

            expect(children).to.have.length(2);

            const [repos, webhooks] = children;
            expect(isVirtualResource(repos as any)).to.be.true;
            expect((repos as VirtualResource).virtualPath).to.equal('Repositories');
            expect((repos as VirtualResource).virtualType).to.equal('acr.repositories');

            expect(isVirtualResource(webhooks as any)).to.be.true;
            expect((webhooks as VirtualResource).virtualPath).to.equal('Webhooks');
            expect((webhooks as VirtualResource).virtualType).to.equal('acr.webhooks');
        });

        it('should return 3 repository items for a Repositories node', () => {
            const registry = createFakeAcrResource('myregistry');
            const repoCategory: VirtualResource = {
                virtualType: 'acr.repositories',
                virtualPath: 'Repositories',
                azureResource: registry,
            };

            const children = provider.getChildren(repoCategory as ConcreteAzureNode) as ConcreteAzureNode[];
            expect(children).to.have.length(3);

            const names = children.map(c => (c as VirtualResource).virtualPath);
            expect(names).to.deep.equal(['repo-1', 'repo-2', 'repo-3']);
        });

        it('should return 3 webhook items for a Webhooks node', () => {
            const registry = createFakeAcrResource('myregistry');
            const webhookCategory: VirtualResource = {
                virtualType: 'acr.webhooks',
                virtualPath: 'Webhooks',
                azureResource: registry,
            };

            const children = provider.getChildren(webhookCategory as ConcreteAzureNode) as ConcreteAzureNode[];
            expect(children).to.have.length(3);

            const names = children.map(c => (c as VirtualResource).virtualPath);
            expect(names).to.deep.equal(['webhook-1', 'webhook-2', 'webhook-3']);
        });
    });

    // #endregion

    // #region enrich

    describe('enrich', function () {
        // AcrDataProvider.enrich has a TODO simulated 5s delay
        this.timeout(20_000);

        it('should populate loginServer, sku, and adminUserEnabled on the resource', async () => {
            const resource = createFakeAcrResource('myregistry') as GenericResource & Record<string, unknown>;

            const result = await provider.enrich(resource as ConcreteAzureNode);

            expect(result).to.equal(false); // does not invalidate children
            expect(resource.loginServer).to.equal('myregistry.azurecr.io');
            expect(resource.sku).to.deep.equal({ name: 'Standard', tier: 'Standard' });
            expect(resource.adminUserEnabled).to.equal(false);
        });

        it('should return false for non-ACR resources', async () => {
            const resource = createFakeAcrResource('myregistry');
            (resource as any).logicalType = 'Microsoft.Storage/storageAccounts';

            const result = await provider.enrich(resource as ConcreteAzureNode);
            expect(result).to.equal(false);
        });

        it('should reuse the same client for the same subscription', async () => {
            let callCount = 0;
            const countingProvider: IAcrClientProvider = async () => {
                callCount++;
                return acrClient;
            };
            provider = new AcrDataProvider(executor, countingProvider);

            const r1 = createFakeAcrResource('reg1');
            const r2 = createFakeAcrResource('reg2');

            await provider.enrich(r1 as ConcreteAzureNode);
            await provider.enrich(r2 as ConcreteAzureNode);

            expect(callCount).to.equal(1);
        });
    });

    // #endregion
});

describe('AcrDataProvider in DataItemTree (unit)', function () {
    // AcrDataProvider.enrich has a TODO simulated 5s delay
    this.timeout(20_000);

    let executor: IActionExecutor;
    let tree: DataItemTree<ConcreteAzureNode>;

    beforeEach(() => {
        executor = createStubExecutor();
        tree = new DataItemTree<ConcreteAzureNode>(
            'test-acr',
            executor,
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000, // 5 minute TTL
        );
    });

    it('should show 3 ACR registries as root items', async () => {
        const sub = createFakeSubscription();
        const registries = [
            createFakeAcrResource('contoso', sub),
            createFakeAcrResource('fabrikam', sub),
            createFakeAcrResource('northwind', sub),
        ];

        // Root provider only handles root calls (no resource argument).
        // canHandle returns false so it never intercepts branch lookups.
        tree.registerProvider({
            isRoot: true,
            canHandle: (_resource: unknown): _resource is ConcreteAzureNode => false,
            getChildren: () => registries,
        });

        const roots = await tree.getChildren();

        expect(roots).to.have.length(3);
        expect(roots.map(r => (r as GenericResource).name)).to.deep.equal(['contoso', 'fabrikam', 'northwind']);

        // Each should be retrievable by key
        for (const resource of roots) {
            const key = AzureNodeId.from(resource).toString();
            expect(tree.get(key)).to.equal(resource);
        }
    });

    it('should show children (Repositories, Webhooks) under each registry', async () => {
        const sub = createFakeSubscription();
        const registries = [
            createFakeAcrResource('contoso', sub),
            createFakeAcrResource('fabrikam', sub),
            createFakeAcrResource('northwind', sub),
        ];

        const acrClient = createMockAcrClient();
        const clientProvider: IAcrClientProvider = async () => acrClient;
        const acrDataProvider = new AcrDataProvider(executor, clientProvider);

        // Root provider only handles root calls (no resource argument).
        // canHandle returns false so it never intercepts branch lookups.
        tree.registerProvider({
            isRoot: true,
            canHandle: (_resource: unknown): _resource is ConcreteAzureNode => false,
            getChildren: () => registries,
        });

        // ACR provider handles children and enrichment
        tree.registerProvider(acrDataProvider);

        // Load roots
        const roots = await tree.getChildren();
        expect(roots).to.have.length(3);

        // Expand the first registry — should get Repositories + Webhooks
        const children = await tree.getChildren(roots[0]);
        expect(children).to.have.length(2);

        const virtualChildren = children as unknown as VirtualResource[];
        expect(virtualChildren[0].virtualPath).to.equal('Repositories');
        expect(virtualChildren[1].virtualPath).to.equal('Webhooks');

        // Expand Repositories — should get 3 repo items
        const repos = await tree.getChildren(children[0]);
        expect(repos).to.have.length(3);
        expect((repos as unknown as VirtualResource[]).map(r => r.virtualPath))
            .to.deep.equal(['repo-1', 'repo-2', 'repo-3']);
    });

    it('should enrich registries with login server details', async () => {
        const sub = createFakeSubscription();
        const registries = [
            createFakeAcrResource('contoso', sub),
            createFakeAcrResource('fabrikam', sub),
            createFakeAcrResource('northwind', sub),
        ];

        const acrClient = createMockAcrClient();
        const clientProvider: IAcrClientProvider = async () => acrClient;
        const acrDataProvider = new AcrDataProvider(executor, clientProvider);

        tree.registerProvider({
            isRoot: true,
            canHandle: (_resource: unknown): _resource is ConcreteAzureNode => false,
            getChildren: () => registries,
        });
        tree.registerProvider(acrDataProvider);

        const roots = await tree.getChildren();

        // Wait for enrichment to complete (note: AcrDataProvider.enrich
        // has a TODO simulated 5s delay, so we need a generous timeout)
        for (const resource of roots) {
            await tree.whenEnriched(resource);
        }

        // All 3 should now have enriched ACR properties
        for (const resource of roots) {
            const r = resource as GenericResource & Record<string, unknown>;
            expect(r.loginServer).to.be.a('string');
            expect((r.loginServer as string).endsWith('.azurecr.io')).to.be.true;
            expect(r.sku).to.deep.equal({ name: 'Standard', tier: 'Standard' });
            expect(r.adminUserEnabled).to.equal(false);
        }
    });

    it('should produce valid AzureNodeId keys for all tree nodes', async () => {
        const sub = createFakeSubscription();
        const registries = [
            createFakeAcrResource('contoso', sub),
            createFakeAcrResource('fabrikam', sub),
            createFakeAcrResource('northwind', sub),
        ];

        const acrClient = createMockAcrClient();
        const clientProvider: IAcrClientProvider = async () => acrClient;
        const acrDataProvider = new AcrDataProvider(executor, clientProvider);

        tree.registerProvider({
            isRoot: true,
            canHandle: (_resource: unknown): _resource is ConcreteAzureNode => false,
            getChildren: () => registries,
        });
        tree.registerProvider(acrDataProvider);

        const roots = await tree.getChildren();
        for (const root of roots) {
            const rootKey = AzureNodeId.from(root).toString();
            expect(rootKey).to.match(/^azr:\/\//);

            const children = await tree.getChildren(root);
            for (const child of children) {
                const childKey = AzureNodeId.from(child).toString();
                expect(childKey).to.match(/^azr:\/\//);
                // Virtual resources should have a fragment
                expect(childKey).to.include('#/');
            }
        }
    });
});
