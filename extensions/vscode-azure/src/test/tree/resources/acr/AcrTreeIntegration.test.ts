/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type IAcrClientProvider, type IResourceClientProvider } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor, DataItemTree, type ITreeItem, ViewItemTree, type ViewItemTreeOptions } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, DebugOutputChannel, NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { createMockAcrClient, createMockResourceClient, createMockSubscriptionProvider } from '../../../../debug/mockData';
import { AcrDataProvider } from '../../../../tree/resources/acr/AcrDataProvider';
import { AcrResourceType } from '../../../../tree/resources/acr/AcrRegistry';
import { AcrViewProvider } from '../../../../tree/resources/acr/AcrViewProvider';
import { GenericAzureDataProvider } from '../../../../tree/resources/GenericAzureDataProvider';
import { GenericAzureViewProvider } from '../../../../tree/resources/GenericAzureViewProvider';

/**
 * Integration tests for the ACR tree rendering pipeline.
 *
 * These tests exercise the full data/view stack without a DI container:
 *   DataProviders -> DataItemTree -> ViewProviders -> ViewItemTree -> TreeItems
 *
 * ARM calls are intercepted at the client-factory level so no network
 * traffic is generated.
 */
describe('ACR Tree Integration (integration)', () => {

    // -- Test data --------------------------------------------------------

    const account = makeAccount();
    const tenant = makeTenant({ account });
    const subscription = makeSubscription({ account });
    const resourceGroup = makeResourceGroup({ subscription });

    const acrRegistry = makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg',
        name: 'myReg',
        type: AcrResourceType,
        logicalType: AcrResourceType,
        subscription,
    });

    const nonAcrResource = makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/mySite',
        name: 'mySite',
        type: 'Microsoft.Web/sites',
        logicalType: 'Microsoft.Web/sites',
        subscription,
    });

    // -- Factories --------------------------------------------------------

    interface TestPipeline {
        readonly dataTree: DataItemTree<ConcreteAzureNode>;
        readonly viewTree: ViewItemTree<string, ConcreteAzureNode>;
        readonly mockVscode: ReturnType<typeof createMockVsCode>;
    }

    /**
     * Wire up the full tree pipeline with real providers and mock clients.
     */
    function createTestPipeline(options?: {
        resources?: ConcreteAzureNode[];
        acrClientOverrides?: Record<string, unknown>;
    }): TestPipeline {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const output = new DebugOutputChannel('test');
        const mockVscode = createMockVsCode();
        const code = mockVscode.vscode;

        // Data layer
        const dataTree = new DataItemTree<ConcreteAzureNode>(
            'test-acr-tree',
            executor,
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000,
            output,
        );

        const subProvider = createMockSubscriptionProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        });
        const resources = options?.resources ?? [acrRegistry, nonAcrResource];
        const resourceClient = createMockResourceClient([resourceGroup], resources);
        const acrClient = createMockAcrClient(options?.acrClientOverrides);

        const resourceClientProvider: IResourceClientProvider = () => Promise.resolve(resourceClient);
        const acrClientProvider: IAcrClientProvider = () => Promise.resolve(acrClient);

        const genericDataProvider = new GenericAzureDataProvider(
            mockVscode.vscode,
            executor,
            output,
            resourceClientProvider,
            subProvider,
        );

        const acrDataProvider = new AcrDataProvider(
            executor,
            acrClientProvider,
        );

        // Register in correct order: ACR first, generic fallback second
        dataTree.registerProvider(acrDataProvider);
        dataTree.registerProvider(genericDataProvider);

        // View layer
        const viewOptions: ViewItemTreeOptions<string, ConcreteAzureNode> = {
            dataItemTree: dataTree,
            toViewItem: resource => AzureNodeId.from(resource).toString(),
            getKey: key => key,
            getResourceKey: key => key,
        };

        const viewTree = new ViewItemTree<string, ConcreteAzureNode>(
            'test-acr-tree',
            executor,
            viewOptions,
            undefined,
            output,
        );

        const acrViewProvider = new AcrViewProvider(
            code,
            executor,
            output,
            dataTree,
        );

        const genericViewProvider = new GenericAzureViewProvider(
            code,
            executor,
            dataTree,
        );

        // Register in correct order: ACR first, generic fallback second
        viewTree.registerProvider(acrViewProvider);
        viewTree.registerProvider(genericViewProvider);

        return { dataTree, viewTree, mockVscode };
    }

    // -- Helpers -----------------------------------------------------------

    /**
     * Walk the view tree recursively and collect all rendered tree items
     * in depth-first order.
     */
    async function collectTree(
        viewTree: ViewItemTree<string, ConcreteAzureNode>,
        parent?: string,
        depth = 0,
        maxDepth = 10,
    ): Promise<{ key: string; item: ITreeItem; depth: number }[]> {
        if (depth > maxDepth) {
            return [];
        }

        const children = await viewTree.getChildren(parent);
        const results: { key: string; item: ITreeItem; depth: number }[] = [];

        for (const child of children) {
            const item = await viewTree.getTreeItem(child);
            results.push({ key: child, item, depth });

            // Recurse into collapsible items
            if (item.collapsibleState !== undefined && item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
                const nested = await collectTree(viewTree, child, depth + 1, maxDepth);
                results.push(...nested);
            }
        }

        return results;
    }

    function findByLabel(
        nodes: { key: string; item: ITreeItem; depth: number }[],
        label: string,
    ) {
        return nodes.find(n => n.item.label === label);
    }

    function filterByDepth(
        nodes: { key: string; item: ITreeItem; depth: number }[],
        depth: number,
    ) {
        return nodes.filter(n => n.depth === depth);
    }

    // -- Tests ------------------------------------------------------------

    describe('full tree rendering', () => {
        it('should render the complete tree from subscription down to ACR leaf items', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);

            // With one account + one tenant, both are skipped.
            // Root should be the subscription.
            const sub = findByLabel(tree, 'Test Subscription');
            expect(sub, 'subscription node').to.exist;
            expect(sub!.depth).to.equal(0);

            // Subscription -> resource group
            const rg = findByLabel(tree, 'rg1');
            expect(rg, 'resource group node').to.exist;
            expect(rg!.depth).to.equal(1);

            // Resource group -> resources
            const registry = findByLabel(tree, 'myReg');
            expect(registry, 'ACR registry node').to.exist;
            expect(registry!.depth).to.equal(2);

            const site = findByLabel(tree, 'mySite');
            expect(site, 'non-ACR resource node').to.exist;
            expect(site!.depth).to.equal(2);

            // ACR registry -> category nodes
            const repos = findByLabel(tree, 'Repositories');
            expect(repos, 'Repositories category').to.exist;
            expect(repos!.depth).to.equal(3);

            const webhooks = findByLabel(tree, 'Webhooks');
            expect(webhooks, 'Webhooks category').to.exist;
            expect(webhooks!.depth).to.equal(3);

            // Category -> leaf items
            const repo1 = findByLabel(tree, 'repo-1');
            expect(repo1, 'repo-1 leaf').to.exist;
            expect(repo1!.depth).to.equal(4);

            const webhook1 = findByLabel(tree, 'webhook-1');
            expect(webhook1, 'webhook-1 leaf').to.exist;
            expect(webhook1!.depth).to.equal(4);
        });

        it('should render the correct number of nodes at each level', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);

            // 1 subscription (root)
            expect(filterByDepth(tree, 0)).to.have.length(1);
            // 1 resource group
            expect(filterByDepth(tree, 1)).to.have.length(1);
            // 2 resources (ACR registry + web site)
            expect(filterByDepth(tree, 2)).to.have.length(2);
            // 2 ACR categories (Repositories + Webhooks) -- non-ACR resource has no children
            expect(filterByDepth(tree, 3)).to.have.length(2);
            // 6 leaf items (3 repos + 3 webhooks)
            expect(filterByDepth(tree, 4)).to.have.length(6);
        });
    });

    describe('ACR-specific rendering', () => {
        it('should render ACR registry with package icon and correct context values', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);
            const registry = findByLabel(tree, 'myReg');
            expect(registry).to.exist;

            const item = registry!.item;
            expect(item.contextValue).to.include('openInPortal');
            expect(item.contextValue).to.include('disableAcrAdminUser');
            expect((item.iconPath as { id: string }).id).to.equal('package');
        });

        it('should render non-ACR resource with generic icon and openInPortal context', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);
            const site = findByLabel(tree, 'mySite');
            expect(site).to.exist;

            const item = site!.item;
            expect(item.contextValue).to.include('openInPortal');
            expect(item.contextValue).to.not.include('disableAcrAdminUser');
            expect((item.iconPath as { id: string }).id).to.equal('symbol-misc');
        });

        it('should render Repositories as collapsed folder with acrCategory context', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);
            const repos = findByLabel(tree, 'Repositories');
            expect(repos).to.exist;

            const item = repos!.item;
            expect(item.contextValue).to.equal('acrCategory');
            expect((item.iconPath as { id: string }).id).to.equal('folder');
        });

        it('should render leaf items as non-collapsible with acrItem context', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);
            const repo1 = findByLabel(tree, 'repo-1');
            expect(repo1).to.exist;

            const item = repo1!.item;
            expect(item.contextValue).to.equal('acrItem');
            expect((item.iconPath as { id: string }).id).to.equal('symbol-misc');
            // Non-collapsible = state 0 (None) or undefined
            expect(item.collapsibleState ?? vscode.TreeItemCollapsibleState.None).to.equal(vscode.TreeItemCollapsibleState.None);
        });
    });

    describe('enrichment', () => {
        it('should show warning icon when admin user is enabled after enrichment', async () => {
            const { viewTree, dataTree } = createTestPipeline({
                acrClientOverrides: {
                    registries: {
                        get: () => Promise.resolve({
                            loginServer: 'myreg.azurecr.io',
                            sku: { name: 'Basic', tier: 'Basic' },
                            adminUserEnabled: true,
                        }),
                    },
                },
            });

            // Walk the tree to populate it
            await collectTree(viewTree);

            // Find the registry in the data tree and wait for enrichment
            const registryKey = AzureNodeId.from(acrRegistry).toString();
            const registryNode = dataTree.get(registryKey);
            expect(registryNode, 'registry should be in data tree').to.exist;

            await dataTree.whenEnriched(registryNode!);

            // Re-render the tree item after enrichment
            const item = await viewTree.getTreeItem(registryKey);
            expect(item.tooltip).to.be.a('string');
            expect((item.tooltip as string).toLowerCase()).to.include('admin');
            expect((item.iconPath as { id: string }).id).to.equal('warning');
        });

        it('should show description with logicalType after enrichment', async () => {
            const { viewTree, dataTree } = createTestPipeline();

            await collectTree(viewTree);

            const registryKey = AzureNodeId.from(acrRegistry).toString();
            const registryNode = dataTree.get(registryKey);
            expect(registryNode).to.exist;

            await dataTree.whenEnriched(registryNode!);

            const item = await viewTree.getTreeItem(registryKey);
            expect(item.description).to.equal(AcrResourceType);
        });
    });

    describe('mixed provider dispatch', () => {
        it('should use ACR provider for ACR resources and generic provider for others', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);

            // ACR registry should have ACR-specific rendering (package icon, two context values)
            const registry = findByLabel(tree, 'myReg');
            expect(registry).to.exist;
            expect(registry!.item.contextValue).to.include('disableAcrAdminUser');

            // Non-ACR resource should have generic rendering (symbol-misc icon, only openInPortal)
            const site = findByLabel(tree, 'mySite');
            expect(site).to.exist;
            expect(site!.item.contextValue).to.not.include('disableAcrAdminUser');

            // ACR registry should have children (categories), non-ACR should not
            const acrChildren = tree.filter(n => n.depth === 3);
            expect(acrChildren.length).to.be.greaterThan(0);
        });

        it('should handle a resource group with only ACR registries', async () => {
            const { viewTree } = createTestPipeline({
                resources: [acrRegistry],
            });

            const tree = await collectTree(viewTree);

            // Should still render the full tree
            expect(findByLabel(tree, 'myReg')).to.exist;
            expect(findByLabel(tree, 'Repositories')).to.exist;
            expect(findByLabel(tree, 'mySite')).to.not.exist;
        });

        it('should handle a resource group with no ACR registries', async () => {
            const { viewTree } = createTestPipeline({
                resources: [nonAcrResource],
            });

            const tree = await collectTree(viewTree);

            expect(findByLabel(tree, 'mySite')).to.exist;
            expect(findByLabel(tree, 'myReg')).to.not.exist;
            expect(findByLabel(tree, 'Repositories')).to.not.exist;
        });

        it('should handle multiple ACR registries in the same resource group', async () => {
            const secondRegistry = makeGenericResource({
                id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/otherReg',
                name: 'otherReg',
                type: AcrResourceType,
                logicalType: AcrResourceType,
                subscription,
            });

            const { viewTree } = createTestPipeline({
                resources: [acrRegistry, secondRegistry],
            });

            const tree = await collectTree(viewTree);

            const reg1 = findByLabel(tree, 'myReg');
            const reg2 = findByLabel(tree, 'otherReg');
            expect(reg1, 'first registry').to.exist;
            expect(reg2, 'second registry').to.exist;

            // Both should have ACR-specific context values
            expect(reg1!.item.contextValue).to.include('disableAcrAdminUser');
            expect(reg2!.item.contextValue).to.include('disableAcrAdminUser');

            // Both should have categories
            const categories = tree.filter(n => n.item.contextValue === 'acrCategory');
            expect(categories).to.have.length(4); // 2 categories x 2 registries
        });
    });

    describe('tree structure', () => {
        it('should support getParent navigation back to the root', async () => {
            const { viewTree } = createTestPipeline();

            const tree = await collectTree(viewTree);

            // Find a leaf item and walk up
            const repo1 = findByLabel(tree, 'repo-1');
            expect(repo1).to.exist;

            const repoParent = await viewTree.getParent(repo1!.key);
            expect(repoParent).to.exist;

            // Parent of repo should be Repositories category
            const repoParentItem = await viewTree.getTreeItem(repoParent!);
            expect(repoParentItem.label).to.equal('Repositories');
        });

        it('should skip account and tenant levels when there is only one of each', async () => {
            const { viewTree } = createTestPipeline();

            const roots = await viewTree.getChildren();

            // With 1 account + 1 tenant, roots should be subscriptions
            expect(roots).to.have.length(1);
            const rootItem = await viewTree.getTreeItem(roots[0]);
            expect(rootItem.label).to.equal('Test Subscription');
        });
    });
});
