/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { CancellationError } from '../../src/vscode/CancellationError';
import type { ProjectDetectionRule } from '../../src/workspace/ProjectDetectionRule';
import { WorkspaceProjectService } from '../../src/workspace/WorkspaceProjectService';
import type { WorkspaceScanResult } from '../../src/workspace/WorkspaceProject';
import { createMockVsCode, type MockVsCodeResult } from '../vscode/MockVsCode';

describe('WorkspaceProjectService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('enumerates projects across workspace folders in deterministic shallow-first order', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/one', 0);
        addWorkspace(m, '/two', 1);
        addFile(m, '/one/apps/deep/package.json', packageJson({ react: '1.0.0' }));
        addFile(m, '/one/package.json', packageJson({ vue: '1.0.0' }));
        addFile(m, '/two/site/index.html', '<html></html>');

        const result = await scan(m);

        expect(result.projects.map(project =>
            `${project.workspaceFolder.name}:${project.relativePath}`))
            .to.deep.equal(['one:.', 'one:apps/deep', 'two:site']);
        expect(result.projects[0].frameworks).to.deep.equal(['vue']);
        expect(result.projects[1].frameworks).to.deep.equal(['react']);
        expect(result.projects[2].frameworks).to.deep.equal(['html']);
    });

    it('respects root and nested gitignore rules, including negation', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/.gitignore', 'ignored/\napps/*\n!apps/keep/\n');
        addFile(m, '/repo/apps/keep/package.json', packageJson({ react: '1.0.0' }));
        addFile(m, '/repo/apps/drop/package.json', packageJson({ vue: '1.0.0' }));
        addFile(m, '/repo/ignored/package.json', packageJson({ svelte: '1.0.0' }));
        addFile(m, '/repo/nested/.gitignore', 'skip/\n');
        addFile(m, '/repo/nested/skip/package.json', packageJson({ angular: '1.0.0' }));
        addFile(m, '/repo/nested/take/package.json', packageJson({ vite: '1.0.0' }));

        const result = await scan(m);

        expect(result.projects.map(project => project.relativePath))
            .to.deep.equal(['apps/keep', 'nested/take']);
    });

    it('always excludes generated directories and does not follow directory symlinks', async () => {
        const m = createMockVsCode();
        const folder = addWorkspace(m, '/repo');
        addFile(m, '/repo/node_modules/pkg/package.json', packageJson({ react: '1.0.0' }));
        addFile(m, '/repo/dist/package.json', packageJson({ vue: '1.0.0' }));
        addFile(m, '/repo/public/index.html', '<html></html>');
        m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'linked'), m.vscode.FileType.Directory);

        const result = await scan(m);

        expect(result.projects).to.be.empty;
        expect(m.fs.readDirectory.mock.callCount()).to.equal(1);
    });

    it('uses static HTML only as a fallback to a stronger project detection', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));
        addFile(m, '/repo/index.html', '<html></html>');
        addFile(m, '/repo/src/index.html', '<html></html>');

        const result = await scan(m);

        expect(result.projects).to.have.lengthOf(1);
        expect(result.projects[0].relativePath).to.equal('.');
        expect(result.projects[0].frameworks).to.deep.equal(['react']);
    });

    it('applies specific framework precedence and generic tooling rules', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', packageJson({
            next: '1.0.0',
            react: '1.0.0',
            vite: '1.0.0',
            typescript: '1.0.0',
        }, { export: 'next export' }));
        addFile(m, '/repo/package-lock.json', '{}');
        addFile(m, '/repo/tsconfig.json', '{}');

        const [project] = (await scan(m)).projects;

        expect(project.frameworks).to.deep.equal(['nextjs-export']);
        expect(project.frameworks).not.to.include('react');
        expect(project.buildTools).to.deep.equal(['npm', 'vite']);
        expect(project.languages).to.deep.equal(['typescript']);
        expect(project.outputDirectories).to.deep.include({
            path: 'out',
            confidence: 'high',
            ruleId: 'framework.nextjs-export',
        });
    });

    it('distinguishes Next.js SSR and SvelteKit from their broader dependencies', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/next/package.json', packageJson({ next: '1.0.0', react: '1.0.0' }));
        addFile(m, '/repo/svelte/package.json', packageJson({
            '@sveltejs/kit': '1.0.0',
            svelte: '1.0.0',
        }));

        const result = await scan(m);

        expect(result.projects[0].frameworks).to.deep.equal(['nextjs']);
        expect(result.projects[1].frameworks).to.deep.equal(['svelte-kit']);
    });

    it('detects Blazor, Hugo, and configured Angular output directories', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/angular/angular.json', JSON.stringify({
            projects: {
                app: {
                    architect: {
                        build: {
                            options: { outputPath: 'artifacts/web' },
                        },
                    },
                },
            },
        }));
        addFile(m, '/repo/blazor/App.csproj',
            '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"></Project>');
        addFile(m, '/repo/docs/hugo.toml', 'baseURL = "/"');

        const result = await scan(m);

        expect(result.projects.find(project => project.relativePath === 'angular')?.outputDirectories[0])
            .to.include({ path: 'artifacts/web', confidence: 'high' });
        expect(result.projects.find(project => project.relativePath === 'blazor')?.frameworks)
            .to.deep.equal(['blazor-wasm']);
        expect(result.projects.find(project => project.relativePath === 'docs')?.frameworks)
            .to.deep.equal(['hugo']);
    });

    it('does not classify an unrelated generic config file as Hugo', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/config.json', JSON.stringify({ port: 3000 }));

        const result = await scan(m);

        expect(result.projects).to.be.empty;
    });

    it('uses a low-confidence conventional output when explicit configuration is unavailable', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/angular.json', JSON.stringify({ projects: {} }));

        const [project] = (await scan(m)).projects;

        expect(project.outputDirectories).to.deep.equal([{
            path: 'dist',
            confidence: 'low',
            ruleId: 'framework.angular',
        }]);
    });

    it('evaluates additional declarative rules', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/custom.project', 'enabled');
        const rule: ProjectDetectionRule = {
            id: 'custom.project',
            candidateFiles: ['custom.project'],
            all: [{ type: 'text', file: 'custom.project', pattern: '^enabled$' }],
            emits: [{ kind: 'framework', id: 'custom', confidence: 'high' }],
        };

        const result = await scan(m, { additionalRules: [rule] });

        expect(result.projects[0].frameworks).to.deep.equal(['custom']);
        expect(result.projects[0].detections[0].evidence[0].description)
            .to.equal('matches text pattern in custom.project');
    });

    it('reports invalid manifests without hiding valid projects', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/bad/package.json', '{ nope');
        addFile(m, '/repo/good/index.html', '<html></html>');

        const result = await scan(m);

        expect(result.projects.map(project => project.relativePath)).to.deep.equal(['bad', 'good']);
        expect(result.diagnostics).to.have.lengthOf(1);
        expect(result.diagnostics[0]).to.include({ code: 'invalidJson' });
        expect(result.diagnostics[0].uri.path).to.equal('/repo/bad/package.json');
    });

    it('surfaces entry, depth, project, and evidence-size truncation', async () => {
        const entryMock = createMockVsCode();
        addWorkspace(entryMock, '/repo');
        addFile(entryMock, '/repo/a/package.json', '{}');
        addFile(entryMock, '/repo/b/package.json', '{}');
        const entryResult = await scan(entryMock, { budgets: { maxEntries: 1 } });
        expect(entryResult.reachedLimits).to.include('entries');

        const depthMock = createMockVsCode();
        addWorkspace(depthMock, '/repo');
        addFile(depthMock, '/repo/a/b/package.json', '{}');
        const depthResult = await scan(depthMock, { budgets: { maxDepth: 1 } });
        expect(depthResult.reachedLimits).to.include('depth');

        const projectMock = createMockVsCode();
        addWorkspace(projectMock, '/repo');
        addFile(projectMock, '/repo/a/package.json', '{}');
        addFile(projectMock, '/repo/b/package.json', '{}');
        const projectResult = await scan(projectMock, { budgets: { maxProjects: 1 } });
        expect(projectResult.reachedLimits).to.include('projects');

        const sizeMock = createMockVsCode();
        addWorkspace(sizeMock, '/repo');
        addFile(sizeMock, '/repo/package.json', '{"dependencies":{"react":"1"}}');
        const sizeResult = await scan(sizeMock, { budgets: { maxEvidenceFileBytes: 5 } });
        expect(sizeResult.reachedLimits).to.include('evidenceFileSize');
        expect(sizeResult.truncated).to.be.true;
    });

    it('throws CancellationError and does not cache canceled scans', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', '{}');
        let checks = 0;
        const token = {
            get isCancellationRequested() {
                return ++checks > 2;
            },
            onCancellationRequested: () => ({ dispose: () => undefined }),
        } satisfies vscode.CancellationToken;
        const service = new WorkspaceProjectService(m.vscode);

        await assert.rejects(service.scan(token), CancellationError);
        const callsAfterCancellation = m.fs.readDirectory.mock.callCount();
        await service.scan();
        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(callsAfterCancellation);
        service.dispose();
    });

    it('caches completed scans until TTL expiry, force refresh, or explicit invalidation', async () => {
        const m = createMockVsCode();
        const folder = addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', '{}');
        let now = 100;
        mock.method(Date, 'now', () => now);
        const service = new WorkspaceProjectService(m.vscode);

        await service.scan(undefined, { cacheTtlMs: 10 });
        const firstCalls = m.fs.readDirectory.mock.callCount();
        await service.scan(undefined, { cacheTtlMs: 10 });
        expect(m.fs.readDirectory.mock.callCount()).to.equal(firstCalls);

        now = 111;
        await service.scan(undefined, { cacheTtlMs: 10 });
        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(firstCalls);
        const expiredCalls = m.fs.readDirectory.mock.callCount();

        await service.scan(undefined, { cacheTtlMs: 10, forceRefresh: true });
        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(expiredCalls);
        const refreshedCalls = m.fs.readDirectory.mock.callCount();

        service.invalidate(folder.uri);
        await service.scan(undefined, { cacheTtlMs: 10 });
        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(refreshedCalls);
        service.dispose();
    });

    it('invalidates cached scans when workspace folders change', async () => {
        const m = createMockVsCode();
        const folder = addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', '{}');
        const service = new WorkspaceProjectService(m.vscode);
        await service.scan();
        const firstCalls = m.fs.readDirectory.mock.callCount();

        m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [folder] });
        await service.scan();

        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(firstCalls);
        service.dispose();
    });

    it('supports non-file workspace URIs', async () => {
        const m = createMockVsCode();
        const uri = m.vscode.Uri.from({ scheme: 'vscode-remote', authority: 'ssh-remote+host', path: '/repo' });
        m.workspaceFolders.push({ uri, name: 'remote', index: 0 });
        m.fs.addFile(m.vscode.Uri.joinPath(uri, 'package.json'), packageJson({ react: '1.0.0' }));

        const [project] = (await scan(m)).projects;

        expect(project.rootUri.scheme).to.equal('vscode-remote');
        expect(project.frameworks).to.deep.equal(['react']);
    });

    it('propagates unexpected filesystem errors and does not cache them', async () => {
        const m = createMockVsCode();
        addWorkspace(m, '/repo');
        addFile(m, '/repo/package.json', '{}');
        const error = Object.assign(new Error('denied'), { code: 'NoPermissions' });
        m.fs.readDirectory.mock.mockImplementationOnce(() => Promise.reject(error));
        const service = new WorkspaceProjectService(m.vscode);

        await assert.rejects(service.scan(), /denied/);
        await service.scan();

        expect(m.fs.readDirectory.mock.callCount()).to.equal(2);
        service.dispose();
    });
});

async function scan(
    m: MockVsCodeResult,
    options: Parameters<WorkspaceProjectService['scan']>[1] = {},
): Promise<WorkspaceScanResult> {
    const service = new WorkspaceProjectService(m.vscode);
    try {
        return await service.scan(undefined, options);
    } finally {
        service.dispose();
    }
}

function addWorkspace(m: MockVsCodeResult, path: string, index = 0): vscode.WorkspaceFolder {
    const uri = m.vscode.Uri.file(path);
    const folder = { uri, name: path.split('/').pop() ?? path, index };
    m.workspaceFolders.push(folder);
    m.fs.addDirectory(uri);
    return folder;
}

function addFile(m: MockVsCodeResult, path: string, contents: string): void {
    m.fs.addFile(m.vscode.Uri.file(path), contents);
}

function packageJson(
    dependencies: Readonly<Record<string, string>>,
    scripts?: Readonly<Record<string, string>>,
): string {
    return JSON.stringify({ dependencies, scripts });
}
