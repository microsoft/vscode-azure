/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { AzdWorkspaceViewProvider } from '../../../../src/tree/workspace/azd/AzdWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeAzdServiceNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const { ctx } = createMockCodeContext();
    const { executor } = createTestActionExecutor();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const dataTree = {
        get: (id: string) => nodeMap.get(id),
        getChildren: (parent?: WorkspaceNode) => {
            if (!parent) {
                return Promise.resolve(rootChildren);
            }
            return Promise.resolve([] as WorkspaceNode[]);
        },
    };
    return { provider: new AzdWorkspaceViewProvider(ctx, executor, dataTree as never), code: ctx.code };
}

describe('AzdWorkspaceViewProvider (unit)', () => {
    describe('canHandle', () => {
        it('matches only azd-prefixed string keys', () => {
            const { provider } = createProvider([]);
            expect(provider.canHandle('azwr://azdProject/file:///repo')).to.be.true;
            expect(provider.canHandle('azwr://azdService/file:///repo/api')).to.be.true;
            expect(provider.canHandle('azwr://functionsProject/file:///repo')).to.be.false;
            expect(provider.canHandle('azwr://emulators')).to.be.false;
            expect(provider.canHandle(42)).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('filters root children to azd nodes only', async () => {
            const azd = makeAzdProjectNode();
            const fn = makeFunctionsProjectNode();
            const { provider } = createProvider([azd, fn], [azd, fn]);

            expect(await provider.getChildren()).to.deep.equal([azd.id]);
        });

        it('returns empty for unknown keys', async () => {
            const { provider } = createProvider([]);
            expect(await provider.getChildren('azwr://azdProject/missing')).to.deep.equal([]);
        });
    });

    describe('getTreeItem', () => {
        it('renders an azdProject as a collapsible item with azd icon', () => {
            const node = makeAzdProjectNode({ label: 'my-repo' });
            const { provider, code } = createProvider([node]);

            const item = provider.getTreeItem(node.id);
            expect(item.label).to.equal('my-repo');
            expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.Collapsed);
            expect((item.iconPath as vscode.Uri).fsPath).to.include('azd.svg');
            expect((item.contextValue ?? '')).to.include('revealInExplorer');
        });

        it('renders an azdService leaf with revealInExplorer context when a folder exists', () => {
            const project = makeAzdProjectNode();
            const service = makeAzdServiceNode({
                projectFolderUri: { path: '/repo/src/api', toString() { return 'file:///repo/src/api'; } } as never,
            });
            const { provider, code } = createProvider([project, service]);

            const item = provider.getTreeItem(service.id);
            expect(item.label).to.equal('api');
            expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.None);
            expect((item.contextValue ?? '')).to.include('revealInExplorer');
        });

        it('omits revealInExplorer from context when service has no project folder', () => {
            const project = makeAzdProjectNode();
            const service = makeAzdServiceNode(); // no projectFolderUri
            const { provider } = createProvider([project, service]);

            const item = provider.getTreeItem(service.id);
            expect(item.contextValue ?? '').to.not.include('revealInExplorer');
        });

        it('throws for unknown keys', () => {
            const { provider } = createProvider([]);
            expect(() => provider.getTreeItem('azwr://azdProject/missing')).to.throw();
        });
    });
});
