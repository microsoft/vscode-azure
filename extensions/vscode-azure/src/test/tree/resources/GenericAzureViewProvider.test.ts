/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeResourceGroup, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../commands/OpenInPortal';
import { GenericAzureViewProvider } from '../../../tree/resources/GenericAzureViewProvider';

describe('GenericAzureViewProvider (unit)', () => {
    function createProvider(cache?: Map<string, ConcreteAzureNode>) {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const cacheMap = cache ?? new Map<string, ConcreteAzureNode>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: () => Promise.resolve([]),
        };
        return new GenericAzureViewProvider(vscode, executor, mockCache as never);
    }

    describe('canHandle', () => {
        it('should return true for azr:// URIs', () => {
            const provider = createProvider();
            expect(provider.canHandle('azr://user1@portal.azure.com')).to.be.true;
        });

        it('should return false for non-string values', () => {
            const provider = createProvider();
            expect(provider.canHandle(42)).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });

        it('should return false for non-azr:// strings', () => {
            const provider = createProvider();
            expect(provider.canHandle('https://example.com')).to.be.false;
        });
    });

    describe('getTreeItem', () => {
        it('should render a subscription tree item with OpenInPortal context', () => {
            const sub = makeSubscription();
            const key = AzureNodeId.from(sub).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, sub as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('Test Subscription');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        });

        it('should render a resource group tree item', () => {
            const rg = makeResourceGroup();
            const key = AzureNodeId.from(rg).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, rg]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('rg1');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        });

        it('should render a generic resource as a leaf node', () => {
            const resource = makeGenericResource();
            const key = AzureNodeId.from(resource).toString();
            const cache = new Map<string, ConcreteAzureNode>([[key, resource as ConcreteAzureNode]]);
            const provider = createProvider(cache);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('site1');
            expect(item.description).to.equal('Microsoft.Web/sites');
        });

        it('should render a virtual group node', () => {
            const provider = createProvider();
            const key = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/~resourceType/Microsoft.Web%2Fsites';

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('Microsoft.Web/sites');
        });
    });

    describe('getParent', () => {
        it('should return the parent key for a resource group', () => {
            const provider = createProvider();
            const rgKey = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1';

            const parentKey = provider.getParent(rgKey);

            // Parent of a resource group is the subscription
            expect(parentKey).to.not.be.undefined;
            expect(AzureNodeId.parse(parentKey!).isSubscriptionNodeId()).to.be.true;
        });

        it('should return undefined for root-level nodes (subscriptions when account/tenant skipped)', () => {
            const provider = createProvider();
            const subKey = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1';

            // Default rootKind is 'subscription', so subscription's parent (tenant) is above effective root
            const parentKey = provider.getParent(subKey);
            expect(parentKey).to.be.undefined;
        });
    });
});
