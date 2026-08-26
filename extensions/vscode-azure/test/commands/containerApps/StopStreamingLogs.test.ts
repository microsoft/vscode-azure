/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockDataItemTree, makeGenericResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { StopStreamingLogs } from '../../../src/commands/containerApps/StopStreamingLogs';
import { ContainerAppResourceType, type ContainerApp } from '../../../src/tree/resources/containerApps/ContainerApp';
import type { ActiveLogStream } from '../../../src/tree/resources/containerApps/ContainerAppLogStream';

function makeApp(name: string): ContainerApp {
    return makeGenericResource<ContainerApp>({
        id: `/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/MyRG/providers/Microsoft.App/containerApps/${name}`,
        name,
        type: ContainerAppResourceType,
        logicalType: ContainerAppResourceType,
        environmentId: undefined,
        provisioningState: 'Succeeded',
        latestRevisionName: undefined,
        containers: [],
    });
}

function createCommand(apps: ContainerApp[], streams: ActiveLogStream[]) {
    const { ctx, mock: mockResult } = createMockCodeContext();
    const cache = createMockDataItemTree(apps);
    const stop = mock.fn((_id: string) => { /* noop */ });

    const command = new StopStreamingLogs(
        mockResult.vscode,
        ctx,
        cache,
        { getActiveStreams: () => streams, stop } as never,
    );

    return { command, stop, mockResult };
}

const appA = makeApp('AppA');
const appB = makeApp('AppB');

const streamA1: ActiveLogStream = { id: 'a1', label: 'replica1 (api)', appId: appA.id };
const streamA2: ActiveLogStream = { id: 'a2', label: 'replica2 (api)', appId: appA.id };
const streamB1: ActiveLogStream = { id: 'b1', label: 'replica1 (web)', appId: appB.id };

describe('StopStreamingLogs (unit)', () => {
    it('stops the only stream without asking', async () => {
        const { command, stop, mockResult } = createCommand([appA], [streamA1]);

        await command.execute(AzureNodeId.from(appA).toString());

        expect(mockResult.quickPicks).to.have.length(0);
        expect(stop.mock.calls[0].arguments[0]).to.equal('a1');
    });

    it('offers only the invoking app\'s streams when run from its node', async () => {
        // Stopping another app's stream because it happened to be open would be
        // a surprising side effect of clicking on this one.
        const { command, mockResult } = createCommand([appA, appB], [streamA1, streamA2, streamB1]);
        const tracker = respondToPrompts(mockResult, [{ pick: 'replica2 (api)' }]);

        await command.execute(AzureNodeId.from(appA).toString());

        expect(mockResult.quickPicks[0].items.map(item => item.label))
            .to.deep.equal(['Stop All', 'replica1 (api)', 'replica2 (api)']);
        tracker.assertAllConsumed();
    });

    it('offers every stream when run from the palette', async () => {
        const { command, mockResult } = createCommand([appA, appB], [streamA1, streamB1]);
        const tracker = respondToPrompts(mockResult, [{ pick: 'replica1 (web)' }]);

        await command.execute();

        expect(mockResult.quickPicks[0].items.map(item => item.label))
            .to.deep.equal(['Stop All', 'replica1 (api)', 'replica1 (web)']);
        tracker.assertAllConsumed();
    });

    it('stops every candidate when Stop All is chosen', async () => {
        const { command, stop, mockResult } = createCommand([appA], [streamA1, streamA2]);
        respondToPrompts(mockResult, [{ pick: 'Stop All' }]);

        await command.execute(AzureNodeId.from(appA).toString());

        expect(stop.mock.callCount()).to.equal(2);
        expect(stop.mock.calls.map(call => call.arguments[0])).to.deep.equal(['a1', 'a2']);
    });

    it('reports when there is nothing to stop', async () => {
        const { command, stop } = createCommand([appA], []);

        await expect(command.execute(AzureNodeId.from(appA).toString()))
            .to.be.rejectedWith(/no log streams to stop/i);
        expect(stop.mock.callCount()).to.equal(0);
    });
});
