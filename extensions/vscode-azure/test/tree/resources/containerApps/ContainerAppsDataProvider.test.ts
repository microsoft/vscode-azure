/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, ContainerAppResourceType, ManagedEnvironmentResourceType, type ConcreteAzureNode, type ContainerApp } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { DataItemTree } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { ContainerAppsDataProvider, isContainerNode } from '../../../../src/tree/resources/containerApps/ContainerAppsDataProvider';
import { getWebsiteUrl } from '../../../../src/tree/resources/websiteUrl';

describe('ContainerAppsDataProvider (unit)', () => {
    const { executor } = createTestActionExecutor();

    it('claims container apps and managed environments', () => {
        const provider = new ContainerAppsDataProvider(executor, () => createMockContainerAppsClient());

        expect(provider.canHandle(makeContainerApp())).to.be.true;
        expect(provider.canHandle(makeContainerApp({ logicalType: ManagedEnvironmentResourceType }))).to.be.true;
        expect(provider.canHandle(makeContainerApp({ logicalType: 'Microsoft.Storage/storageAccounts' }))).to.be.false;
    });

    it('enriches an app with its environment, state, revision and website URL', async () => {
        const client = createMockContainerAppsClient({
            fqdn: 'myapp.happyrock.eastus.azurecontainerapps.io',
            environmentId: '/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv',
            latestRevisionName: 'myapp--abc123',
            containers: [{ name: 'main', image: 'myacr.azurecr.io/api:v3' }],
        });
        const provider = new ContainerAppsDataProvider(executor, () => client);
        const resource = makeContainerApp();

        await provider.enrich(resource);

        const app = resource;
        expect(app.environmentId).to.equal('/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv');
        expect(app.latestRevisionName).to.equal('myapp--abc123');
        expect(app.containers).to.have.lengthOf(1);
        expect(getWebsiteUrl(resource)).to.equal('https://myapp.happyrock.eastus.azurecontainerapps.io');
        expect(client.containerApps.get.mock.calls[0].arguments).to.deep.equal(['rg1', 'app1']);
    });

    it('prefers environmentId over the deprecated managedEnvironmentId', async () => {
        const client = createMockContainerAppsClient();
        // The SDK still returns the deprecated alias; reading it would silently
        // pin the tree to a field Azure has said it will stop populating.
        client.containerApps.get.mock.mockImplementation(() => Promise.resolve({
            id: '/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/containerApps/MyApp',
            name: 'MyApp',
            type: ContainerAppResourceType,
            location: 'eastus',
            environmentId: '/environments/current',
            managedEnvironmentId: '/environments/deprecated',
        }));
        const provider = new ContainerAppsDataProvider(executor, () => client);
        const resource = makeContainerApp();

        await provider.enrich(resource);

        expect(resource.environmentId).to.equal('/environments/current');
    });

    it('leaves managed environments unenriched', async () => {
        const client = createMockContainerAppsClient();
        const provider = new ContainerAppsDataProvider(executor, () => client);

        await provider.enrich(makeContainerApp({ logicalType: ManagedEnvironmentResourceType }));

        expect(client.containerApps.get.mock.callCount()).to.equal(0);
    });

    it('hangs containers directly off the app, with no grouping node', async () => {
        const client = createMockContainerAppsClient({
            containers: [{ name: 'api', image: 'api:1' }, { name: 'sidecar', image: 'sidecar:1' }],
        });
        const provider = new ContainerAppsDataProvider(executor, () => client);
        const resource = makeContainerApp();
        await provider.enrich(resource);

        const children = provider.getChildren(resource);

        expect(children).to.have.lengthOf(2);
        expect(children.every(isContainerNode)).to.be.true;
        expect(children.map(child => isContainerNode(child) && child.virtualPath)).to.deep.equal(['api', 'sidecar']);
    });

    it('keeps unnamed containers distinguishable', async () => {
        const client = createMockContainerAppsClient({ containers: [{ image: 'a:1' }, { image: 'b:1' }] });
        const provider = new ContainerAppsDataProvider(executor, () => client);
        const resource = makeContainerApp();
        await provider.enrich(resource);

        const paths = provider.getChildren(resource).map(child => isContainerNode(child) && child.virtualPath);

        expect(new Set(paths).size).to.equal(2);
    });

    it('refreshes an early expansion when background enrichment supplies containers', async () => {
        const app = makeGenericResource({ type: ContainerAppResourceType, logicalType: ContainerAppResourceType });
        const client = createMockContainerAppsClient();
        const details = Promise.withResolvers<ContainerApp>();
        client.containerApps.get.mock.mockImplementation(() => details.promise);
        const provider = new ContainerAppsDataProvider(executor, () => client);
        const tree = new DataItemTree<ConcreteAzureNode>(
            createMockVsCode().vscode, 'container-apps', executor,
            resource => AzureNodeId.from(resource).toString(), 60_000,
        );
        tree.registerProvider(provider);
        tree.registerProvider({
            isRoot: true,
            canHandle: (resource): resource is ConcreteAzureNode => resource === undefined,
            getChildren: () => [app],
        });

        try {
            expect(await tree.getChildren()).to.deep.equal([app]);
            expect(await tree.getChildren(app)).to.be.empty;
            details.resolve({
                id: app.id, name: app.name, type: app.type, location: 'eastus',
                template: { containers: [{ name: 'api', image: 'api:1' }] },
            });
            await tree.whenEnriched(app);

            const children = await tree.getChildren(app);
            expect(children.map(child => isContainerNode(child) && child.virtualPath)).to.deep.equal(['api']);
        } finally {
            tree.dispose();
        }
    });

    it('returns no children for a managed environment', () => {
        const provider = new ContainerAppsDataProvider(executor, () => createMockContainerAppsClient());

        expect(provider.getChildren(makeContainerApp({ logicalType: ManagedEnvironmentResourceType }))).to.be.empty;
    });
});
