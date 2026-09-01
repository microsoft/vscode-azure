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
import type { LogStreamTarget } from '../../../src/tree/resources/containerApps/ContainerAppLogStream';
import { createTestResourceSelector } from '../../tree/resources/testResourceSelector';

function createCommand(revisions: Partial<Revision>[], replicas: Partial<Replica>[]) {
    const app = makeContainerApp();
    const { selector, ctx, codeContext } = createTestResourceSelector({ nodes: [app] });
    const mockResult = codeContext.mock;

    const client = createMockContainerAppsClient({
        revisions: revisions as Revision[],
        replicas,
    });

    const start = mock.fn((_target: LogStreamTarget) => Promise.resolve());

    const command = new StartStreamingLogs(
        mockResult.vscode,
        ctx,
        selector,
        () => client,
        { start } as never,
    );

    return { command, start, mockResult, key: AzureNodeId.from(app).toString() };
}

const oneContainer = [{ name: 'replica1', containers: [{ name: 'api' }] }];

describe('StartStreamingLogs (unit)', () => {
    it('opens the stream with no prompts when there is one of everything', async () => {
        // The common case is a single-revision, single-replica app. Asking three
        // questions with one answer each would be pure friction.
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'rev1', active: true }],
            oneContainer,
        );

        await command.execute(key);

        expect(mockResult.quickPicks).to.have.length(0);
        expect(start.mock.callCount()).to.equal(1);
        expect(start.mock.calls[0].arguments[0]).to.include({
            revisionName: 'rev1',
            replicaName: 'replica1',
            containerName: 'api',
        });
    });

    it('asks which revision when several are active', async () => {
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'rev1', active: true }, { name: 'rev2', active: true }],
            oneContainer,
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'rev2' }]);

        await command.execute(key);

        expect(start.mock.calls[0].arguments[0].revisionName).to.equal('rev2');
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
        expect(start.mock.calls[0].arguments[0].revisionName).to.equal('current');
    });

    it('asks which container when a replica runs several', async () => {
        const { command, start, mockResult, key } = createCommand(
            [{ name: 'rev1', active: true }],
            [{ name: 'replica1', containers: [{ name: 'api' }, { name: 'sidecar' }] }],
        );
        const tracker = respondToPrompts(mockResult, [{ pick: 'sidecar' }]);

        await command.execute(key);

        expect(start.mock.calls[0].arguments[0].containerName).to.equal('sidecar');
        tracker.assertAllConsumed();
    });

    it('explains an app with no active revisions', async () => {
        const { command, start, key } = createCommand([{ name: 'old', active: false }], oneContainer);

        await expect(command.execute(key)).to.be.rejectedWith(/no active revisions/i);
        expect(start.mock.callCount()).to.equal(0);
    });

    it('explains a revision that is scaled to zero', async () => {
        // No replicas is ordinary for an idle app, not a fault in the request.
        const { command, start, key } = createCommand([{ name: 'rev1', active: true }], []);

        await expect(command.execute(key)).to.be.rejectedWith(/scaled to zero/i);
        expect(start.mock.callCount()).to.equal(0);
    });
});
