/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor, ManualDebounceScheduler, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';

import { functionsDetector, FunctionsWorkspaceDataProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { isFunctionsProjectNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { WorkspaceIndexService } from '../../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider() {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    // The real index service, so these tests cover the detector and the
    // provider's use of it rather than a hand-rolled stand-in.
    const indexService = new WorkspaceIndexService(m.vscode, [functionsDetector], new ManualDebounceScheduler());
    return {
        provider: new FunctionsWorkspaceDataProvider(indexService, executor),
        indexService,
        mock: m,
    };
}

function addWorkspace(m: MockVsCodeResult, path = '/repo'): void {
    const uri = m.vscode.Uri.file(path);
    m.workspaceFolders.push({ uri, name: path.slice(1), index: m.workspaceFolders.length });
    m.fs.addDirectory(uri);
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
            addWorkspace(m);
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('detects a Functions project from host.json', async () => {
            const { provider, mock: m } = createProvider();
            addWorkspace(m);
            m.fs.addFile(m.vscode.Uri.file('/repo/host.json'), '{}');

            const children = await provider.getChildren();

            expect(children).to.have.length(1);
            expect(isFunctionsProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
            expect(children[0].resourceUri.path).to.equal('/repo/host.json');
        });

        it('detects a nested Functions project', async () => {
            const { provider, mock: m } = createProvider();
            addWorkspace(m);
            m.fs.addFile(m.vscode.Uri.file('/repo/api/host.json'), '{}');

            const children = await provider.getChildren();

            expect(children).to.have.length(1);
            expect(children[0].resourceUri.path).to.equal('/repo/api/host.json');
        });

        it('ignores a host.json inside an excluded directory', async () => {
            const { provider, mock: m } = createProvider();
            addWorkspace(m);
            m.fs.addFile(m.vscode.Uri.file('/repo/node_modules/pkg/host.json'), '{}');

            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns empty for any non-root node (leaf)', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeFunctionsProjectNode())).to.deep.equal([]);
        });
    });

    describe('watching', () => {
        it('does not create its own watcher or index subscription', () => {
            const { provider, mock: m } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            // Watching and invalidation both belong to shared infrastructure:
            // the index service owns the watcher, and registerTrees subscribes
            // once for the whole tree so N providers do not cause N refreshes.
            const patterns = m.workspace.createFileSystemWatcher.mock.calls
                .map(call => call.arguments[0]);
            expect(patterns).to.deep.equal(['**/{host.json}', '**/.gitignore']);

            m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [] });
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });
});
