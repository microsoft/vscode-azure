/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockHierarchicalDataItemTree } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { DeleteAzureResource } from '../../../../src/commands/tree/DeleteAzureResource';
import { OpenInPortal } from '../../../../src/commands/tree/OpenInPortal';
import {
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebAppFunction,
    type StaticWebAppNoFunctions,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppViewProvider } from '../../../../src/tree/resources/staticWebApps/StaticWebAppViewProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment, makeStaticWebAppFunctions } from './mockStaticWebApp';

describe('StaticWebAppViewProvider (unit)', () => {
    function createProvider(resources: ConcreteAzureNode[], children = new Map<ConcreteAzureNode, ConcreteAzureNode[]>()) {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const cache = createMockHierarchicalDataItemTree(resources, children);
        const provider = new StaticWebAppViewProvider(ctx, executor, cache);
        return { provider, ctx, cache };
    }

    function render(resource: ConcreteAzureNode) {
        const { provider, ctx } = createProvider([resource]);
        const key = AzureNodeId.from(resource).toString();
        return { item: provider.getTreeItem(key), key, ctx };
    }

    afterEach(() => {
        mock.restoreAll();
    });

    it('should convert cached children into view keys', async () => {
        const site = makeStaticWebApp();
        const environment = makeStaticWebAppEnvironment({ azureResource: site });
        const { provider } = createProvider([site], new Map([[site, [environment]]]));
        const key = AzureNodeId.from(site).toString();

        expect(provider.canHandle(key)).to.be.true;
        expect(await provider.getChildren(key)).to.deep.equal([AzureNodeId.from(environment).toString()]);
    });

    it('should render a fallback item and empty children for a missing cached node', async () => {
        const { provider, cache } = createProvider([]);
        const key = AzureNodeId.from(makeStaticWebApp()).toString();
        const getChildren = mock.method(cache, 'getChildren');

        expect(provider.canHandle(key)).to.be.false;
        expect(provider.canHandle('not-an-azure-node')).to.be.false;
        expect(provider.getTreeItem(key).label).to.equal(key);
        expect(provider.getTreeItem(key).contextValue).to.be.undefined;
        expect(await provider.getChildren(key)).to.deep.equal([]);
        expect(await provider.getChildren()).to.deep.equal([]);
        expect(getChildren.mock.callCount()).to.equal(0);
    });

    it('should render a collapsible Functions group with portal actions', () => {
        const group = makeStaticWebAppFunctions();
        const { item, key, ctx } = render(group);

        expect(item.id).to.equal(key);
        expect(item.label).to.equal('Functions');
        expect(item.collapsibleState).to.equal(ctx.code.TreeItemCollapsibleState.Collapsed);
        expect(item.contextValue).to.include('azureStaticFunctions');
        expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        expect(item.iconPath).to.deep.equal(new ctx.code.ThemeIcon('list-unordered'));
    });

    it('should render a function as a named leaf with a function icon', () => {
        const group = makeStaticWebAppFunctions({ environmentBuildId: '42' });
        const func: StaticWebAppFunction = {
            virtualType: StaticWebAppVirtualTypes.Function,
            virtualPath: `${group.virtualPath}/HttpTrigger`,
            azureResource: group.azureResource,
            environmentBuildId: group.environmentBuildId,
            data: { functionName: 'HttpTrigger' },
            functionName: 'HttpTrigger',
        };
        const { item, key, ctx } = render(func);

        expect(item.id).to.equal(key);
        expect(item.label).to.equal(func.functionName);
        expect(item.collapsibleState).to.equal(ctx.code.TreeItemCollapsibleState.None);
        expect(item.contextValue).to.equal('azureStaticFunction');
        expect(item.iconPath).to.deep.equal(new ctx.code.ThemeIcon('symbol-function'));
    });

    it('should render the site root with stable compatibility and portal contexts', () => {
        const { item, ctx } = render(makeStaticWebApp());
        expect(item.label).to.equal('mySwa');
        expect(item.description).to.be.undefined;
        expect(item.contextValue).to.include(StaticWebAppViewProvider.ContextValue);
        expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        expect(item.collapsibleState).to.equal(ctx.code.TreeItemCollapsibleState.Collapsed);
    });

    it('should offer the generic delete on the site rather than a product-specific one', () => {
        const { item } = render(makeStaticWebApp());
        expect(item.contextValue).to.include(DeleteAzureResource.ResourceContextValue);
    });

    it('should prioritize environment status and show branches when ready', () => {
        const failed = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Deploying',
        })).item;
        expect(failed.description).to.equal('feature (Deploying)');

        const ready = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Ready',
        })).item;
        expect(ready.description).to.equal('feature');
        expect(ready.contextValue).to.include('azureStaticEnvironment');
    });

    it('should render distinct no-functions help and empty-list semantics', () => {
        const site = makeStaticWebApp();
        const help: StaticWebAppNoFunctions = {
            virtualType: StaticWebAppVirtualTypes.NoFunctions,
            virtualPath: 'environments/default/noFunctions/help',
            azureResource: site,
            kind: 'help',
        };
        const empty: StaticWebAppNoFunctions = {
            ...help,
            virtualPath: 'environments/default/functions/noFunctions/empty',
            kind: 'empty',
        };

        expect(render(help).item.command?.command).to.equal('vscode-azure/staticWebApps/showFunctionsDocumentation');
        expect(render(empty).item.command).to.be.undefined;
        expect(render(empty).item.label).to.equal('No Functions have been pushed to this Static Web App.');
    });

    it('should render exact invalid context variants', () => {
        const invalid: InvalidStaticWebAppNode = {
            virtualType: StaticWebAppVirtualTypes.Invalid,
            virtualPath: 'environments/invalid/broken',
            azureResource: makeStaticWebApp(),
            invalidContextValue: 'invalidStaticEnvironment',
            sourceLabel: 'broken',
        };
        expect(render(invalid).item.contextValue).to.equal('invalidStaticEnvironment');
    });
});
