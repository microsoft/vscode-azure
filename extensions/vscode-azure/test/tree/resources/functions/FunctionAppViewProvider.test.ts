/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { AddOrEditAppSetting } from '../../../../src/commands/functions/AddOrEditAppSetting';
import { DeleteAppSetting } from '../../../../src/commands/functions/DeleteAppSetting';
import { BrowseWebsite } from '../../../../src/commands/tree/BrowseWebsite';
import { OpenInPortal } from '../../../../src/commands/tree/OpenInPortal';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes } from '../../../../src/tree/resources/functions/FunctionApp';
import { FunctionAppViewProvider } from '../../../../src/tree/resources/functions/FunctionAppViewProvider';
import { makeFunctionApp } from './mockFunctionApp';
import { createMockEndpointResolver } from '../../../endpoints/mockEndpointResolver';

function makeFunctionAppVirtual(overrides?: Partial<VirtualResource>): VirtualResource {
    return makeVirtualResource({
        virtualType: FunctionAppVirtualTypes.AppSettings,
        virtualPath: FunctionAppVirtualPaths.AppSettings,
        azureResource: makeFunctionApp(),
        ...overrides,
    });
}

describe('FunctionAppViewProvider (unit)', () => {
    function createProvider(
        cache?: Map<string, ConcreteAzureNode>,
    ) {
        const { executor } = createTestActionExecutor();
        const { ctx } = createMockCodeContext();
        const cacheMap = cache ?? new Map<string, ConcreteAzureNode>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: (node: ConcreteAzureNode) => Promise.resolve([] as ConcreteAzureNode[]),
        };
        return new FunctionAppViewProvider(ctx, executor, mockCache as never, createMockEndpointResolver(true));
    }

    describe('canHandle', () => {
        it('should return true for Function App keys in the cache', () => {
            const app = makeFunctionApp();
            const key = AzureNodeId.from(app).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, app]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return true for virtual resources owned by a Function App', () => {
            const vr = makeFunctionAppVirtual();
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return false for non-Function App keys', () => {
            const resource = makeGenericResource();
            const key = AzureNodeId.from(resource).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, resource]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.false;
        });

        it('should return false for non-string values', () => {
            const provider = createProvider();
            expect(provider.canHandle(42)).to.be.false;
        });

        it('should return false for non-azr:// strings', () => {
            const provider = createProvider();
            expect(provider.canHandle('https://example.com')).to.be.false;
        });
    });

    describe('getTreeItem', () => {
        it('should render a Function App with Collapsed state', () => {
            const app = makeFunctionApp();
            const key = AzureNodeId.from(app).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, app]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('myFunc');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
            expect(item.contextValue).to.include(BrowseWebsite.ContextValue);
            expect(item.contextValue).to.include(FunctionAppViewProvider.ContextValue);
        });

        it('should render App Settings category as collapsed', () => {
            const vr = makeFunctionAppVirtual();
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal(FunctionAppVirtualPaths.AppSettings);
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(item.contextValue).to.include(AddOrEditAppSetting.AddContextValue);
        });

        it('should render individual app setting as leaf node', () => {
            const vr = makeFunctionAppVirtual({
                virtualType: FunctionAppVirtualTypes.AppSetting,
                virtualPath: 'MY_KEY',
            });
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('MY_KEY');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
            expect(item.contextValue).to.include(AddOrEditAppSetting.EditContextValue);
            expect(item.contextValue).to.include(DeleteAppSetting.ContextValue);
        });

    });
});
