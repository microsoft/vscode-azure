/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Roots, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import { isFunctionsProjectNode, type WorkspaceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';
import { createLocalFunctions } from './mockLocalFunctions';

describe('FunctionsWorkspaceDataProvider (unit)', () => {
    let fixtures: ReturnType<typeof createLocalFunctions>[] = [];
    function createProvider() {
        const fixture = createLocalFunctions();
        fixtures.push(fixture);
        return { ...fixture, mock: fixture.m, indexService: fixture.index };
    }
    afterEach(() => {
        fixtures.forEach(fixture => { fixture.dispose(); });
        fixtures = [];
    });
    describe('canHandle', () => {
        it('returns true only for functionsProject nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeFunctionsProjectNode())).to.be.true;
            expect(provider.canHandle(makeAzdProjectNode())).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('getChildren', () => {
        it('refreshes roots for a host change before discovery and only the owning project afterward', async () => {
            const s = createProvider();
            s.addProject();
            s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'other', 'host.json'), '{}');
            const changed = mock.fn<(event: DataProviderChangeEvent<WorkspaceNode>) => void>();
            const subscription = s.provider.onDidChange(changed);
            const registration = s.hosts.register(s.folder, 7071);
            expect(changed.mock.calls.map(call => call.arguments[0])).to.deep.equal([{ target: Roots }]);
            const [project] = await s.provider.getChildren();
            changed.mock.resetCalls();
            registration.dispose();
            expect(changed.mock.calls.map(call => call.arguments[0])).to.deep.equal([{ target: project }]);
            subscription.dispose();
        });

        it('returns empty when there are no workspace folders', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns empty when no host.json is present', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('detects a Functions project from host.json', async () => {
            const { provider, mock: m } = createProvider();
            m.fs.addFile(m.vscode.Uri.file('/repo/host.json'), '{}');

            const children = await provider.getChildren();

            expect(children).to.have.length(1);
            expect(isFunctionsProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
            expect(children[0].resourceUri?.path).to.equal('/repo/host.json');
        });

        it('detects a nested Functions project', async () => {
            const { provider, mock: m } = createProvider();
            m.fs.addFile(m.vscode.Uri.file('/repo/api/host.json'), '{}');

            const children = await provider.getChildren();

            expect(children).to.have.length(1);
            expect(children[0].resourceUri?.path).to.equal('/repo/api/host.json');
            expect(children[0].label).to.equal('repo/api');
        });

        it('ignores a host.json inside an excluded directory', async () => {
            const { provider, mock: m } = createProvider();
            m.fs.addFile(m.vscode.Uri.file('/repo/node_modules/pkg/host.json'), '{}');

            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns empty for another product\'s node', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeAzdProjectNode())).to.deep.equal([]);
        });
    });
});
