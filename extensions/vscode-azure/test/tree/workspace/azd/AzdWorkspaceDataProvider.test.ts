/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { AzdShowResult } from '../../../../src/azd/AzdService';

import { azdDetector, AzdWorkspaceDataProvider } from '../../../../src/tree/workspace/azd/AzdWorkspaceDataProvider';
import { isAzdProjectNode, isAzdServiceNode } from '../../../../src/tree/workspace/WorkspaceNode';
import { WorkspaceIndexService } from '../../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { createMockAzdService } from '../../../azd/MockAzdService';
import { makeAzdProjectNode, makeAzdServiceNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

interface ProviderOptions {
    readonly showFor?: (cwd: vscode.Uri) => AzdShowResult | undefined;
}

function createProvider(options: ProviderOptions = {}) {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    const azd = createMockAzdService();
    if (options.showFor) {
        azd.show.mock.mockImplementation((cwd: vscode.Uri) => Promise.resolve(options.showFor!(cwd)));
    }
    // Projects now come from the shared index, so these tests drive the real
    // service and detector rather than stubbing discovery.
    const indexService = new WorkspaceIndexService(m.vscode, [azdDetector]);
    const provider = new AzdWorkspaceDataProvider(m.vscode, executor, azd, indexService);
    return { provider, mock: m, azd };
}

/** Adds a workspace folder, optionally containing an `azure.yaml`. */
function addWorkspace(m: ReturnType<typeof createMockVsCode>, azureYaml = true): void {
    const uri = m.vscode.Uri.file('/repo');
    m.workspaceFolders.push({ uri, name: 'repo', index: 0 });
    m.fs.addDirectory(uri);
    if (azureYaml) {
        m.fs.addFile(m.vscode.Uri.file('/repo/azure.yaml'), 'name: app');
    }
}

describe('AzdWorkspaceDataProvider (unit)', () => {
    describe('canHandle', () => {
        it('returns true for azdProject and azdService nodes', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeAzdProjectNode())).to.be.true;
            expect(provider.canHandle(makeAzdServiceNode())).to.be.true;
        });

        it('returns false for unrelated workspace nodes and non-objects', () => {
            const { provider } = createProvider();
            expect(provider.canHandle(makeFunctionsProjectNode())).to.be.false;
            expect(provider.canHandle('azwr://azdProject/x')).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('getChildren (root)', () => {
        it('returns no projects when no workspace folders are open', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns no projects when no azure.yaml is present', async () => {
            const { provider, mock: m } = createProvider();
            addWorkspace(m, false);
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('discovers an azd project from the workspace index', async () => {
            const { provider, mock: m } = createProvider();
            addWorkspace(m);

            const children = await provider.getChildren();

            expect(children).to.have.length(1);
            expect(isAzdProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
            expect(children[0].resourceUri.path).to.equal('/repo/azure.yaml');
        });

        it('does not fire its own change event; the tree subscribes once', () => {
            const { provider, mock: m } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [] });
            expect(onChange.mock.callCount()).to.equal(0);
        });
    });

    describe('getChildren (services)', () => {
        it('returns no services when azd show fails', async () => {
            const { provider, mock: m } = createProvider({ showFor: () => undefined });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });
            expect(await provider.getChildren(project)).to.deep.equal([]);
        });

        it('returns no services when azd show reports no services', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({ name: 'app' }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });
            expect(await provider.getChildren(project)).to.deep.equal([]);
        });

        it('produces one node per service reported by azd show', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({
                    name: 'app',
                    services: {
                        api: { project: { path: '/repo/src/api', language: 'node' } },
                        web: { project: { path: '/repo/src/web', language: 'node' } },
                    },
                }),
            });
            // Pretend the service folders exist on disk so resourceUri resolves:
            m.fs.addFile(m.vscode.Uri.file('/repo/src/api'));
            m.fs.addFile(m.vscode.Uri.file('/repo/src/web'));

            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services.map(s => s.label)).to.deep.equal(['api', 'web']);
            expect(services.every(isAzdServiceNode)).to.be.true;
            const first = services[0];
            if (isAzdServiceNode(first)) {
                expect(first.projectFolderUri?.toString()).to.equal(
                    m.vscode.Uri.file('/repo/src/api').toString(),
                );
            }
        });

        it('omits projectFolderUri when the service folder does not exist on disk', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({
                    services: { api: { project: { path: '/repo/src/missing' } } },
                }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services).to.have.length(1);
            const svc = services[0];
            if (isAzdServiceNode(svc)) {
                expect(svc.projectFolderUri).to.equal(undefined);
            }
        });

        it('omits projectFolderUri when the descriptor has no project path', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({ services: { api: {} } }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services).to.have.length(1);
            const svc = services[0];
            if (isAzdServiceNode(svc)) {
                expect(svc.projectFolderUri).to.equal(undefined);
            }
        });

        it('returns empty for unrelated nodes', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeAzdServiceNode())).to.deep.equal([]);
        });
    });

    describe('enrich', () => {
        it('replaces the folder-name label with the project name from azd show', async () => {
            const { provider, mock: m, azd } = createProvider({
                showFor: () => ({ name: 'my-app' }),
            });
            const project = makeAzdProjectNode({
                label: 'repo',
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const changed = await provider.enrich(project);
            expect(changed).to.be.false;
            expect(project.label).to.equal('my-app');
            expect(azd.show.mock.callCount()).to.equal(1);
        });

        it('leaves the label untouched when azd show fails', async () => {
            const { provider, mock: m } = createProvider({ showFor: () => undefined });
            const project = makeAzdProjectNode({
                label: 'repo',
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            await provider.enrich(project);
            expect(project.label).to.equal('repo');
        });

        it('leaves the label untouched when azd show returns no name', async () => {
            const { provider, mock: m } = createProvider({ showFor: () => ({}) });
            const project = makeAzdProjectNode({
                label: 'repo',
                resourceUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            await provider.enrich(project);
            expect(project.label).to.equal('repo');
        });

        it('is a no-op for service nodes', async () => {
            const { provider, azd } = createProvider();
            const service = makeAzdServiceNode({ label: 'api' });

            const changed = await provider.enrich(service);
            expect(changed).to.be.false;
            expect(service.label).to.equal('api');
            expect(azd.show.mock.callCount()).to.equal(0);
        });
    });
});
