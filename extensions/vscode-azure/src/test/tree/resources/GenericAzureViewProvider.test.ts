/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { ActionExecutor } from '@microsoft/vscode-azure-utils';
import { NullTelemetryReporter } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../commands/OpenInPortal';
import { GenericAzureViewProvider } from '../../../tree/resources/GenericAzureViewProvider';

// TODO: No coverage yet for other grouping strategies

describe('GenericAzureViewProvider (unit)', () => {
    function createProvider(
        nodes?: ConcreteAzureNode[],
        childrenMap?: Map<ConcreteAzureNode, ConcreteAzureNode[]>,
    ) {
        const executor = new ActionExecutor(new NullTelemetryReporter());
        const allNodes = nodes ?? [];
        const cacheMap = new Map<string, ConcreteAzureNode>();
        for (const n of allNodes) {
            cacheMap.set(AzureNodeId.from(n).toString(), n);
        }
        const children = childrenMap ?? new Map<ConcreteAzureNode, ConcreteAzureNode[]>();
        const mockCache = {
            get: (key: string) => cacheMap.get(key),
            getChildren: (node?: ConcreteAzureNode) => {
                if (!node) {
                    // Root children: return nodes that don't appear as children of others
                    const allChildIds = new Set([...children.values()].flat().map(n => AzureNodeId.from(n).toString()));
                    return Promise.resolve(allNodes.filter(n => !allChildIds.has(AzureNodeId.from(n).toString())));
                }
                return Promise.resolve(children.get(node) ?? []);
            },
        };
        return new GenericAzureViewProvider(vscode, { code: vscode, extensionContext: {} as never }, executor, mockCache as never);
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

    describe('getChildren', () => {
        it('should skip single account and single tenant to show subscriptions directly', async () => {
            const account = makeAccount();
            const tenant = makeTenant();
            const sub1 = makeSubscription({ subscriptionId: 'sub-1', name: 'Sub 1' });
            const sub2 = makeSubscription({ subscriptionId: 'sub-2', name: 'Sub 2' });
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [account, [tenant]],
                [tenant, [sub1, sub2]],
            ]);
            const provider = createProvider(
                [account, tenant, sub1, sub2],
                childrenMap,
            );

            const roots = await provider.getChildren();
            expect(roots).to.have.length(2);
            for (const key of roots) {
                expect(AzureNodeId.parse(key).isSubscriptionNodeId()).to.be.true;
            }
        });

        it('should stop skipping if there are multiple accounts', async () => {
            const a1 = makeAccount({ id: 'a1', label: 'Account 1' });
            const a2 = makeAccount({ id: 'a2', label: 'Account 2' });
            const provider = createProvider([a1, a2]);

            const roots = await provider.getChildren();
            expect(roots).to.have.length(2);
            for (const key of roots) {
                expect(AzureNodeId.parse(key).isAccountNodeId()).to.be.true;
            }
        });

        it('should return resource group keys for a subscription branch', async () => {
            const sub = makeSubscription();
            const rg = makeResourceGroup();
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [sub, [rg]],
            ]);
            const provider = createProvider(
                [sub, rg],
                childrenMap,
            );

            const subKey = AzureNodeId.from(sub).toString();
            const children = await provider.getChildren(subKey);
            expect(children).to.have.length(1);
            expect(AzureNodeId.parse(children[0]).isResourceGroupNodeId()).to.be.true;
        });

        it('should return child keys for a resource group branch', async () => {
            const sub = makeSubscription();
            const rg = makeResourceGroup();
            const res = makeGenericResource();
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [rg, [res]],
            ]);
            const provider = createProvider(
                [sub, rg, res],
                childrenMap,
            );

            const rgKey = AzureNodeId.from(rg).toString();
            const children = await provider.getChildren(rgKey);
            expect(children).to.have.length(1);
        });

        it('should return empty for an unknown key', async () => {
            const provider = createProvider();
            const children = await provider.getChildren('azr://unknown@portal.azure.com');
            expect(children).to.deep.equal([]);
        });
    });

    describe('getTreeItem', () => {
        it('should render an account tree item', () => {
            const account = makeAccount();
            const key = AzureNodeId.from(account).toString();
            const provider = createProvider([account]);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('Test Account');
        });

        it('should render a tenant tree item', () => {
            const tenant = makeTenant();
            const key = AzureNodeId.from(tenant).toString();
            const provider = createProvider([tenant]);

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal('Test Tenant');
        });

        it('should render a subscription tree item with OpenInPortal context', () => {
            const sub = makeSubscription();
            const key = AzureNodeId.from(sub).toString();
            const provider = createProvider([sub]);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('Test Subscription');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        });

        it('should render a resource group tree item', () => {
            const rg = makeResourceGroup();
            const key = AzureNodeId.from(rg).toString();
            const provider = createProvider([rg]);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('rg1');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        });

        it('should render a generic resource as a leaf node', () => {
            const resource = makeGenericResource();
            const key = AzureNodeId.from(resource).toString();
            const provider = createProvider([resource]);

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

        it('should return a fallback tree item for an unknown key', () => {
            const provider = createProvider();
            const key = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/unknown';

            const item = provider.getTreeItem(key);
            expect(item.label).to.equal(key);
        });
    });

    describe('getParent', () => {
        it('should return the parent key for a resource group', () => {
            const provider = createProvider();
            const rgKey = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1';

            const parentKey = provider.getParent(rgKey);

            expect(parentKey).to.not.be.undefined;
            expect(AzureNodeId.parse(parentKey!).isSubscriptionNodeId()).to.be.true;
        });

        it('should return undefined for root-level nodes (subscriptions when account/tenant skipped)', () => {
            const provider = createProvider();
            const subKey = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1';

            const parentKey = provider.getParent(subKey);
            expect(parentKey).to.be.undefined;
        });

        it('should return undefined for account-level root', () => {
            const provider = createProvider();
            const accountKey = 'azr://acc1@portal.azure.com';

            const parentKey = provider.getParent(accountKey);
            expect(parentKey).to.be.undefined;
        });
    });
});
