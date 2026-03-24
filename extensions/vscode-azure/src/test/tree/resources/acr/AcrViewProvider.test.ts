/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../../commands/OpenInPortal';
import { DisableAcrAdminUser } from '../../../../commands/acr/DisableAcrAdminUser';
import type { AcrRegistry } from '../../../../tree/resources/acr/AcrRegistry';
import { AcrResourceType } from '../../../../tree/resources/acr/AcrRegistry';
import { AcrViewProvider } from '../../../../tree/resources/acr/AcrViewProvider';

function makeAcrRegistry(overrides?: Partial<AcrRegistry>): AcrRegistry {
    return makeGenericResource({
        id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg',
        name: 'myReg',
        type: AcrResourceType,
        logicalType: AcrResourceType,
        loginServer: 'myreg.azurecr.io',
        sku: { name: 'Basic', tier: 'Basic' },
        adminUserEnabled: false,
        ...overrides,
    }) as AcrRegistry;
}

describe('AcrViewProvider (unit)', () => {
    function createProvider(cache?: Map<string, ConcreteAzureNode>) {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const cacheMap = cache ?? new Map<string, ConcreteAzureNode>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: () => Promise.resolve([]),
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

        it('should show a warning icon when admin user is enabled', () => {
            const registry = makeAcrRegistry({ adminUserEnabled: true });
            const key = AzureNodeId.from(registry).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, registry as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.tooltip).to.be.a('string');
            expect((item.tooltip as string).toLowerCase()).to.include('admin');
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
