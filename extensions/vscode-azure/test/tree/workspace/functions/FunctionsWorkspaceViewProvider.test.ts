/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { FunctionsWorkspaceViewProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const m = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const dataTree = {
        get: (id: string) => nodeMap.get(id),
        getChildren: (parent?: WorkspaceNode) => Promise.resolve(parent ? [] : rootChildren),
    };
    return { provider: new FunctionsWorkspaceViewProvider(m.ctx, executor, dataTree as never), code: m.ctx.code };
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

    it('getTreeItem renders functionsProject with function app icon and reveal context', () => {
        const node = makeFunctionsProjectNode({ label: 'my-fn' });
        const { provider, code } = createProvider([node]);
        const item = provider.getTreeItem(node.id);
        expect(item.label).to.equal('my-fn');
        expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.None);
        expect((item.iconPath as vscode.Uri).path).to.include('microsoft.web/sites~functionapp.svg');
        expect((item.contextValue ?? '')).to.include('revealInExplorer');
    });

    it('getTreeItem throws for unknown keys', () => {
        const { provider } = createProvider([]);
        expect(() => provider.getTreeItem('azwr://functionsProject/missing')).to.throw();
    });
});
