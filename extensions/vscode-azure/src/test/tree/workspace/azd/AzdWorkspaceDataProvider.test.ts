/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import type { AzdEnvironment, AzdShowResult, IAzdService } from '../../../../azd/AzdService';
import { AzdWorkspaceDataProvider } from '../../../../tree/workspace/azd/AzdWorkspaceDataProvider';
import { isAzdProjectNode, isAzdServiceNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeAzdServiceNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

interface StubAzdOptions {
    readonly azureYamlFor?: (folder: vscode.Uri) => vscode.Uri | undefined;
    readonly showFor?: (cwd: vscode.Uri) => AzdShowResult | undefined;
}

function createStubAzd(options: StubAzdOptions = {}): IAzdService {
    const notImplemented = () => Promise.reject(new Error('not implemented'));
    return {
        findAzureYaml: (folder: vscode.Uri) => Promise.resolve(options.azureYamlFor?.(folder)),
        show: (cwd: vscode.Uri) => Promise.resolve(options.showFor?.(cwd)),
        init: notImplemented,
        envNew: notImplemented,
        envList: () => Promise.resolve([] as AzdEnvironment[]),
        envExists: () => Promise.resolve(false),
        envGetValues: () => Promise.resolve({}),
        provision: notImplemented,
        deploy: notImplemented,
        checkVersion: () => Promise.resolve(undefined),
        install: notImplemented,
    };
}

function createProvider(options: StubAzdOptions = {}) {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    const azd = createStubAzd(options);
    const provider = new AzdWorkspaceDataProvider(m.vscode, executor, azd);
    return { provider, mock: m, azd };
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
            expect(provider.canHandle('workspace://azdProject/x')).to.be.false;
            expect(provider.canHandle(null)).to.be.false;
        });
    });

    describe('getChildren (root)', () => {
        it('returns no projects when no workspace folders are open', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('returns no projects when findAzureYaml returns undefined', async () => {
            const { provider, mock: m } = createProvider();
            m.workspaceFolders.push({ uri: m.vscode.Uri.file('/repo'), name: 'repo', index: 0 });
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('discovers an azd project via IAzdService.findAzureYaml', async () => {
            const findAzureYaml = mock.fn((folder: vscode.Uri) => folder);
            const { provider, mock: m } = createProvider({
                azureYamlFor: (folder) => {
                    findAzureYaml(folder);
                    return m.vscode.Uri.joinPath(folder, 'azure.yaml');
                },
            });
            const folder = m.vscode.Uri.file('/repo');
            m.workspaceFolders.push({ uri: folder, name: 'repo', index: 0 });

            const children = await provider.getChildren();
            expect(children).to.have.length(1);
            expect(isAzdProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
            expect(findAzureYaml.mock.callCount()).to.equal(1);
        });

        it('emits onDidChange when workspace folders change', () => {
            const { provider, mock: m } = createProvider();
            const onChange = mock.fn();
            provider.onDidChange(onChange);

            m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [] });
            expect(onChange.mock.callCount()).to.equal(1);
        });
    });

    describe('getChildren (services)', () => {
        it('returns no services when azd show fails', async () => {
            const { provider, mock: m } = createProvider({ showFor: () => undefined });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });
            expect(await provider.getChildren(project)).to.deep.equal([]);
        });

        it('returns no services when azd show reports no services', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({ name: 'app' }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });
            expect(await provider.getChildren(project)).to.deep.equal([]);
        });

        it('produces one node per service reported by azd show', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({
                    name: 'app',
                    services: {
                        api: { relativePath: 'src/api' },
                        web: { relativePath: 'src/web' },
                    },
                }),
            });
            // Pretend the service folders exist on disk so resourceUri resolves:
            m.fs.addFile(m.vscode.Uri.file('/repo/src/api'));
            m.fs.addFile(m.vscode.Uri.file('/repo/src/web'));

            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services.map(s => s.label)).to.deep.equal(['api', 'web']);
            expect(services.every(isAzdServiceNode)).to.be.true;
            const first = services[0];
            if (isAzdServiceNode(first)) {
                expect(first.resourceUri).to.not.equal(undefined);
            }
        });

        it('omits resourceUri when the service folder does not exist on disk', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({
                    services: { api: { relativePath: './missing' } },
                }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services).to.have.length(1);
            const svc = services[0];
            if (isAzdServiceNode(svc)) {
                expect(svc.resourceUri).to.equal(undefined);
            }
        });

        it('omits resourceUri when the descriptor has no relativePath', async () => {
            const { provider, mock: m } = createProvider({
                showFor: () => ({ services: { api: {} } }),
            });
            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: m.vscode.Uri.file('/repo/azure.yaml'),
            });

            const services = await provider.getChildren(project);
            expect(services).to.have.length(1);
            const svc = services[0];
            if (isAzdServiceNode(svc)) {
                expect(svc.resourceUri).to.equal(undefined);
            }
        });

        it('returns empty for unrelated nodes', async () => {
            const { provider } = createProvider();
            expect(await provider.getChildren(makeAzdServiceNode())).to.deep.equal([]);
        });
    });
});
