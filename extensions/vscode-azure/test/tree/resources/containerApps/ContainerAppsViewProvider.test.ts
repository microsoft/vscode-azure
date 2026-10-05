/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId, ContainerAppResourceType, ManagedEnvironmentResourceType } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor, MockTreeItemCollapsibleState } from '@microsoft/vscode-azure-utils/testing';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../../../../src/commands/containerApps/portalBlades';
import { RevealContainerAppEnvironment } from '../../../../src/commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../../../../src/commands/containerApps/StartStreamingLogs';
import { ContainerAppsDataProvider, ContainerVirtualType } from '../../../../src/tree/resources/containerApps/ContainerAppsDataProvider';
import { ContainerAppsViewProvider, shortenImageReference } from '../../../../src/tree/resources/containerApps/ContainerAppsViewProvider';

function makeEnvironment(): GenericResource {
    return makeGenericResource({
        id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv',
        name: 'MyEnv',
        type: ManagedEnvironmentResourceType,
        logicalType: ManagedEnvironmentResourceType,
    });
}

/** Builds a provider whose data tree serves the supplied nodes by key. */
function createProvider(
    nodes: readonly ConcreteAzureNode[],
    children: readonly ConcreteAzureNode[] = [],
) {
    const byKey = new Map(nodes.map(node => [AzureNodeId.from(node).toString(), node]));
    const tree = {
        get: (key: string) => byKey.get(key),
        getChildren: () => Promise.resolve(children),
    };
    const { executor } = createTestActionExecutor();
    return new ContainerAppsViewProvider(createMockCodeContext().ctx, executor, tree as never);
}

