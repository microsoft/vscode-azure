/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Roots, type DataProviderChangeEvent } from '@microsoft/vscode-azure-utils';
import { fireFileSystemEvent } from '@microsoft/vscode-azure-utils/testing';
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
        mock.restoreAll();
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
        it('delivers only generated-output paths to the Functions watcher', () => {
            const s = createProvider();
            const watcher = s.m.fileSystemWatchers.at(-1)!;
            const delivered = mock.method(watcher, 'fireChange');
            for (const path of ['/repo/src/index.ts', '/repo/local.settings.json', '/repo/binocular/file', '/repo/targeting/file']) {
                fireFileSystemEvent(s.m, path);
            }
            expect(delivered.mock.callCount()).to.equal(0);

            const outputPaths = [
                '/repo/bin', '/repo/bin/Debug/net8.0/functions.metadata',
                '/repo/api/target', '/repo/api/target/azure-functions/app/Http/function.json',
            ];
            for (const path of outputPaths) {
                fireFileSystemEvent(s.m, path);
            }
            expect(delivered.mock.calls.map(call => call.arguments[0].path)).to.deep.equal(outputPaths);
        });

        for (const kind of ['create', 'change', 'delete'] as const) {
            it(`invalidates the owning project for ${kind} events in generated output`, async () => {
                const s = createProvider();
                s.addProject();
                s.m.fs.addFile(s.code.Uri.joinPath(s.folder, 'api', 'host.json'), '{}');
                const projects = await s.provider.getChildren();
                const project = projects.find(node => node.label === 'repo/api');
                expect(project).not.to.be.undefined;
                const changed = mock.fn<(event: DataProviderChangeEvent<WorkspaceNode>) => void>();
                const subscription = s.provider.onDidChange(changed);
                for (const path of ['bin', 'bin/Debug/functions.metadata', 'target', 'target/azure-functions/app/Http/function.json']) {
                    fireFileSystemEvent(s.m, `/repo/api/${path}`, kind);
                }
                expect(changed.mock.callCount()).to.equal(0);
                await s.outputScheduler.flush();
                expect(changed.mock.calls.map(call => call.arguments[0])).to.deep.equal([{ target: project }]);
                subscription.dispose();
            });
        }

        it('coalesces mixed output events into one refresh per affected project', async () => {
            const s = createProvider();
            s.addProject();
            for (const name of ['api', 'other']) {
                s.m.fs.addFile(s.code.Uri.joinPath(s.folder, name, 'host.json'), '{}');
            }
            const projects = await s.provider.getChildren();
            const changed = mock.fn<(event: DataProviderChangeEvent<WorkspaceNode>) => void>();
            const subscription = s.provider.onDidChange(changed);
            fireFileSystemEvent(s.m, '/repo/bin/Debug/functions.metadata', 'create');
            fireFileSystemEvent(s.m, '/repo/api/target/classes/Http.class', 'change');
            fireFileSystemEvent(s.m, '/repo/api/target', 'delete');
            expect(changed.mock.callCount()).to.equal(0);
            await s.outputScheduler.flush();
            expect(changed.mock.calls.map(call => call.arguments[0])).to.deep.equal(
                projects.filter(project => project.label !== 'repo/other').map(project => ({ target: project })),
            );
            changed.mock.resetCalls();
            fireFileSystemEvent(s.m, '/repo/bin', 'delete');
            await s.outputScheduler.flush();
            expect(changed.mock.calls.map(call => call.arguments[0])).to.deep.equal([{ target: projects[0] }]);
            subscription.dispose();
        });

        it('cancels pending generated-output refreshes when disposed', async () => {
            const s = createProvider();
            s.addProject();
            await s.provider.getChildren();
            fireFileSystemEvent(s.m, '/repo/bin', 'delete');
            expect(s.outputScheduler.hasPending).to.be.true;
            s.provider.dispose();
            expect(s.outputScheduler.hasPending).to.be.false;
        });

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
            const { provider, m } = createProvider();
            m.workspaceFolders.splice(0);
            m.fs.addFile(m.vscode.Uri.file('/repo/host.json'), '{}');
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
