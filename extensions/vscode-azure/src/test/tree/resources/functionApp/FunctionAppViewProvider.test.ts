/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../../commands/OpenInPortal';
import { AddOrEditAppSetting } from '../../../../commands/functionApp/AddOrEditAppSetting';
import { DeleteAppSetting } from '../../../../commands/functionApp/DeleteAppSetting';
import { FunctionAppViewProvider } from '../../../../tree/resources/functionApp/FunctionAppViewProvider';
import { FunctionAppVirtualPaths, FunctionAppVirtualTypes } from '../../../../tree/resources/functionApp/FunctionApp';
import { makeFunctionApp } from './mockFunctionApp';

const mockExtensionContext = {
    extensionUri: vscode.Uri.file('/test-extension'),
} as vscode.ExtensionContext;

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
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const cacheMap = cache ?? new Map<string, ConcreteAzureNode>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: (node: ConcreteAzureNode) => Promise.resolve([] as ConcreteAzureNode[]),
        };
        return new FunctionAppViewProvider(vscode, mockExtensionContext, executor, mockCache as never);
    }

    describe('canHandle', () => {
        it('should return true for Function App keys in the cache', () => {
            const app = makeFunctionApp();
            const key = AzureNodeId.from(app).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, app as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return true for virtual resources owned by a Function App', () => {
            const vr = makeFunctionAppVirtual();
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return false for non-Function App keys', () => {
            const resource = makeGenericResource();
            const key = AzureNodeId.from(resource).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, resource as ConcreteAzureNode]]);
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
        it('should render a Function App with FunctionApp icon and Collapsed state', () => {
            const app = makeFunctionApp();
            const key = AzureNodeId.from(app).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, app as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('myFunc');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(item.iconPath).to.be.instanceOf(vscode.Uri);
            expect((item.iconPath as vscode.Uri).path).to.match(/FunctionApp\.svg$/);
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
            expect(item.contextValue).to.include(FunctionAppViewProvider.ContextValue);
        });

        it('should render App Settings category with folder icon', () => {
            const vr = makeFunctionAppVirtual();
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal(FunctionAppVirtualPaths.AppSettings);
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(item.iconPath).to.deep.equal(new vscode.ThemeIcon('folder'));
            expect(item.contextValue).to.include(AddOrEditAppSetting.AddContextValue);
        });

        it('should render individual app setting with symbol-key icon', () => {
            const vr = makeFunctionAppVirtual({
                virtualType: FunctionAppVirtualTypes.AppSetting,
                virtualPath: 'MY_KEY',
            });
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('MY_KEY');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
            expect(item.iconPath).to.deep.equal(new vscode.ThemeIcon('symbol-key'));
            expect(item.contextValue).to.include(AddOrEditAppSetting.EditContextValue);
            expect(item.contextValue).to.include(DeleteAppSetting.ContextValue);
        });

    });
});