describe('ContainerAppsViewProvider (unit)', () => {
    it('renders mixed named and unnamed containers with distinct keys and their own images', async () => {
        const app = makeContainerApp({
            containers: [{ image: 'unnamed:1' }, { name: 'container-0', image: 'named:1' }, { image: 'another:1' }],
        });
        const { executor } = createTestActionExecutor();
        const data = new ContainerAppsDataProvider(executor, () => createMockContainerAppsClient());
        const children = data.getChildren(app);
        const provider = createProvider([app, ...children], children);
        const keys = await provider.getChildren(AzureNodeId.from(app).toString());

        expect(new Set(keys).size).to.equal(3);
        expect(keys.map(key => provider.getTreeItem(key).description)).to.deep.equal(['unnamed:1', 'named:1', 'another:1']);
        expect(provider.getTreeItem(keys[1]).label).to.equal('container-0');
        Object.assign(app, { containers: [{ image: 'unnamed:2' }, { name: 'container-0', image: 'named:2' }, { image: 'another:2' }] });
        expect(keys.map(key => provider.getTreeItem(key).description)).to.deep.equal(['unnamed:2', 'named:2', 'another:2']);
    });

    it('claims apps, environments and container nodes', () => {
        const app = makeContainerApp();
        const environment = makeEnvironment();
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, environment, container]);

        expect(provider.canHandle(AzureNodeId.from(app).toString())).to.be.true;
        expect(provider.canHandle(AzureNodeId.from(environment).toString())).to.be.true;
        expect(provider.canHandle(AzureNodeId.from(container).toString())).to.be.true;
        expect(provider.canHandle('not-a-node')).to.be.false;
    });

    it('renders an app as expandable and an environment as a leaf', () => {
        const app = makeContainerApp();
        const environment = makeEnvironment();
        const provider = createProvider([app, environment]);

        expect(provider.getTreeItem(AzureNodeId.from(app).toString()).collapsibleState).to.equal(MockTreeItemCollapsibleState.Collapsed);
        expect(provider.getTreeItem(AzureNodeId.from(environment).toString()).collapsibleState).to.equal(MockTreeItemCollapsibleState.None);
    });

    it('offers the console and logs blades on an app but not on an environment', () => {
        const app = makeContainerApp();
        const environment = makeEnvironment();
        const provider = createProvider([app, environment]);

        const appContext = provider.getTreeItem(AzureNodeId.from(app).toString()).contextValue ?? '';
        const envContext = provider.getTreeItem(AzureNodeId.from(environment).toString()).contextValue ?? '';

        expect(appContext).to.include(OpenContainerAppConsole.ContextValue);
        expect(appContext).to.include(OpenContainerAppLogs.ContextValue);
        expect(envContext).to.not.include(OpenContainerAppConsole.ContextValue);
    });

    it('offers to start a stream', () => {
        const app = makeContainerApp();
        const provider = createProvider([app]);

        const context = provider.getTreeItem(AzureNodeId.from(app).toString()).contextValue ?? '';

        expect(context).to.include(StartStreamingLogs.ContextValue);
    });

    it('offers to reveal the environment only once one is known', () => {
        const unenriched = makeContainerApp();
        const enriched = makeContainerApp({
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/Hosted',
            name: 'Hosted',
            environmentId: '/subscriptions/sub/resourceGroups/MyRG/providers/Microsoft.App/managedEnvironments/MyEnv',
        });
        const provider = createProvider([unenriched, enriched]);

        expect(provider.getTreeItem(AzureNodeId.from(unenriched).toString()).contextValue ?? '')
            .to.not.include(RevealContainerAppEnvironment.ContextValue);
        expect(provider.getTreeItem(AzureNodeId.from(enriched).toString()).contextValue ?? '')
            .to.include(RevealContainerAppEnvironment.ContextValue);
    });

    it('describes an app only when it is not in a successful state', () => {
        const healthy = makeContainerApp();
        const failed = makeContainerApp({
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/Broken',
            name: 'Broken',
            provisioningState: 'Failed',
        });
        const provider = createProvider([healthy, failed]);

        expect(provider.getTreeItem(AzureNodeId.from(healthy).toString()).description).to.be.undefined;
        expect(provider.getTreeItem(AzureNodeId.from(failed).toString()).description).to.equal('Failed');
    });

    it('renders a container with its image as the description', () => {
        const app = makeContainerApp({ containers: [{ name: 'api', image: 'myacr.azurecr.io/store/api:v3' }] });
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, container]);

        const item = provider.getTreeItem(AzureNodeId.from(container).toString());

        expect(item.label).to.equal('api');
        expect(item.collapsibleState).to.equal(MockTreeItemCollapsibleState.None);
        expect(item.description).to.equal('store/api:v3');
    });

    it('leaves a container undescribed when the app has not been enriched', () => {
        const app = makeGenericResource({ type: ContainerAppResourceType, logicalType: ContainerAppResourceType });
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, container]);

        expect(provider.getTreeItem(AzureNodeId.from(container).toString()).description).to.be.undefined;
    });

    it('returns container keys as an app\'s children', async () => {
        const app = makeContainerApp({ containers: [{ name: 'api', image: 'api:1' }] });
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, container], [container]);

        expect(await provider.getChildren(AzureNodeId.from(app).toString()))
            .to.deep.equal([AzureNodeId.from(container).toString()]);
    });
});

describe('shortenImageReference (unit)', () => {
    it('drops a registry host', () => {
        expect(shortenImageReference('myacr.azurecr.io/store/api:v3')).to.equal('store/api:v3');
        expect(shortenImageReference('localhost:5000/api:v3')).to.equal('api:v3');
        expect(shortenImageReference('localhost/api:v3')).to.equal('api:v3');
    });

    it('keeps a leading path segment that is not a registry host', () => {
        // `library` is a Docker Hub namespace, not a host, so dropping it would
        // change which image the description names.
        expect(shortenImageReference('library/nginx:latest')).to.equal('library/nginx:latest');
    });

    it('passes through a reference with no path separator', () => {
        expect(shortenImageReference('nginx:latest')).to.equal('nginx:latest');
    });
});
