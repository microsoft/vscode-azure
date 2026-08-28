/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConcreteAzureNode, GenericResource } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { OpenContainerAppConsole, OpenContainerAppLogs } from '../../../../src/commands/containerApps/portalBlades';
import { RevealContainerAppEnvironment } from '../../../../src/commands/containerApps/RevealContainerAppEnvironment';
import { StartStreamingLogs } from '../../../../src/commands/containerApps/StartStreamingLogs';
import { ContainerAppResourceType, type ContainerApp } from '../../../../src/tree/resources/containerApps/ContainerApp';
import { ContainerVirtualType } from '../../../../src/tree/resources/containerApps/ContainerAppsDataProvider';
import { ContainerAppsViewProvider, shortenImageReference } from '../../../../src/tree/resources/containerApps/ContainerAppsViewProvider';
import { ManagedEnvironmentResourceType } from '../../../../src/tree/resources/containerApps/ManagedEnvironment';

const Collapsed = 1;
const None = 0;

function makeApp(overrides?: Partial<ContainerApp>): ContainerApp {
    return makeGenericResource<ContainerApp>({
        id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/MyApp',
        name: 'MyApp',
        type: ContainerAppResourceType,
        logicalType: ContainerAppResourceType,
        environmentId: undefined,
        provisioningState: 'Succeeded',
        latestRevisionName: 'myapp--abc123',
        containers: [],
        ...overrides,
    });
}

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
    it('claims apps, environments and container nodes', () => {
        const app = makeApp();
        const environment = makeEnvironment();
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, environment, container]);

        expect(provider.canHandle(AzureNodeId.from(app).toString())).to.be.true;
        expect(provider.canHandle(AzureNodeId.from(environment).toString())).to.be.true;
        expect(provider.canHandle(AzureNodeId.from(container).toString())).to.be.true;
        expect(provider.canHandle('not-a-node')).to.be.false;
    });

    it('renders an app as expandable and an environment as a leaf', () => {
        const app = makeApp();
        const environment = makeEnvironment();
        const provider = createProvider([app, environment]);

        expect(provider.getTreeItem(AzureNodeId.from(app).toString()).collapsibleState).to.equal(Collapsed);
        expect(provider.getTreeItem(AzureNodeId.from(environment).toString()).collapsibleState).to.equal(None);
    });

    it('offers the console and logs blades on an app but not on an environment', () => {
        const app = makeApp();
        const environment = makeEnvironment();
        const provider = createProvider([app, environment]);

        const appContext = provider.getTreeItem(AzureNodeId.from(app).toString()).contextValue ?? '';
        const envContext = provider.getTreeItem(AzureNodeId.from(environment).toString()).contextValue ?? '';

        expect(appContext).to.include(OpenContainerAppConsole.ContextValue);
        expect(appContext).to.include(OpenContainerAppLogs.ContextValue);
        expect(envContext).to.not.include(OpenContainerAppConsole.ContextValue);
    });

    it('offers to start a stream', () => {
        const app = makeApp();
        const provider = createProvider([app]);

        const context = provider.getTreeItem(AzureNodeId.from(app).toString()).contextValue ?? '';

        expect(context).to.include(StartStreamingLogs.ContextValue);
    });

    it('offers to reveal the environment only once one is known', () => {
        const unenriched = makeApp();
        const enriched = makeApp({
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
        const healthy = makeApp();
        const failed = makeApp({
            id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/Broken',
            name: 'Broken',
            provisioningState: 'Failed',
        });
        const provider = createProvider([healthy, failed]);

        expect(provider.getTreeItem(AzureNodeId.from(healthy).toString()).description).to.be.undefined;
        expect(provider.getTreeItem(AzureNodeId.from(failed).toString()).description).to.equal('Failed');
    });

    it('renders a container with its image as the description', () => {
        const app = makeApp({ containers: [{ name: 'api', image: 'myacr.azurecr.io/store/api:v3' }] });
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, container]);

        const item = provider.getTreeItem(AzureNodeId.from(container).toString());

        expect(item.label).to.equal('api');
        expect(item.collapsibleState).to.equal(None);
        expect(item.description).to.equal('store/api:v3');
    });

    it('leaves a container undescribed when the app has not been enriched', () => {
        const app = makeApp();
        const container = { virtualType: ContainerVirtualType, virtualPath: 'api', azureResource: app };
        const provider = createProvider([app, container]);

        expect(provider.getTreeItem(AzureNodeId.from(container).toString()).description).to.be.undefined;
    });

    it('returns container keys as an app\'s children', async () => {
        const app = makeApp({ containers: [{ name: 'api', image: 'api:1' }] });
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
