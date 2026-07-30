/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IResourceClient, IResourceClientProvider } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockAccountDataProvider, makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { DataItemTree, Everything, ViewItemTree, type ViewItemTreeOptions } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, createTestActionExecutor, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import { ConfigurationSection } from '../../../src/constants';
import { AzureResourceDataProvider } from '../../../src/tree/resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from '../../../src/tree/resources/GenericAzureViewProvider';
import { singlePage } from './mockResourceClient';

/**
 * Integration tests for the subscription-wide resource load.
 *
 * The optimisation in {@linkcode AzureResourceDataProvider} rests on a property
 * of the layers above it: when grouping by anything other than resource group,
 * the view walks every resource group, and any refresh re-lists a subscription's
 * resource groups before asking for a group's children. Unit tests can only
 * restate that property by calling the provider in the required order, so these
 * tests drive the real `DataItemTree` / `ViewItemTree` stack instead and assert
 * on the ARM calls that actually result.
 */
describe('Bulk resource load (integration)', () => {
    afterEach(() => { mock.restoreAll(); });

    const account = makeAccount();
    const tenant = makeTenant({ accountId: account.id });
    const subscription = makeSubscription({ accountId: tenant.accountId, tenantId: tenant.tenantId, environment: tenant.environment });

    const rgOne = makeResourceGroup({ id: '/subscriptions/test-sub/resourceGroups/rg1', name: 'rg1', groupingValue: 'rg1', subscription });
    const rgTwo = makeResourceGroup({ id: '/subscriptions/test-sub/resourceGroups/rg2', name: 'rg2', groupingValue: 'rg2', subscription });
    /** Has no resources at all -- the subscription-wide listing will not mention it. */
    const rgEmpty = makeResourceGroup({ id: '/subscriptions/test-sub/resourceGroups/rg3', name: 'rg3', groupingValue: 'rg3', subscription });

    const site = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.Web/sites/site1', name: 'site1', subscription });
    const storage = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg2/providers/Microsoft.Storage/storageAccounts/sa1', name: 'sa1', type: 'Microsoft.Storage/storageAccounts', logicalType: 'Microsoft.Storage/storageAccounts', subscription });
    const otherSite = makeGenericResource({ id: '/subscriptions/test-sub/resourceGroups/rg2/providers/Microsoft.Web/sites/site2', name: 'site2', subscription });

    function createPipeline() {
        const { executor } = createTestActionExecutor();
        // One mock drives both layers: the view provider reads `groupBy` through
        // `ctx.code`, and the data provider reads it through the same `IVsCode`.
        const mockCtx = createMockCodeContext();
        const code = mockCtx.ctx.code;

        const listAll = mock.fn(() => singlePage([site, storage, otherSite]));
        const listByResourceGroup = mock.fn((rgName: string) => singlePage(
            [site, storage, otherSite].filter(r => r.id.toLowerCase().includes(`/resourcegroups/${rgName.toLowerCase()}/`)),
        ));
        const resourceClient = {
            resourceGroups: { list: () => singlePage([rgOne, rgTwo, rgEmpty]) },
            resources: { list: listAll, listByResourceGroup },
        } as unknown as IResourceClient;
        const resourceClientProvider: IResourceClientProvider = () => resourceClient;

        const dataTree = new DataItemTree<ConcreteAzureNode>(
            code,
            'test-bulk-tree',
            executor,
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000,
        );

        const resourceProvider = new AzureResourceDataProvider(code, executor, resourceClientProvider);
        dataTree.registerProvider(resourceProvider);
        dataTree.registerProvider(createMockAccountDataProvider({
            accounts: [account],
            tenants: [tenant],
            subscriptions: [subscription],
        }));

        const viewOptions: ViewItemTreeOptions<string, ConcreteAzureNode> = {
            dataItemTree: dataTree,
            toViewItem: resource => AzureNodeId.from(resource).toString(),
            getKey: key => key,
            getResourceKey: key => key,
        };
        const viewTree = new ViewItemTree<string, ConcreteAzureNode>('test-bulk-tree', executor, viewOptions, undefined);
        viewTree.registerProvider(new GenericAzureViewProvider(mockCtx.ctx, executor, dataTree, resourceProvider));

        return { dataTree, viewTree, mock: mockCtx.mock, listAll, listByResourceGroup, resourceProvider };
    }

    /** Render the subscription's children, which is where grouping happens. */
    async function renderGroups(viewTree: ViewItemTree<string, ConcreteAzureNode>): Promise<string[]> {
        const roots = await viewTree.getChildren();
        return viewTree.getChildren(roots[0]);
    }

    it('should render resource-type groups from a single subscription-wide call', async () => {
        const { viewTree, mock: settingsMock, listAll, listByResourceGroup } = createPipeline();

        const groups = await withSettings(settingsMock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, () => renderGroups(viewTree));

        expect(listAll.mock.callCount()).to.equal(1);
        expect(listByResourceGroup.mock.callCount()).to.equal(0);

        // Three resources across two resource groups collapse into two type groups.
        expect(groups).to.have.length(2);
        expect(groups.some(g => g.includes('Microsoft.Web%2Fsites'))).to.be.true;
        expect(groups.some(g => g.includes('Microsoft.Storage%2FstorageAccounts'))).to.be.true;
    });

    it('should place every resource in its group, including across resource groups', async () => {
        const { viewTree, mock: settingsMock } = createPipeline();

        await withSettings(settingsMock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
            const groups = await renderGroups(viewTree);
            const siteGroup = groups.find(g => g.includes('Microsoft.Web%2Fsites'));
            expect(siteGroup).to.not.be.undefined;

            // site1 lives in rg1 and site2 in rg2, so this only holds if the
            // bulk load was bucketed back into both groups correctly.
            const sites = await viewTree.getChildren(siteGroup);
            expect(sites).to.have.length(2);
        });
    });

    it('should re-run the bulk load after the tree is invalidated', async () => {
        const { dataTree, viewTree, mock: settingsMock, listAll } = createPipeline();

        await withSettings(settingsMock, { [`${ConfigurationSection}.groupBy`]: 'resourceType' }, async () => {
            await renderGroups(viewTree);
            expect(listAll.mock.callCount()).to.equal(1);

            // What the Refresh command does. The provider only drops its
            // coalesced load when the subscription's resource groups are listed
            // again, so this asserts the tree really does re-list them first.
            dataTree.invalidate(Everything);
            await renderGroups(viewTree);
        });

        expect(listAll.mock.callCount()).to.equal(2);
    });

    it('should list per resource group when grouping by resource group', async () => {
        const { viewTree, mock: settingsMock, listAll } = createPipeline();

        const groups = await withSettings(settingsMock, { [`${ConfigurationSection}.groupBy`]: 'resourceGroup' }, () => renderGroups(viewTree));

        // Resource groups render without loading any resources at all, and the
        // empty resource group is still shown.
        expect(listAll.mock.callCount()).to.equal(0);
        expect(groups).to.have.length(3);
    });
});
