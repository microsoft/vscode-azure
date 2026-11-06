/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { ControlEmulator } from '../../../src/commands/emulators/ControlEmulator';
import { AzuriteEmulator, AzuriteExtensionId } from '../../../src/emulators/AzuriteEmulator';
import type { LocalFunctionsHostProcess } from '../../../src/functions/host/LocalFunctionsHostProcess';
import type { IWorkspaceViewDataTree } from '../../../src/services';
import { EmulatorsGroupId, type EmulatorNode } from '../../../src/tree/workspace/WorkspaceNode';
import { makeEmulatorNode } from '../../tree/workspace/mockWorkspaceNode';

describe('ControlEmulator (unit)', () => {
    afterEach(() => { mock.restoreAll(); });

    function setup(node: EmulatorNode) {
        const m = createMockVsCode();
        const tree = { get: (key: string) => key === node.id ? node : undefined, invalidate: mock.fn<IWorkspaceViewDataTree['invalidate']>() };
        const azurite = new AzuriteEmulator(m.vscode);
        const control = mock.method(azurite, 'control', () => Promise.resolve());
        const hosts = { stopProject: mock.fn<LocalFunctionsHostProcess['stopProject']>(() => Promise.resolve()) };
        const cmd = new ControlEmulator(m.vscode, tree, azurite, hosts);
        return { m, tree, control, hosts, cmd };
    }

    it('delegates Storage lifecycle to Azurite and refreshes the group', async () => {
        const node = makeEmulatorNode();
        const s = setup(node);
        await s.cmd.execute('start', node.id);
        await s.cmd.execute('stop', node.id);
        expect(s.control.mock.calls.map(call => call.arguments[0])).to.deep.equal(['start', 'stop']);
        expect(s.tree.invalidate.mock.calls.map(call => call.arguments)).to.deep.equal([[EmulatorsGroupId], [EmulatorsGroupId]]);
    });

    it('opens the owning extension detail without installing software automatically', async () => {
        const node = makeEmulatorNode({ state: 'notInstalled' });
        const s = setup(node);
        await s.cmd.execute('install', node.id);
        expect(s.m.commands.executeCommand.mock.calls[0].arguments).to.deep.equal(['extension.open', AzuriteExtensionId]);
    });

    it('starts the selected Functions project through its debugger and stops only that project', async () => {
        const project = MockUri.file('/repo/api');
        const node = makeEmulatorNode({ emulatorKind: 'functions', resourceUri: project });
        const s = setup(node);
        await s.cmd.execute('start', node.id);
        expect(s.m.debug.startDebugging.mock.calls[0].arguments[1]).to.include({ projectPath: project.fsPath, type: 'azure-functions' });
        await s.cmd.execute('stop', node.id);
        expect(s.hosts.stopProject.mock.calls[0].arguments).to.deep.equal([project]);
    });

    it('reports a rejected Functions launch and refreshes its state for retry', async () => {
        const node = makeEmulatorNode({ emulatorKind: 'functions', resourceUri: MockUri.file('/repo') });
        const s = setup(node);
        s.m.debug.startDebugging.mock.mockImplementation(() => Promise.resolve(false));
        await expect(s.cmd.execute('start', node.id)).to.be.rejectedWith('Could not start the Functions host');
        expect(s.tree.invalidate.mock.callCount()).to.equal(1);
        await expect(s.cmd.execute('start', 'missing')).to.be.rejectedWith('Refresh the workspace view');
    });
});
