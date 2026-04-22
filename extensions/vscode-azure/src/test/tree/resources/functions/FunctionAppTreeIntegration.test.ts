/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type IResourceClientProvider, type IWebAppClient } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { DataItemTree, type ITreeItem, ViewItemTree, type ViewItemTreeOptions } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { AddOrEditAppSetting } from '../../../../commands/functions/AddOrEditAppSetting';
import { DeleteAppSetting } from '../../../../commands/functions/DeleteAppSetting';
import { createMockResourceClient, createMockSubscriptionProvider } from '../../../../debug/mockData';
import { FunctionAppVirtualPaths } from '../../../../tree/resources/functions/FunctionApp';
import { FunctionAppDataProvider } from '../../../../tree/resources/functions/FunctionAppDataProvider';
import { FunctionAppViewProvider } from '../../../../tree/resources/functions/FunctionAppViewProvider';
import { GenericAzureDataProvider } from '../../../../tree/resources/GenericAzureDataProvider';
import { GenericAzureViewProvider } from '../../../../tree/resources/GenericAzureViewProvider';
import { makeFunctionApp } from './mockFunctionApp';

/**
 * Integration tests for the Function App tree rendering pipeline and CRUD commands.
 *
 * These tests exercise the full data/view stack without a DI container:
 *   DataProviders -> DataItemTree -> ViewProviders -> ViewItemTree -> TreeItems
 *
 * ARM calls are intercepted at the client-factory level so no network
 * traffic is generated.
 */
