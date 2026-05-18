/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    AzdWorkspaceViewProvider, toAzdProjectTreeItem, toAzdServiceTreeItem,
} from '../../../../tree/workspace/azd/AzdWorkspaceViewProvider';
import type { WorkspaceNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeAzdServiceNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider(nodes: WorkspaceNode[], rootChildren: WorkspaceNode[] = nodes) {
    const m = createMockVsCode();
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
    return { provider: new AzdWorkspaceViewProvider(m.vscode, executor, dataTree as never), code: m.vscode };
}

describe('AzdWorkspaceViewProvider (unit)', () => {
    describe('canHandle', () => {
        it('matches only azd-prefixed string keys', () => {
            const { provider } = createProvider([]);
            expect(provider.canHandle('workspace://azdProject/file:///repo')).to.be.true;
            expect(provider.canHandle('workspace://azdService/file:///repo/api')).to.be.true;
            expect(provider.canHandle('workspace://functionsProject/file:///repo')).to.be.false;
            expect(provider.canHandle('workspace://emulators')).to.be.false;
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
            expect(await provider.getChildren('workspace://azdProject/missing')).to.deep.equal([]);
        });
    });

    describe('getTreeItem', () => {
        it('renders an azdProject as a collapsible item with rocket icon', () => {
            const node = makeAzdProjectNode({ label: 'my-repo' });
            const { provider, code } = createProvider([node]);

            const item = provider.getTreeItem(node.id);
            expect(item.label).to.equal('my-repo');
            expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.Collapsed);
            // ThemeIcon ID is `id` on the MockThemeIcon
            expect((item.iconPath as { id?: string }).id).to.equal('rocket');
            expect((item.contextValue ?? '')).to.include('azdProject');
            expect((item.contextValue ?? '')).to.include('revealInExplorer');
        });

        it('renders an azdService leaf with revealInExplorer context when a folder exists', () => {
            const project = makeAzdProjectNode();
            const service = makeAzdServiceNode({
                resourceUri: { path: '/repo/src/api', toString() { return 'file:///repo/src/api'; } } as never,
            });
            const { provider, code } = createProvider([project, service]);

            const item = provider.getTreeItem(service.id);
            expect(item.label).to.equal('api');
            expect(item.collapsibleState).to.equal(code.TreeItemCollapsibleState.None);
            expect((item.contextValue ?? '')).to.include('azdService');
            expect((item.contextValue ?? '')).to.include('revealInExplorer');
        });

        it('omits revealInExplorer from context when service has no project folder', () => {
            const project = makeAzdProjectNode();
            const service = makeAzdServiceNode(); // no resourceUri
            const { provider } = createProvider([project, service]);

            const item = provider.getTreeItem(service.id);
            expect(item.contextValue ?? '').to.include('azdService');
            expect(item.contextValue ?? '').to.not.include('revealInExplorer');
        });

        it('throws for unknown keys', () => {
            const { provider } = createProvider([]);
            expect(() => provider.getTreeItem('workspace://azdProject/missing')).to.throw();
        });
    });

    describe('renderers', () => {
        it('toAzdProjectTreeItem sets resourceUri to the azure.yaml file', () => {
            const { vscode: code } = createMockVsCode();
            const node = makeAzdProjectNode();
            const item = toAzdProjectTreeItem(code, node);
            expect(item.resourceUri).to.equal(node.azureYamlUri);
        });

        it('toAzdServiceTreeItem falls back to "No project folder" when missing', () => {
            const { vscode: code } = createMockVsCode();
            const item = toAzdServiceTreeItem(code, makeAzdServiceNode());
            expect(item.description).to.equal('No project folder');
        });
    });
});
