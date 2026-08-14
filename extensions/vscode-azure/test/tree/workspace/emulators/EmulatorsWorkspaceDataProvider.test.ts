/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import {
    EmulatorsWorkspaceDataProvider,
} from '../../../../src/tree/workspace/emulators/EmulatorsWorkspaceDataProvider';
import { EmulatorKeyPrefix, EmulatorsGroupId, isEmulatorNode, isEmulatorsGroupNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeEmulatorNode, makeEmulatorsGroupNode } from '../mockWorkspaceNode';

function createProvider() {
    const { vscode } = createMockVsCode();
    return new EmulatorsWorkspaceDataProvider(vscode);
}

describe('EmulatorsWorkspaceDataProvider (unit)', () => {
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
