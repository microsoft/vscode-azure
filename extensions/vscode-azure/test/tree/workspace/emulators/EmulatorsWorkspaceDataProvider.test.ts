/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { AzuriteEmulator } from '../../../../src/emulators/AzuriteEmulator';
import { createLocalFunctions } from '../functions/mockLocalFunctions';
import {
    EmulatorsWorkspaceDataProvider,
} from '../../../../src/tree/workspace/emulators/EmulatorsWorkspaceDataProvider';
import { EmulatorKeyPrefix, EmulatorsGroupId, isEmulatorNode, isEmulatorsGroupNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeEmulatorNode, makeEmulatorsGroupNode } from '../mockWorkspaceNode';

function createProvider() {
    const s = createLocalFunctions();
    const azurite = new AzuriteEmulator(s.code);
    mock.method(azurite, 'status', () => Promise.resolve({ installed: false, running: 0 }));
    const provider = new EmulatorsWorkspaceDataProvider(s.code, azurite, s.index, s.hosts);
    disposables.push({ dispose: () => { provider.dispose(); s.dispose(); } });
    return provider;
}

let disposables: { dispose(): void }[] = [];

describe('EmulatorsWorkspaceDataProvider (unit)', () => {
    afterEach(() => {
        disposables.forEach(item => { item.dispose(); });
        disposables = [];
        mock.restoreAll();
    });
    describe('canHandle', () => {
        it('returns true for emulatorsGroup and emulator nodes', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeEmulatorsGroupNode())).to.be.true;
            expect(provider.canHandle(makeEmulatorNode())).to.be.true;
        });

        it('returns false for unrelated values', () => {
            const provider = createProvider();
            expect(provider.canHandle(makeAzdProjectNode())).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
            expect(provider.canHandle('emulator')).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('discovers project hosts and reflects their actual registered ports', async () => {
            const s = createLocalFunctions();
            s.addProject();
            const azurite = new AzuriteEmulator(s.code);
            mock.method(azurite, 'status', () => Promise.resolve({ installed: true, running: 2 }));
            const provider = new EmulatorsWorkspaceDataProvider(s.code, azurite, s.index, s.hosts);
            disposables.push({ dispose: () => { provider.dispose(); s.dispose(); } });

            const stopped = await provider.getChildren(makeEmulatorsGroupNode());
            expect(stopped[0]).to.include({ state: 'partial', description: '2/3 services running' });
            expect(stopped[1]).to.include({ state: 'stopped' });
            const registration = s.hosts.register(s.folder, 8097);
            const running = await provider.getChildren(makeEmulatorsGroupNode());
            expect(running[1]).to.include({ state: 'running', description: 'Running on port 8097' });
            expect(running[1].resourceUri?.toString()).to.equal(s.folder.toString());
            registration.dispose();
            expect((await provider.getChildren(makeEmulatorsGroupNode()))[1]).to.include({ state: 'stopped' });
        });

        it('returns a single group node at root', async () => {
            const provider = createProvider();
            const children = await provider.getChildren();
            expect(children).to.have.length(1);
            expect(isEmulatorsGroupNode(children[0])).to.be.true;
            expect(children[0].id).to.equal(EmulatorsGroupId);
        });

        it('returns emulator entries under the group node', async () => {
            const provider = createProvider();
            const emulators = await provider.getChildren(makeEmulatorsGroupNode());
            expect(emulators.length).to.be.greaterThan(0);
            expect(emulators.every(isEmulatorNode)).to.be.true;
        });

        it('returns empty for a leaf emulator node', async () => {
            const provider = createProvider();
            expect(await provider.getChildren(makeEmulatorNode())).to.deep.equal([]);
        });
    });

    describe('key invariants', () => {
        it('EmulatorsGroupId must not start with EmulatorKeyPrefix', () => {
            // canHandle relies on these being distinct: the group id must not
            // match the emulator prefix, otherwise the provider would treat
            // the group node as an emulator child.
            expect(EmulatorsGroupId.startsWith(EmulatorKeyPrefix)).to.be.false;
        });
    });
});
