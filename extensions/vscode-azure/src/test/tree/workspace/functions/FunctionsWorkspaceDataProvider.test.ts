/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { FunctionsWorkspaceDataProvider } from '../../../../tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { isFunctionsProjectNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider() {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    return { provider: new FunctionsWorkspaceDataProvider(m.vscode, executor), mock: m };
}

describe('FunctionsWorkspaceDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('returns true only for functionsProject nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeFunctionsProjectNode())).to.be.true;
            expect(provider.canHandle(makeAzdProjectNode())).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('returns empty when there are no workspace folders', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns empty when no host.json is present', async () => {
            const { provider, mock: m } = createProvider();
            m.workspaceFolders.push({ uri: m.vscode.Uri.file('/repo'), name: 'repo', index: 0 });
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('detects a Functions project from host.json', async () => {
            const { provider, mock: m } = createProvider();
            m.workspaceFolders.push({ uri: m.vscode.Uri.file('/repo'), name: 'repo', index: 0 });
            m.fs.addFile(m.vscode.Uri.file('/repo/host.json'), '{}');

            const children = await provider.getChildren();
            expect(children).to.have.length(1);
            expect(isFunctionsProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
        });

        it('returns empty for any non-root node (leaf)', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeFunctionsProjectNode())).to.deep.equal([]);
        });

        it('fires onDidChange when workspace folders change', () => {
            const { provider, mock: m } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [] });
            expect(onChange.mock.callCount()).to.equal(1);
        });
    });
});