describe('Function App Tree Integration (integration)', () => {

    // -- Test data --------------------------------------------------------

    const account = makeAccount();
    const tenant = makeTenant({ account });
    const subscription = makeSubscription({ account });
    const resourceGroup = makeResourceGroup({ subscription });

    const functionApp = makeFunctionApp({
        subscription,
    });

    const nonFuncResource = makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/myStorage',
        name: 'myStorage',
        type: 'Microsoft.Storage/storageAccounts',
        logicalType: 'Microsoft.Storage/storageAccounts',
        subscription,
    });

    // -- Mock WebAppClient ------------------------------------------------

    function createMockWebAppClient(initialSettings?: Record<string, string>): { client: IWebAppClient; settings: Record<string, string> } {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- app setting keys use SCREAMING_SNAKE_CASE
        const settings = { ...initialSettings ?? { APP_KEY: 'app-value', DB_HOST: 'localhost' } };
        const client: IWebAppClient = {
            webApps: {
                listApplicationSettings: mock.fn(
                    () => Promise.resolve({ properties: { ...settings } }),
                ),
                updateApplicationSettings: mock.fn(
                    (_rg: string, _name: string, body: { properties?: Record<string, string> }) => {
                        // Synchronize the backing store so subsequent list calls reflect mutations
                        for (const k of Object.keys(settings)) {
                            Reflect.deleteProperty(settings, k);
                        }
                        Object.assign(settings, body.properties);
                        return Promise.resolve({ properties: { ...settings } });
                    },
                ),
            },
        };
        return { client, settings };
    }

    // -- Pipeline factory -------------------------------------------------

    interface TestPipeline {
        readonly dataTree: DataItemTree<ConcreteAzureNode>;
        readonly viewTree: ViewItemTree<string, ConcreteAzureNode>;
        readonly mockCtx: ReturnType<typeof createMockCodeContext>;
        readonly funcDataProvider: FunctionAppDataProvider;
        readonly webAppClient: IWebAppClient;
        readonly backingSettings: Record<string, string>;
    }

    function createTestPipeline(options?: {
        resources?: ConcreteAzureNode[];
        initialSettings?: Record<string, string>;
    }): TestPipeline {
        const { executor } = createTestActionExecutor();
        const mockCtx = createMockCodeContext();
        const ctx = mockCtx.ctx;
        const code = ctx.code;

        const { client: webAppClient, settings: backingSettings } = createMockWebAppClient(options?.initialSettings);
        const webAppClientProvider = () => Promise.resolve(webAppClient);

        // Data layer
        const dataTree = new DataItemTree<ConcreteAzureNode>(
            code,
            'test-func-tree',
            executor,
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000,
        );

        const subProvider = createMockSubscriptionProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        });
        const resources = options?.resources ?? [functionApp, nonFuncResource];
        const resourceClient = createMockResourceClient([resourceGroup], resources);
        const resourceClientProvider: IResourceClientProvider = () => Promise.resolve(resourceClient);

        const funcDataProvider = new FunctionAppDataProvider(executor, webAppClientProvider);
        const genericDataProvider = new GenericAzureDataProvider(code, executor, resourceClientProvider, subProvider);

        // Register in correct order: Function App first, generic fallback second
        dataTree.registerProvider(funcDataProvider);
        dataTree.registerProvider(genericDataProvider);

        // View layer
        const viewOptions: ViewItemTreeOptions<string, ConcreteAzureNode> = {
            dataItemTree: dataTree,
            toViewItem: resource => AzureNodeId.from(resource).toString(),
            getKey: key => key,
            getResourceKey: key => key,
        };

        const viewTree = new ViewItemTree<string, ConcreteAzureNode>(
            'test-func-tree',
            executor,
            viewOptions,
            undefined,
        );

        const funcViewProvider = new FunctionAppViewProvider(ctx, executor, dataTree);
        const genericViewProvider = new GenericAzureViewProvider(ctx, executor, dataTree);

        viewTree.registerProvider(funcViewProvider);
        viewTree.registerProvider(genericViewProvider);

        return { dataTree, viewTree, mockCtx, funcDataProvider, webAppClient, backingSettings };
    }

    // -- Helpers -----------------------------------------------------------

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

    // -- Tests: Tree rendering --------------------------------------------

    describe('full tree rendering', () => {
        it('should render Function App under the resource group', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            const func = findByLabel(tree, 'myFunc');
            expect(func, 'Function App node').to.exist;
            expect(func!.item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
        });

        it('should render App Settings category under the Function App', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            const category = findByLabel(tree, FunctionAppVirtualPaths.AppSettings);
            expect(category, 'App Settings category').to.exist;
            expect(category!.item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(category!.item.contextValue).to.include(AddOrEditAppSetting.AddContextValue);
        });

        it('should render individual settings as leaf nodes', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            const appKey = findByLabel(tree, 'APP_KEY');
            expect(appKey, 'APP_KEY setting').to.exist;
            expect(appKey!.item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
            expect(appKey!.item.contextValue).to.include(AddOrEditAppSetting.EditContextValue);
            expect(appKey!.item.contextValue).to.include(DeleteAppSetting.ContextValue);

            const dbHost = findByLabel(tree, 'DB_HOST');
            expect(dbHost, 'DB_HOST setting').to.exist;
        });

        it('should render correct node counts at each depth', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            // depth 0: subscription
            expect(filterByDepth(tree, 0)).to.have.length(1);
            // depth 1: resource group
            expect(filterByDepth(tree, 1)).to.have.length(1);
            // depth 2: Function App + storage account
            expect(filterByDepth(tree, 2)).to.have.length(2);
            // depth 3: App Settings category (non-func resource has no children)
            expect(filterByDepth(tree, 3)).to.have.length(1);
            // depth 4: 2 individual settings (APP_KEY, DB_HOST)
            expect(filterByDepth(tree, 4)).to.have.length(2);
        });

        it('should render settings in alphabetical order', async () => {
            const initialSettings = { ZEBRA: 'z', ALPHA: 'a', MIDDLE: 'm' };
            const { viewTree } = createTestPipeline({ initialSettings });
            const tree = await collectTree(viewTree);

            const settingNodes = filterByDepth(tree, 4);
            const labels = settingNodes.map(n => n.item.label);
            expect(labels).to.deep.equal(['ALPHA', 'MIDDLE', 'ZEBRA']);
        });
    });

    // -- Tests: Provider dispatch -----------------------------------------

    describe('provider dispatch', () => {
        it('should use Function App provider for func resources and generic for others', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            // Function App node exists
            const func = findByLabel(tree, 'myFunc');
            expect(func).to.exist;

            // Non-func resource also exists
            const storage = findByLabel(tree, 'myStorage');
            expect(storage).to.exist;
        });

        it('should handle resource group with only Function Apps', async () => {
            const { viewTree } = createTestPipeline({ resources: [functionApp] });
            const tree = await collectTree(viewTree);

            expect(findByLabel(tree, 'myFunc')).to.exist;
            expect(findByLabel(tree, FunctionAppVirtualPaths.AppSettings)).to.exist;
            expect(findByLabel(tree, 'myStorage')).to.not.exist;
        });

        it('should handle resource group with no Function Apps', async () => {
            const { viewTree } = createTestPipeline({ resources: [nonFuncResource] });
            const tree = await collectTree(viewTree);

            expect(findByLabel(tree, 'myStorage')).to.exist;
            expect(findByLabel(tree, 'myFunc')).to.not.exist;
            expect(findByLabel(tree, FunctionAppVirtualPaths.AppSettings)).to.not.exist;
        });
    });

    // -- Tests: CRUD commands ---------------------------------------------

    describe('DeleteAppSetting command', () => {
        it('should delete a setting and remove it from the tree on refresh', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();
            const code = mockCtx.ctx.code;

            // Populate the tree
            const treeBefore = await collectTree(viewTree);
            expect(findByLabel(treeBefore, 'APP_KEY')).to.exist;
            expect(findByLabel(treeBefore, 'DB_HOST')).to.exist;

            // Find the APP_KEY node key
            const appKeyNode = findByLabel(treeBefore, 'APP_KEY')!;

            // Mock the confirmation dialog to return 'Delete'
            mockCtx.mock.messageResponses.push('Delete');

            const command = new DeleteAppSetting(code, dataTree, funcDataProvider);
            await command.execute(appKeyNode.key);

            // Backing store should no longer have APP_KEY
            expect(backingSettings).to.not.have.property('APP_KEY');
            expect(backingSettings).to.have.property('DB_HOST');

            // Re-collect the tree after invalidation
            const treeAfter = await collectTree(viewTree);
            expect(findByLabel(treeAfter, 'APP_KEY')).to.not.exist;
            expect(findByLabel(treeAfter, 'DB_HOST')).to.exist;
        });

        it('should not delete when user cancels confirmation', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();
            const code = mockCtx.ctx.code;

            const treeBefore = await collectTree(viewTree);
            const appKeyNode = findByLabel(treeBefore, 'APP_KEY')!;

            // Simulate dismissal (no button clicked)

            const command = new DeleteAppSetting(code, dataTree, funcDataProvider);
            await command.execute(appKeyNode.key);

            // Setting should still exist
            expect(backingSettings).to.have.property('APP_KEY');
        });
    });

    describe('AddOrEditAppSetting (add) command', () => {
        it('should add a setting and show it in the tree on refresh', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();

            // Populate the tree
            const treeBefore = await collectTree(viewTree);
            expect(findByLabel(treeBefore, 'NEW_SETTING')).to.not.exist;

            // Find the App Settings category key
            const categoryNode = findByLabel(treeBefore, FunctionAppVirtualPaths.AppSettings)!;

            // Respond to the two input boxes: key then value
            respondToPrompts(mockCtx.mock, [
                { input: 'NEW_SETTING' },
                { input: 'new-value' },
            ]);

            const command = new AddOrEditAppSetting(mockCtx.ctx, dataTree, funcDataProvider);
            await command.execute('add', categoryNode.key);

            // Backing store should have the new setting
            expect(backingSettings).to.have.property('NEW_SETTING', 'new-value');

            // Re-collect the tree after invalidation
            const treeAfter = await collectTree(viewTree);
            expect(findByLabel(treeAfter, 'NEW_SETTING')).to.exist;
        });

        it('should not add when user cancels key input', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();

            const treeBefore = await collectTree(viewTree);
            const categoryNode = findByLabel(treeBefore, FunctionAppVirtualPaths.AppSettings)!;

            respondToPrompts(mockCtx.mock, [
                'cancel',
            ]);

            const command = new AddOrEditAppSetting(mockCtx.ctx, dataTree, funcDataProvider);

            try {
                await command.execute('add', categoryNode.key);
            } catch {
                // CancellationError is expected
            }

            expect(backingSettings).to.not.have.property('NEW_SETTING');
        });
    });

    describe('AddOrEditAppSetting (edit) command', () => {
        it('should update a setting value and reflect it in the data provider cache', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();

            // Populate the tree (this also populates the settings cache)
            const treeBefore = await collectTree(viewTree);
            const appKeyNode = findByLabel(treeBefore, 'APP_KEY')!;

            // Respond with the new value
            respondToPrompts(mockCtx.mock, [
                { input: 'updated-value' },
            ]);

            const command = new AddOrEditAppSetting(mockCtx.ctx, dataTree, funcDataProvider);
            await command.execute('edit', appKeyNode.key);

            // Backing store should have the updated value
            expect(backingSettings).to.have.property('APP_KEY', 'updated-value');

            // Data provider cache should reflect the update
            expect(funcDataProvider.getSettingValue(functionApp.id, 'APP_KEY')).to.equal('updated-value');
        });

        it('should not update when user cancels input', async () => {
            const { viewTree, dataTree, mockCtx, funcDataProvider, backingSettings } = createTestPipeline();

            const treeBefore = await collectTree(viewTree);
            const appKeyNode = findByLabel(treeBefore, 'APP_KEY')!;

            respondToPrompts(mockCtx.mock, [
                'cancel',
            ]);

            const command = new AddOrEditAppSetting(mockCtx.ctx, dataTree, funcDataProvider);

            try {
                await command.execute('edit', appKeyNode.key);
            } catch {
                // CancellationError is expected
            }

            // Original value should remain
            expect(backingSettings).to.have.property('APP_KEY', 'app-value');
        });
    });

    // -- Tests: Tree navigation -------------------------------------------

    describe('tree structure', () => {
        it('should support getParent navigation from setting to root', async () => {
            const { viewTree } = createTestPipeline();
            const tree = await collectTree(viewTree);

            // Start from a leaf setting
            const appKey = findByLabel(tree, 'APP_KEY');
            expect(appKey).to.exist;

            // Parent of setting = App Settings category
            const categoryKey = await viewTree.getParent(appKey!.key);
            expect(categoryKey).to.exist;
            const categoryItem = await viewTree.getTreeItem(categoryKey!);
            expect(categoryItem.label).to.equal(FunctionAppVirtualPaths.AppSettings);

            // Parent of category = Function App
            const funcKey = await viewTree.getParent(categoryKey!);
            expect(funcKey).to.exist;
            const funcItem = await viewTree.getTreeItem(funcKey!);
            expect(funcItem.label).to.equal('myFunc');
        });
    });
});
