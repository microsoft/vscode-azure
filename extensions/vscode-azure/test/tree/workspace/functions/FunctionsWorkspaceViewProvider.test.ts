/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { FunctionsWorkspaceViewProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';
import { LocalFunctionsHostTracker } from '../../../../src/functions/host/LocalFunctionsHostTracker';
import { treeMenuMatches } from '../../treeMenuMatches';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const m = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const dataTree = {
        get: (id: string) => nodeMap.get(id),
        getChildren: (parent?: WorkspaceNode) => Promise.resolve(parent ? [] : rootChildren),
    };
    return { provider: new FunctionsWorkspaceViewProvider(m.ctx, executor, dataTree as never, new LocalFunctionsHostTracker()), code: m.ctx.code };
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

    it('renders the project directory with its Function App icon and explorer action', () => {
        const node = makeFunctionsProjectNode();
        const { provider, code } = createProvider([node]);
        const item = provider.getTreeItem(node.id);
        expect(item.label).to.equal('repo');
        expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.Collapsed);
        expect((item.iconPath as vscode.Uri).path).to.include('microsoft.web/sites~functionapp.svg');
        expect(treeMenuMatches('vscode-azure/workspace/revealInExplorer', 'vscode-azure/workspace', item)).to.be.true;
    });

    it('getTreeItem throws for unknown keys', () => {
        const { provider } = createProvider([]);
        expect(() => provider.getTreeItem('azwr://functionsProject/missing')).to.throw();
    });
});
