/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, createMockDataItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type { IAzureViewViewItemTree } from '../../../src/services';
import { RestartContainerApp } from '../../../src/commands/containerApps/RestartContainerApp';
import { ContainerAppResourceType, type ContainerApp } from '../../../src/tree/resources/containerApps/ContainerApp';
import { ResourceSelector } from '../../../src/tree/resources/ResourceSelector';

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

function createCommand(app: ContainerApp) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const cache = createMockDataItemTree([app]);
    const selector = new ResourceSelector(ctx, new MockOutputChannel('test'), cache, undefined as unknown as IAzureViewViewItemTree);
    const client = createMockContainerAppsClient();

    const command = new RestartContainerApp(
        mockResult.vscode,
        selector,
        () => client,
        cache,
    );

    return { command, client, cache, mockResult, key: AzureNodeId.from(app).toString() };
}

describe('RestartContainerApp (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('restarts the app\'s latest revision', async () => {
        const { command, client, key } = createCommand(makeApp());

        await command.execute(key);

        expect(client.containerAppsRevisions.restartRevision.mock.callCount()).to.equal(1);
        expect(client.containerAppsRevisions.restartRevision.mock.calls[0].arguments)
            .to.deep.equal(['MyRG', 'MyApp', 'myapp--abc123']);
    });

    it('re-renders the node without dropping its children', async () => {
        const { command, cache, key } = createCommand(makeApp());
        const invalidate = mock.method(cache, 'invalidate', () => { /* noop */ });

        await command.execute(key);

        // Restarting replaces the running replicas, not the app's template, so
        // evicting the container children would be a pointless refetch.
        expect(invalidate.mock.callCount()).to.equal(1);
        const target = invalidate.mock.calls[0].arguments[0] as unknown as { scope?: string };
        expect(target.scope).to.equal('self');
    });

    it('explains that an app with no revision cannot be restarted', async () => {
        // An app that has never deployed has nothing to restart; calling ARM
        // with an empty revision name would fail deep inside the SDK instead.
        const { command, client, key } = createCommand(makeApp({ latestRevisionName: undefined }));

        await expect(command.execute(key)).to.be.rejectedWith(/no revision to restart/i);
        expect(client.containerAppsRevisions.restartRevision.mock.callCount()).to.equal(0);
    });
});
