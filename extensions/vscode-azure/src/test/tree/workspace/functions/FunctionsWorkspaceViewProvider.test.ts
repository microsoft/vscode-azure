/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    FunctionsWorkspaceViewProvider, toFunctionsProjectTreeItem,
} from '../../../../tree/workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const dataTree = {
        get: (id: string) => nodeMap.get(id),
        getChildren: (parent?: WorkspaceNode) => Promise.resolve(parent ? [] : rootChildren),
    };
    return { provider: new FunctionsWorkspaceViewProvider(m.vscode, executor, dataTree as never), code: m.vscode };
}

describe('FunctionsWorkspaceViewProvider (unit)', () => {
    it('canHandle matches only functionsProject keys', () => {
        const { provider } = createProvider([]);
        expect(provider.canHandle('azwr://functionsProject/file:///repo')).to.be.true;
        expect(provider.canHandle('azwr://azdProject/file:///repo')).to.be.false;
        expect(provider.canHandle(null)).to.be.false;
    });

    it('getChildren filters to functions nodes only at root', async () => {
        const fn = makeFunctionsProjectNode();
        const azd = makeAzdProjectNode();
        const { provider } = createProvider([fn, azd], [fn, azd]);
        expect(await provider.getChildren()).to.deep.equal([fn.id]);
    });

    it('getTreeItem renders functionsProject with zap icon and reveal context', () => {
        const node = makeFunctionsProjectNode({ label: 'my-fn' });
        const { provider, code } = createProvider([node]);
        const item = provider.getTreeItem(node.id);
        expect(item.label).to.equal('my-fn');
        expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.None);
        expect((item.iconPath as { id?: string }).id).to.equal('zap');
        expect((item.contextValue ?? '')).to.include('revealInExplorer');
    });

    it('getTreeItem throws for unknown keys', () => {
        const { provider } = createProvider([]);
        expect(() => provider.getTreeItem('azwr://functionsProject/missing')).to.throw();
    });

    it('toFunctionsProjectTreeItem points resourceUri at the folder', () => {
        const { vscode: code } = createMockVsCode();
        const node = makeFunctionsProjectNode();
        const item = toFunctionsProjectTreeItem(code, node);
        expect(item.resourceUri).to.equal(node.resourceUri);
    });
});
