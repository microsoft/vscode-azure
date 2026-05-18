/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import {
    AzdWorkspaceDataProvider, parseAzureYamlServices,
} from '../../../../tree/workspace/azd/AzdWorkspaceDataProvider';
import { isAzdProjectNode, isAzdServiceNode } from '../../../../tree/workspace/WorkspaceNode';
import { makeAzdProjectNode, makeAzdServiceNode, makeFunctionsProjectNode } from '../mockWorkspaceNode';

function createProvider() {
    const m = createMockVsCode();
    const { executor } = createTestActionExecutor();
    const provider = new AzdWorkspaceDataProvider(m.vscode, executor);
    return { provider, mock: m };
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

        it('returns no projects when no azure.yaml is present', async () => {
            const { provider, mock: m } = createProvider();
            m.workspaceFolders.push({ uri: m.vscode.Uri.file('/repo'), name: 'repo', index: 0 });
            expect(await provider.getChildren()).to.deep.equal([]);
        });

        it('discovers an azd project from azure.yaml', async () => {
            const { provider, mock: m } = createProvider();
            const folder = m.vscode.Uri.file('/repo');
            m.workspaceFolders.push({ uri: folder, name: 'repo', index: 0 });
            m.fs.addFile(m.vscode.Uri.file('/repo/azure.yaml'), 'name: app\n');

            const children = await provider.getChildren();
            expect(children).to.have.length(1);
            expect(isAzdProjectNode(children[0])).to.be.true;
            expect(children[0].label).to.equal('repo');
        });

        it('also detects azure.yml (alternate extension)', async () => {
            const { provider, mock: m } = createProvider();
            const folder = m.vscode.Uri.file('/repo');
            m.workspaceFolders.push({ uri: folder, name: 'repo', index: 0 });
            m.fs.addFile(m.vscode.Uri.file('/repo/azure.yml'), 'name: app\n');

            const children = await provider.getChildren();
            expect(children).to.have.length(1);
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
        it('returns no services when azure.yaml has no services block', async () => {
            const { provider, mock: m } = createProvider();
            const yaml = m.vscode.Uri.file('/repo/azure.yaml');
            m.fs.addFile(yaml, 'name: app\n');

            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: yaml,
            });

            expect(await provider.getChildren(project)).to.deep.equal([]);
        });

        it('parses services and produces one node per top-level entry', async () => {
            const { provider, mock: m } = createProvider();
            const yaml = m.vscode.Uri.file('/repo/azure.yaml');
            m.fs.addFile(yaml, [
                'name: app',
                'services:',
                '  api:',
                '    project: ./src/api',
                '    language: ts',
                '  web:',
                '    project: ./src/web',
                '',
            ].join('\n'));
            // Pretend the service folders exist on disk:
            m.fs.addFile(m.vscode.Uri.file('/repo/src/api'));
            m.fs.addFile(m.vscode.Uri.file('/repo/src/web'));

            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: yaml,
            });

            const services = await provider.getChildren(project);
            expect(services.map(s => s.label)).to.deep.equal(['api', 'web']);
            expect(services.every(isAzdServiceNode)).to.be.true;
            // The first service should have its resolved project folder URI:
            const first = services[0];
            if (isAzdServiceNode(first)) {
                expect(first.resourceUri).to.not.equal(undefined);
            }
        });

        it('omits resourceUri when the project folder does not exist on disk', async () => {
            const { provider, mock: m } = createProvider();
            const yaml = m.vscode.Uri.file('/repo/azure.yaml');
            m.fs.addFile(yaml, 'services:\n  api:\n    project: ./missing\n');

            const project = makeAzdProjectNode({
                resourceUri: m.vscode.Uri.file('/repo'),
                azureYamlUri: yaml,
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

describe('parseAzureYamlServices (unit)', () => {
    it('returns no services for empty or services-less yaml', () => {
        expect(parseAzureYamlServices('')).to.deep.equal([]);
        expect(parseAzureYamlServices('name: app\nmetadata: {}\n')).to.deep.equal([]);
    });

    it('extracts service names from the services block', () => {
        const text = 'services:\n  api:\n  web:\n';
        expect(parseAzureYamlServices(text).map(s => s.name)).to.deep.equal(['api', 'web']);
    });

    it('captures the project: value for each service', () => {
        const text = 'services:\n  api:\n    project: ./src/api\n  web:\n    project: "./src/web"\n';
        const services = parseAzureYamlServices(text);
        expect(services).to.deep.equal([
            { name: 'api', project: './src/api' },
            { name: 'web', project: './src/web' },
        ]);
    });

    it('ignores comments and blank lines', () => {
        const text = [
            '# top-level comment',
            'services: # inline',
            '  api: # service comment',
            '    project: ./src/api',
            '',
            '  web:',
            '    project: ./src/web',
        ].join('\n');
        expect(parseAzureYamlServices(text).map(s => s.name)).to.deep.equal(['api', 'web']);
    });

    it('stops parsing once a sibling top-level key starts', () => {
        const text = [
            'services:',
            '  api:',
            '    project: ./src/api',
            'metadata:',
            '  template: foo',
        ].join('\n');
        const services = parseAzureYamlServices(text);
        expect(services).to.deep.equal([{ name: 'api', project: './src/api' }]);
    });

    it('handles services declared without any nested fields', () => {
        const text = 'services:\n  api:\n';
        expect(parseAzureYamlServices(text)).to.deep.equal([{ name: 'api', project: undefined }]);
    });
});
