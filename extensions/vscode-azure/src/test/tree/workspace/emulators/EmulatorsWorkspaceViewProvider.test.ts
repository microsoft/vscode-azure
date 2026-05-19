/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    EmulatorsWorkspaceViewProvider, toEmulatorsGroupTreeItem, toEmulatorTreeItem,
} from '../../../../tree/workspace/emulators/EmulatorsWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeEmulatorNode, makeEmulatorsGroupNode } from '../mockWorkspaceNode';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const dataTree = {
        get: (id: string) => nodeMap.get(id),
        getChildren: (parent?: WorkspaceNode) => Promise.resolve(parent ? [] : rootChildren),
    };
    return { provider: new EmulatorsWorkspaceViewProvider(m.vscode, executor, dataTree as never), code: m.vscode };
}

describe('EmulatorsWorkspaceViewProvider (unit)', () => {
    it('canHandle matches emulator-prefixed keys', () => {
        const { provider } = createProvider([]);
        expect(provider.canHandle('azwr://emulatorsGroup')).to.be.true;
        expect(provider.canHandle('azwr://emulator/azurite')).to.be.true;
        expect(provider.canHandle('azwr://azdProject/x')).to.be.false;
        expect(provider.canHandle(undefined)).to.be.false;
    });

    it('filters root to emulator nodes only', async () => {
        const group = makeEmulatorsGroupNode();
        const azd = makeAzdProjectNode();
        const { provider } = createProvider([group, azd], [group, azd]);
        expect(await provider.getChildren()).to.deep.equal([group.id]);
    });

    it('renders the emulators group as Collapsed with server icon', () => {
        const group = makeEmulatorsGroupNode();
        const { provider, code } = createProvider([group]);
        const item = provider.getTreeItem(group.id);
        expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.Collapsed);
        expect((item.iconPath as { id?: string }).id).to.equal('server-environment');
    });

    it('renders an emulator entry as a leaf with description', () => {
        const em = makeEmulatorNode({ description: 'Not running' });
        const { provider, code } = createProvider([em]);
        const item = provider.getTreeItem(em.id);
        expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.None);
        expect(item.description).to.equal('Not running');
        expect((item.iconPath as { id?: string }).id).to.equal('debug-disconnect');
    });

    it('getTreeItem throws for unknown keys', () => {
        const { provider } = createProvider([]);
        expect(() => provider.getTreeItem('azwr://emulator/missing')).to.throw();
    });

    it('exported helpers build deterministic items', () => {
        const { vscode: code } = createMockVsCode();
        const groupItem = toEmulatorsGroupTreeItem(code, makeEmulatorsGroupNode());
        expect(groupItem.label).to.equal('Emulators');
        const item = toEmulatorTreeItem(code, makeEmulatorNode());
        expect(item.label).to.equal('Azurite');
    });
});
