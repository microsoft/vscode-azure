/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionExecutor, ManualDebounceScheduler } from '@microsoft/vscode-azure-utils/testing';
import { FunctionsWorkspaceDataProvider } from '../../../../src/tree/workspace/functions/FunctionsWorkspaceDataProvider';
import { isFunctionsProjectNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { createFunctionsProjectDetector } from '../../../../src/workspace/detectors/functionsProjectDetector';
import { WorkspaceDataService } from '../../../../src/workspace/WorkspaceDataService';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

/**
 * Wires the provider to a real {@linkcode WorkspaceDataService} carrying the
 * real Functions detector, so these tests cover the discovery path end to end
 * rather than a stubbed index.
 */
function createProvider() {
    const { executor, mockVsCode: m } = createTestActionExecutor();
    const scheduler = new ManualDebounceScheduler();
    const workspaceData = new WorkspaceDataService(
        m.vscode, executor, [createFunctionsProjectDetector()], scheduler);

    return {
        provider: new FunctionsWorkspaceDataProvider(executor, workspaceData),
        mock: m,
        workspaceData,
        scheduler,
    };
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
            // The node still points at host.json itself, so "Reveal in Explorer"
            // opens the file rather than its folder.
            expect(children[0].resourceUri.path).to.equal('/repo/host.json');
        });

        it('returns empty for any non-root node (leaf)', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeFunctionsProjectNode())).to.deep.equal([]);
        });
    });
});
