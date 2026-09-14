/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Replica, Revision } from '@microsoft/vscode-azure-azutils';
import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import { createMockContainerAppsClient, makeContainerApp } from '@microsoft/vscode-azure-azutils/testing';
import { respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { StartStreamingLogs } from '../../../src/commands/containerApps/StartStreamingLogs';
import type { ContainerAppLogStreamTarget } from '../../../src/tree/resources/containerApps/ContainerAppLogStream';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

function createCommand(revisions: Partial<Revision>[], replicas: Partial<Replica>[]) {
    const app = makeContainerApp();
    const { selector, ctx, codeContext } = createTestResourceSelector({ nodes: [app] });
    const mockResult = codeContext.mock;

    const client = createMockContainerAppsClient({
        revisions: revisions as Revision[],
        replicas,
    });

    const start = mock.fn((_target: ContainerAppLogStreamTarget) => Promise.resolve());
    const createClient = mock.fn(() => client);

    const command = new StartStreamingLogs(
        ctx,
        selector,
        createClient,
        { start } as never,
    );

    return { command, start, mockResult, client, createClient, app, key: AzureNodeId.from(app).toString() };
}

const logStreamEndpoint = 'https://app.region.azurecontainerapps.io/logstream';
const oneContainer = [{ name: 'replica1', containers: [{ name: 'api', logStreamEndpoint }] }];

describe('StartStreamingLogs (unit)', () => {
    it('opens the stream with no prompts when there is one of everything', async () => {
        // The common case is a single-revision, single-replica app. Asking three
        // questions with one answer each would be pure friction.
        const { command, start, mockResult, createClient, key } = createCommand(
            [{ name: 'rev1', active: true }],
            oneContainer,
        );

        await command.execute(key);

        expect(mockResult.quickPicks).to.have.length(0);
        expect(createClient.mock.callCount()).to.equal(1);
        expect(start.mock.callCount()).to.equal(1);
        expect(start.mock.calls[0].arguments[0]).to.include({
            revisionName: 'rev1',
            replicaName: 'replica1',
            containerName: 'api',
            logStreamEndpoint,
        });
    });

    it('asks which revision when several are active', async () => {
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'rev1', active: true }, { name: 'rev2', active: true }],
            oneContainer,
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'rev2' }]);

        await command.execute(key);

        expect(start.mock.calls[0].arguments[0]).to.include({ revisionName: 'rev2' });
        tracker.assertAllConsumed();
    });

    it('ignores inactive revisions', async () => {
        // An inactive revision runs nothing, so it has no logs to stream.
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'old', active: false }, { name: 'current', active: true }],
            oneContainer,
        );

        await command.execute(key);

        expect(mockResult.quickPicks).to.have.length(0);
        expect(start.mock.calls[0].arguments[0]).to.include({ revisionName: 'current' });
    });

    it('asks which container when a replica runs several', async () => {
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'rev1', active: true }],
            [{ name: 'replica1', containers: [{ name: 'api', logStreamEndpoint }, { name: 'sidecar', logStreamEndpoint: `${logStreamEndpoint}/sidecar` }] }],
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'sidecar' }]);

        await command.execute(key);

        expect(start.mock.calls[0].arguments[0]).to.include({ containerName: 'sidecar', logStreamEndpoint: `${logStreamEndpoint}/sidecar` });
        tracker.assertAllConsumed();
    });

    it('explains an app with no active revisions', async () => {
        const { command, start, key } = createCommand([{ name: 'old', active: false }], oneContainer);

        await expect(command.execute(key)).to.be.rejectedWith(/no active revisions/i);
        expect(start.mock.callCount()).to.equal(0);
    });

    it('selects a replica and forwards its endpoint from a single replica lookup', async () => {
        const { command, start, mockResult, client, key } = createCommand(
            [{ name: 'rev1', active: true }],
            [
                ...oneContainer,
                { name: 'replica2', containers: [{ name: 'api', logStreamEndpoint: `${logStreamEndpoint}/replica2` }] },
            ],
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'replica2' }]);

        await command.execute(key);

        expect(start.mock.calls[0].arguments[0]).to.include({
            replicaName: 'replica2', logStreamEndpoint: `${logStreamEndpoint}/replica2`,
        });
        expect(client.containerAppsRevisionReplicas.listReplicas.mock.callCount()).to.equal(1);
        tracker.assertAllConsumed();
    });

    it('reports a selected container with no log endpoint', async () => {
        const { command, start, key } = createCommand(
            [{ name: 'rev1', active: true }],
            [{ name: 'replica1', containers: [{ name: 'api' }] }],
        );

        await expect(command.execute(key)).to.be.rejectedWith(/No log stream is available/i);
        expect(start.mock.callCount()).to.equal(0);
    });

    it('reports a replica without named containers', async () => {
        const { command, start, key } = createCommand(
            [{ name: 'rev1', active: true }], [{ name: 'replica1', containers: [] }],
        );

        await expect(command.execute(key)).to.be.rejectedWith(/reports no containers/i);
        expect(start.mock.callCount()).to.equal(0);
    });

    it('explains a revision that is scaled to zero', async () => {
        // No replicas is ordinary for an idle app, not a fault in the request.
        const { command, start, key } = createCommand([{ name: 'rev1', active: true }], []);

        await expect(command.execute(key)).to.be.rejectedWith(/scaled to zero/i);
        expect(start.mock.callCount()).to.equal(0);
    });

    it('selects a revision for an explicit app when verification could not capture one', async () => {
        const { command, start, app } = createCommand([{ name: 'current', active: true }], oneContainer);
        await command.execute({ kind: 'console', app });
        expect(start.mock.calls[0].arguments[0]).to.include({ app, revisionName: 'current' });
    });

    it('reports unavailable replicas of the captured revision rather than switching to a healthy revision', async () => {
        const { command, client, start, app } = createCommand([{ name: 'healthy', active: true }], []);
        await expect(command.execute({ kind: 'console', app, revisionName: 'failed' })).to.be.rejectedWith('no running replicas');
        expect(client.containerAppsRevisionReplicas.listReplicas.mock.calls[0].arguments[2]).to.equal('failed');
        expect(client.containerAppsRevisions.listRevisions.mock.callCount()).to.equal(0);
        expect(start.mock.callCount()).to.equal(0);
    });
});
