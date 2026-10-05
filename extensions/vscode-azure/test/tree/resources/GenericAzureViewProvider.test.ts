/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AcrResourceType, AIFoundryProjectLogicalType, AIServicesLogicalType, AppServiceLogicalType, AzureNodeId, ContainerAppResourceType, CosmosDBLogicalType, CosmosDBMongoLogicalType, DocumentDbResourceType, DurableTaskHubLogicalType, FoundryProjectResourceType, FunctionAppLogicalType, LogicAppLogicalType, ManagedEnvironmentResourceType, StaticWebAppResourceType, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { BrowseWebsite } from '../../../src/commands/tree/BrowseWebsite';
import { DeleteAzureResource } from '../../../src/commands/tree/DeleteAzureResource';
import { OpenInPortal } from '../../../src/commands/tree/OpenInPortal';
import { AzdEnvNameTag, ConfigurationSection } from '../../../src/constants';
import { GenericAzureViewProvider } from '../../../src/tree/resources/GenericAzureViewProvider';
import { setWebsiteUrl } from '../../../src/tree/resources/websiteUrl';

describe('GenericAzureViewProvider (unit)', () => {
    const mockCodeContext = createMockCodeContext();

    function createProvider(
        nodes?: ConcreteAzureNode[],
        childrenMap?: Map<ConcreteAzureNode, ConcreteAzureNode[]>,
        onGetChildren?: (node: ConcreteAzureNode) => void,
    ) {
        const { executor } = createTestActionExecutor();
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
                onGetChildren?.(node);
                return Promise.resolve(children.get(node) ?? []);
            },
            loadAll: () => Promise.resolve(),
        };
        return new GenericAzureViewProvider(mockCodeContext.ctx, executor, mockCache as never);
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
            const sub1 = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Sub 1', tenantId: tenant.tenantId, accountId: tenant.accountId, environment: tenant.environment });
            const sub2 = makeSubscription({ subscriptionId: 'sub-2', displayName: 'Sub 2', tenantId: tenant.tenantId, accountId: tenant.accountId, environment: tenant.environment });
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

        it('should not skip single account when alwaysShowAccountNodes is true', async () => {
            const account = makeAccount();
            const tenant = makeTenant();
            const sub = makeSubscription({ tenantId: tenant.tenantId, accountId: tenant.accountId, environment: tenant.environment });
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [account, [tenant]],
                [tenant, [sub]],
            ]);

            const provider = createProvider(
                [account, tenant, sub],
                childrenMap,
            );

            const roots = await withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.alwaysShowAccountNodes`]: true }, () => provider.getChildren());
            expect(roots).to.have.length(1);
            expect(AzureNodeId.parse(roots[0]).isAccountNodeId()).to.be.true;
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
            expect(item.contextValue).to.include(DeleteAzureResource.ResourceGroupContextValue);
        });

        it('should use a rocket icon and azd env name as description for resource groups with azd-env-name tag', () => {
            const rg = makeResourceGroup({ tags: { [AzdEnvNameTag]: 'my-env' } });
            const key = AzureNodeId.from(rg).toString();
            const provider = createProvider([rg]);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('rg1');
            expect(item.description).to.equal('my-env');
            expect((item.iconPath as { id: string }).id).to.equal('rocket');
        });

        it('should use the standard ResourceGroup icon when azd-env-name tag is absent', () => {
            const rg = makeResourceGroup({ tags: { other: 'value' } });
            const key = AzureNodeId.from(rg).toString();
            const provider = createProvider([rg]);

            const item = provider.getTreeItem(key);

            expect(item.description).to.be.undefined;
            // Standard icon is a URI from getResourceTypeIconUri, not a ThemeIcon
            expect(item.iconPath).to.not.have.property('id');
        });

        it('should render a generic resource as a leaf node', () => {
            const resource = makeGenericResource();
            const key = AzureNodeId.from(resource).toString();
            const provider = createProvider([resource]);

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('site1');
            expect(item.description).to.equal('Microsoft.Web/sites');
            expect(item.contextValue).to.include(OpenInPortal.ContextValue);
            expect(item.contextValue).to.include(DeleteAzureResource.ResourceContextValue);
            expect(item.contextValue).to.not.include(BrowseWebsite.ContextValue);
        });

        it('should offer browsing once enrichment attaches a website url', () => {
            const resource = makeGenericResource();
            setWebsiteUrl(resource, 'site1.azurewebsites.net');
            const key = AzureNodeId.from(resource).toString();
            const provider = createProvider([resource]);

            const item = provider.getTreeItem(key);

            expect(item.contextValue).to.include(BrowseWebsite.ContextValue);
        });

        it('should render a virtual group node', () => {
            const provider = createProvider();
            const key = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/~resourceType/Microsoft.Web%2Fsites';

            const item = provider.getTreeItem(key);

            expect(item.label).to.equal('Microsoft.Web/sites');
            expect((item.iconPath as { id: string }).id).to.equal('symbol-namespace');
        });

        for (const [logicalType, label, iconPath] of [
            [AIFoundryProjectLogicalType, 'Microsoft Foundry Projects', 'microsoft.machinelearningservices/workspaces~project.svg'],
            [FoundryProjectResourceType, 'Microsoft Foundry Projects', 'microsoft.machinelearningservices/workspaces~project.svg'],
            [AIServicesLogicalType, 'AI Services', 'microsoft.cognitiveservices/accounts~aiservices.svg'],
            [AppServiceLogicalType, 'App Services', 'microsoft.web/sites~app.svg'],
            [ContainerAppResourceType, 'Container Apps', 'microsoft.app/containerapps.svg'],
            [ManagedEnvironmentResourceType, 'Container App Environments', 'microsoft.app/managedenvironments.svg'],
            [CosmosDBLogicalType, 'Azure Cosmos DB', 'microsoft.documentdb/databaseaccounts~cosmosdb.svg'],
            [CosmosDBMongoLogicalType, 'Azure Cosmos DB for MongoDB (RU)', 'microsoft.documentdb/databaseaccounts~mongodb.svg'],
            [DocumentDbResourceType, 'Azure DocumentDB', 'microsoft.documentdb/mongoclusters.svg'],
            [DurableTaskHubLogicalType, 'Durable Task Hubs', 'microsoft.durabletask/schedulers/taskhubs.svg'],
            [FunctionAppLogicalType, 'Function Apps', 'microsoft.web/sites~functionapp.svg'],
            [LogicAppLogicalType, 'Logic Apps', 'microsoft.web/sites~workflowapp.svg'],
            [AcrResourceType, 'Container Registries', 'microsoft.containerregistry/registries.svg'],
            [StaticWebAppResourceType, 'Static Web Apps', 'microsoft.web/staticsites.svg'],
            ['Microsoft.Storage/storageAccounts', 'Storage Accounts', 'microsoft.storage/storageaccounts.svg'],
            ['Microsoft.Compute/virtualMachines', 'Virtual Machines', 'microsoft.compute/virtualmachines.svg'],
        ]) {
            it(`should render the label and icon for ${logicalType} case-insensitively`, () => {
                const provider = createProvider();
                const key = `azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/~resourceType/${encodeURIComponent(logicalType.toUpperCase())}`;

                const item = provider.getTreeItem(key);

                expect(item.label).to.equal(label);
                expect((item.iconPath as { path: string }).path).to.include(iconPath);
                expect(item.contextValue).to.be.undefined;
            });
        }

        it('should throw for an unknown key not in cache', () => {
            const provider = createProvider();
            const key = 'azr://acc1@portal.azure.com/tenants/t1/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/unknown';

            expect(() => provider.getTreeItem(key)).to.throw('not found in cache');
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

        it('should return virtual group parent for resource when grouping by resourceType', async () => {
            const sub = makeSubscription();
            const rg = makeResourceGroup();
            const res = makeGenericResource();
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [sub, [rg]],
                [rg, [res]],
            ]);

            const provider = createProvider(
                [sub, rg, res],
                childrenMap,
            );

            await withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
                await provider.getChildren();

                const resKey = AzureNodeId.from(res).toString();
                const parentKey = provider.getParent(resKey);
                expect(parentKey).to.not.be.undefined;
                expect(AzureNodeId.parse(parentKey!).isVirtualGroupNodeId()).to.be.true;
            });
        });
    });

    describe('grouping strategies', () => {
        const sub = makeSubscription();
        const rg1 = makeResourceGroup({ name: 'rg1', id: '/subscriptions/test-sub/resourceGroups/rg1' });
        const rg2 = makeResourceGroup({ name: 'rg2', id: '/subscriptions/test-sub/resourceGroups/rg2' });

        const webApp = makeGenericResource({
            name: 'myWebApp',
            type: 'Microsoft.Web/sites',
            logicalType: 'Microsoft.Web/sites',
            location: 'eastus',
            id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myWebApp',
            tags: { env: 'prod', team: 'alpha' },
        });

        const storageAccount = makeGenericResource({
            name: 'myStorage',
            type: 'Microsoft.Storage/storageAccounts',
            logicalType: 'Microsoft.Storage/storageAccounts',
            location: 'westus',
            id: '/subscriptions/test-sub/resourceGroups/rg2/providers/Microsoft.Storage/storageAccounts/myStorage',
            tags: { env: 'dev' },
        });

        const untaggedResource = makeGenericResource({
            name: 'myFunc',
            type: 'Microsoft.Web/sites',
            logicalType: 'Microsoft.Web/sites',
            location: 'eastus',
            id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/myFunc',
        });

        function createGroupingProvider() {
            const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                [sub, [rg1, rg2]],
                [rg1, [webApp, untaggedResource]],
                [rg2, [storageAccount]],
            ]);

            return createProvider(
                [sub, rg1, rg2, webApp, storageAccount, untaggedResource],
                childrenMap,
            );
        }

        it('should group by resource type', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);
                expect(groups).to.have.length(2);

                // All should be virtual group nodes
                for (const key of groups) {
                    expect(AzureNodeId.parse(key).isVirtualGroupNodeId()).to.be.true;
                }

                // Check that expanding a group returns resources
                const groupChildren = await provider.getChildren(groups[0]);
                expect(groupChildren.length).to.be.greaterThan(0);
            }),
        );

        it('should sort resource types by their rendered labels', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
                const functionApp = makeGenericResource({
                    ...webApp,
                    logicalType: FunctionAppLogicalType,
                });
                const childrenMap = new Map<ConcreteAzureNode, ConcreteAzureNode[]>([
                    [sub, [rg1, rg2]],
                    [rg1, [functionApp]],
                    [rg2, [storageAccount]],
                ]);
                const provider = createProvider(
                    [sub, rg1, rg2, functionApp, storageAccount],
                    childrenMap,
                );

                const groups = await provider.getChildren(AzureNodeId.from(sub).toString());
                const groupValues = groups.map(key => AzureNodeId.parse(key).getGrouping()?.groupingValue);

                expect(groupValues).to.deep.equal([FunctionAppLogicalType, storageAccount.logicalType]);
            }),
        );

        it('should group by location', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'location' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);
                expect(groups).to.have.length(2); // eastus and westus

                for (const key of groups) {
                    expect(AzureNodeId.parse(key).isVirtualGroupNodeId()).to.be.true;
                }
            }),
        );

        it('should group by ARM tag', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'armTag', [`${ConfigurationSection}.groupByTag`]: 'env' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);
                expect(groups).to.have.length(3); // prod, dev, (No Tag)

                for (const key of groups) {
                    expect(AzureNodeId.parse(key).isVirtualGroupNodeId()).to.be.true;
                }
            }),
        );

        it('should put untagged resources in a no-tag bucket', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'armTag', [`${ConfigurationSection}.groupByTag`]: 'team' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);
                // webApp has team=alpha, storageAccount and untaggedResource do not
                expect(groups).to.have.length(2); // alpha, (No Tag)

                const labels = groups.map(key => {
                    const item = provider.getTreeItem(key);
                    return item.label;
                });
                expect(labels).to.include('alpha');
                expect(labels).to.include('(No Tag)');
            }),
        );

        it('should return resource keys when expanding a virtual group', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);

                // Find the Microsoft.Web/sites group (has 2 resources)
                let webGroupKey: string | undefined;
                for (const key of groups) {
                    if (AzureNodeId.parse(key).getGrouping()?.groupingValue === webApp.logicalType) {
                        webGroupKey = key;
                        break;
                    }
                }
                expect(webGroupKey).to.not.be.undefined;

                const resources = await provider.getChildren(webGroupKey);
                expect(resources).to.have.length(2);
            }),
        );

        it('should still return resource groups when groupBy is resourceGroup', () =>
            withSettings(mockCodeContext.mock, { [`${ConfigurationSection}.groupBy`]: 'resourceGroup' }, async () => {
                const provider = createGroupingProvider();
                const subKey = AzureNodeId.from(sub).toString();

                const groups = await provider.getChildren(subKey);
                expect(groups).to.have.length(2);

                for (const key of groups) {
                    expect(AzureNodeId.parse(key).isResourceGroupNodeId()).to.be.true;
                }
            }),
        );
    });

    describe('dispose', () => {
        it('should not throw when disposed', () => {
            const provider = createProvider();
            expect(() => { provider.dispose(); }).to.not.throw;
        });
    });

    describe('configuration change listener', () => {
        it('should fire onDidChange when groupBy setting changes', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            mockCodeContext.mock.configChangeEmitter.fire({
                affectsConfiguration: (s: string) => s === `${ConfigurationSection}.groupBy`,
            });

            expect(listener.mock.callCount()).to.equal(1);
        });

        it('should fire onDidChange when groupByTag setting changes', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            mockCodeContext.mock.configChangeEmitter.fire({
                affectsConfiguration: (s: string) => s === `${ConfigurationSection}.groupByTag`,
            });

            expect(listener.mock.callCount()).to.equal(1);
        });

        it('should fire onDidChange when alwaysShowAccountNodes setting changes', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            mockCodeContext.mock.configChangeEmitter.fire({
                affectsConfiguration: (s: string) => s === `${ConfigurationSection}.alwaysShowAccountNodes`,
            });

            expect(listener.mock.callCount()).to.equal(1);
        });

        it('should not fire onDidChange for unrelated settings', () => {
            const provider = createProvider();
            const listener = mock.fn();
            provider.onDidChange(listener);

            mockCodeContext.mock.configChangeEmitter.fire({
                affectsConfiguration: () => false,
            });

            expect(listener.mock.callCount()).to.equal(0);
        });
    });
});
