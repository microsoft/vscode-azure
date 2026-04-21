/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../../commands/OpenInPortal';
import { DisableAcrAdminUser } from '../../../../commands/acr/DisableAcrAdminUser';
import { AcrResourceType } from '../../../../tree/resources/acr/AcrRegistry';
import { AcrViewProvider } from '../../../../tree/resources/acr/AcrViewProvider';
import { makeAcrRegistry } from './mockAcr';

function makeAcrVirtualResource(overrides?: Partial<VirtualResource>): VirtualResource {
    return makeVirtualResource({
        virtualType: 'acr.repository',
        virtualPath: 'myrepo',
        azureResource: makeAcrRegistry(),
        ...overrides,
    });
}

describe('AcrViewProvider (unit)', () => {
    function createProvider(
        cache?: Map<string, ConcreteAzureNode>,
        childrenFn?: (node: ConcreteAzureNode) => ConcreteAzureNode[],
    ) {
        const { executor } = createTestActionExecutor();
        const cacheMap = cache ?? new Map<string, ConcreteAzureNode>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: (node: ConcreteAzureNode) => Promise.resolve(childrenFn ? childrenFn(node) : []),
        };
        return new AcrViewProvider(vscode, executor, mockCache as never);
    }

    describe('canHandle', () => {
        it('should return true for ACR registry keys in the cache', () => {
            const registry = makeAcrRegistry();
            const key = AzureNodeId.from(registry).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, registry as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return true for virtual resources whose azureResource is an ACR registry', () => {
            const vr = makeAcrVirtualResource();
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            expect(provider.canHandle(key)).to.be.true;
        });

        it('should return false for non-ACR keys', () => {
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

        it('should return false for an azr:// key not in the cache', () => {
            const provider = createProvider();
            expect(provider.canHandle('azr://acc@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg')).to.be.false;
        });
    });

    describe('getTreeItem', () => {
        it('should render an ACR registry with package icon and both context values', () => {
            const registry = makeAcrRegistry();
            const key = AzureNodeId.from(registry).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, registry as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('myReg');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
            expect(item.contextValue).to.include(DisableAcrAdminUser.ContextValue);
        });

        it('should show description with logicalType for enriched registry', () => {
            const registry = makeAcrRegistry();
            const key = AzureNodeId.from(registry).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, registry as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.description).to.equal(AcrResourceType);
        });

        it('should show a warning icon when admin user is enabled', () => {
            const registry = makeAcrRegistry({ adminUserEnabled: true });
            const key = AzureNodeId.from(registry).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, registry as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.tooltip).to.be.a('string');
            expect((item.tooltip as string).toLowerCase()).to.include('admin');
        });

        it('should render a category virtual resource as collapsed', () => {
            const vr = makeAcrVirtualResource({ virtualPath: 'Repositories' });
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('Repositories');
            expect(item.contextValue).to.equal('acrCategory');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
        });

        it('should render a leaf virtual resource as non-collapsible', () => {
            const vr = makeAcrVirtualResource({ virtualPath: 'myimage' });
            const key = AzureNodeId.from(vr).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, vr as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('myimage');
            expect(item.contextValue).to.equal('acrItem');
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
        });

        it('should return a fallback tree item for an unknown key', () => {
            const provider = createProvider();
            const key = 'azr://acc@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/unknown';

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal(key);
        });
    });

    describe('getChildren', () => {
        it('should return empty for no key', async () => {
            const provider = createProvider();
            const children = await provider.getChildren();
            expect(children).to.deep.equal([]);
        });

        it('should return empty for an unknown key', async () => {
            const provider = createProvider();
            const children = await provider.getChildren('azr://acc@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/unknown');
            expect(children).to.deep.equal([]);
        });

        it('should delegate to cache and return child keys', async () => {
            const registry = makeAcrRegistry();
            const child = makeAcrVirtualResource({ virtualPath: 'Repositories' });
            const regKey = AzureNodeId.from(registry).toString();
            const childKey = AzureNodeId.from(child).toString();
            const cache = new Map<string, ConcreteAzureNode>([
                [regKey, registry as ConcreteAzureNode],
                [childKey, child as ConcreteAzureNode],
            ]);
            const provider = createProvider(cache, () => [child as ConcreteAzureNode]);

            const children = await provider.getChildren(regKey);
            expect(children).to.have.length(1);
        });
    });

    describe('getParent', () => {
        it('should return the parent key', () => {
            const provider = createProvider();
            const key = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg';

            const parentKey = provider.getParent(key);

            expect(parentKey).to.not.be.undefined;
            expect(AzureNodeId.parse(parentKey!).isResourceGroupNodeId()).to.be.true;
        });
    });
});
