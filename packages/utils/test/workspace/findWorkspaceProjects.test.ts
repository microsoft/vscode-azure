/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { CancellationError } from '../../src/vscode/CancellationError';
import { findWorkspaceProjects, type FindWorkspaceProjectsOptions } from '../../src/workspace/findWorkspaceProjects';
import type { ProjectDetector } from '../../src/workspace/ProjectDetector';
import type { WorkspaceScanResult } from '../../src/workspace/WorkspaceProject';
import { createMockVsCode, type MockVsCodeResult } from '../vscode/MockVsCode';

describe('findWorkspaceProjects (unit)', () => {
    describe('discovery', () => {
        it('finds projects across workspace folders, shallowest first', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/one', 0);
            addWorkspace(m, '/two', 1);
            addFile(m, '/one/apps/deep/package.json', packageJson({ react: '1.0.0' }));
            addFile(m, '/one/package.json', packageJson({ vue: '1.0.0' }));
            addFile(m, '/two/site/index.html', '<html></html>');

            const result = await scan(m);

            expect(result.projects.map(p => `${p.workspaceFolder.name}:${p.relativePath}`))
                .to.deep.equal(['one:.', 'one:apps/deep', 'two:site']);
            expect(result.projects[0].frameworks).to.deep.equal(['vue']);
            expect(result.projects[1].frameworks).to.deep.equal(['react']);
            expect(result.projects[2].frameworks).to.deep.equal(['html']);
        });

        it('reports the workspace root as "."', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));

            const [project] = (await scan(m)).projects;

            expect(project.relativePath).to.equal('.');
            expect(project.rootUri.path).to.equal('/repo');
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

        it('returns nothing when no workspace folders are open', async () => {
            const result = await scan(createMockVsCode());

            expect(result.projects).to.be.empty;
            expect(result.truncated).to.be.false;
        });
    });

    describe('exclusions', () => {
        it('honours nested gitignore files, including re-inclusion', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/.gitignore', 'ignored/\napps/*\n!apps/keep/\n');
            addFile(m, '/repo/apps/keep/package.json', packageJson({ react: '1.0.0' }));
            addFile(m, '/repo/apps/drop/package.json', packageJson({ vue: '1.0.0' }));
            addFile(m, '/repo/ignored/package.json', packageJson({ svelte: '1.0.0' }));
            addFile(m, '/repo/nested/.gitignore', 'skip/\n');
            addFile(m, '/repo/nested/skip/package.json', packageJson({ '@angular/core': '1.0.0' }));
            addFile(m, '/repo/nested/take/package.json', packageJson({ vite: '1.0.0' }));

            const result = await scan(m);

            expect(result.projects.map(p => p.relativePath)).to.deep.equal(['apps/keep', 'nested/take']);
        });

        it('skips generated directories and does not follow directory symlinks', async () => {
            const m = createMockVsCode();
            const folder = addWorkspace(m, '/repo');
            addFile(m, '/repo/node_modules/pkg/package.json', packageJson({ react: '1.0.0' }));
            addFile(m, '/repo/dist/package.json', packageJson({ vue: '1.0.0' }));
            m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'linked'), m.vscode.FileType.Directory);

            const result = await scan(m);

            expect(result.projects).to.be.empty;
            // Only the workspace root is enumerated; nothing below it is walked.
            expect(m.fs.readDirectory.mock.callCount()).to.equal(1);
        });
    });

    describe('detection', () => {
        it('prefers the more specific framework over its base dependency', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/next/package.json', packageJson({ next: '1.0.0', react: '1.0.0' }));
            addFile(m, '/repo/kit/package.json', packageJson({ '@sveltejs/kit': '1.0.0', svelte: '1.0.0' }));
            addFile(m, '/repo/nuxt/package.json', packageJson({ nuxt: '1.0.0', vue: '1.0.0' }));

            const byPath = await scanByPath(m);

            expect(byPath.get('next')?.frameworks).to.deep.equal(['nextjs']);
            expect(byPath.get('kit')?.frameworks).to.deep.equal(['svelte-kit']);
            expect(byPath.get('nuxt')?.frameworks).to.deep.equal(['nuxt']);
        });

        it('separates a Next.js static export from an SSR app', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/viaScript/package.json',
                packageJson({ next: '1.0.0' }, { build: 'next build && next export' }));
            addFile(m, '/repo/viaConfig/package.json', packageJson({ next: '1.0.0' }));
            addFile(m, '/repo/viaConfig/next.config.js', 'module.exports = { output: "export" };');
            addFile(m, '/repo/ssr/package.json', packageJson({ next: '1.0.0' }));

            const byPath = await scanByPath(m);

            expect(byPath.get('viaScript')?.frameworks).to.deep.equal(['nextjs-export']);
            expect(byPath.get('viaScript')?.outputDirectory).to.equal('out');
            expect(byPath.get('viaConfig')?.frameworks).to.deep.equal(['nextjs-export']);
            expect(byPath.get('ssr')?.frameworks).to.deep.equal(['nextjs']);
            expect(byPath.get('ssr')?.outputDirectory).to.be.undefined;
        });

        it('merges framework, build tool, and language detections', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0', vite: '1.0.0', typescript: '1.0.0' }));
            addFile(m, '/repo/package-lock.json', '{}');
            addFile(m, '/repo/tsconfig.json', '{}');

            const [project] = (await scan(m)).projects;

            expect(project.frameworks).to.deep.equal(['react']);
            expect(project.buildTools).to.deep.equal(['vite', 'npm']);
            expect(project.languages).to.deep.equal(['typescript']);
        });

        it('falls back to javascript when there is no TypeScript signal', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));

            const [project] = (await scan(m)).projects;

            expect(project.languages).to.deep.equal(['javascript']);
        });

        it('detects Blazor WebAssembly and plain .NET projects', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/blazor/App.csproj', '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"></Project>');
            addFile(m, '/repo/api/Api.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');

            const byPath = await scanByPath(m);

            expect(byPath.get('blazor')?.frameworks).to.deep.equal(['blazor-wasm']);
            expect(byPath.get('blazor')?.outputDirectory).to.equal('wwwroot');
            expect(byPath.get('api')?.frameworks).to.be.empty;
            expect(byPath.get('api')?.languages).to.deep.equal(['csharp']);
        });

        it('accepts a Hugo config but not an unrelated config file', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/site/hugo.toml', 'baseURL = "/"');
            addFile(m, '/repo/generic/config.json', JSON.stringify({ port: 3000 }));
            addFile(m, '/repo/legacy/config.toml', 'baseURL = "/"\ntheme = "x"');

            const byPath = await scanByPath(m);

            expect(byPath.get('site')?.frameworks).to.deep.equal(['hugo']);
            expect(byPath.get('legacy')?.frameworks).to.deep.equal(['hugo']);
            expect(byPath.has('generic')).to.be.false;
        });

        it('prefers a configured Angular output path over the convention', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/configured/angular.json', angularJson('artifacts/web'));
            addFile(m, '/repo/bare/angular.json', JSON.stringify({ projects: {} }));

            const byPath = await scanByPath(m);

            expect(byPath.get('configured')?.outputDirectory).to.equal('artifacts/web');
            expect(byPath.get('bare')?.outputDirectory).to.equal('dist');
        });

        it('discards output paths that escape the project root', async () => {
            for (const outputPath of ['/var/www', 'C:\\dist', '../dist', 'build/../../dist']) {
                const m = createMockVsCode();
                addWorkspace(m, '/repo');
                addFile(m, '/repo/angular.json', angularJson(outputPath));

                const [project] = (await scan(m)).projects;

                expect(project.outputDirectory, outputPath).to.be.undefined;
            }
        });

        it('treats a bare index.html as a project only outside a richer one', async () => {
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

        it('runs caller-supplied detectors alongside the defaults', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));
            const detector: ProjectDetector = async directory =>
                await directory.hasDependency('react') ? { buildTools: ['custom'] } : undefined;

            const [project] = (await scan(m, { detectors: [detector] })).projects;

            expect(project.frameworks).to.deep.equal(['react']);
            expect(project.buildTools).to.deep.equal(['custom']);
        });

        it('finds projects marked only by caller-supplied markers', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/svc/host.json', '{}');
            const detector: ProjectDetector = directory =>
                directory.has('host.json') ? { frameworks: ['functions'] } : undefined;

            const result = await scan(m, {
                detectors: [detector],
                markers: { names: new Set(['host.json']), suffixes: [] },
            });

            expect(result.projects.map(p => p.relativePath)).to.deep.equal(['svc']);
            expect(result.projects[0].frameworks).to.deep.equal(['functions']);
        });
    });

    describe('resilience', () => {
        it('treats a malformed manifest as unreadable without failing the scan', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/bad/package.json', '{ nope');
            addFile(m, '/repo/good/package.json', packageJson({ react: '1.0.0' }));

            const byPath = await scanByPath(m);

            // The directory is still a project (package.json marks it), but no
            // dependency-based detector can classify it.
            expect(byPath.get('bad')?.frameworks).to.be.empty;
            expect(byPath.get('good')?.frameworks).to.deep.equal(['react']);
        });

        it('ignores files that vanish mid-walk but surfaces other failures', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));
            m.fs.readDirectory.mock.mockImplementationOnce(
                () => Promise.reject(Object.assign(new Error('denied'), { code: 'NoPermissions' })));

            await assert.rejects(findWorkspaceProjects(m.vscode), /denied/);
        });

        it('reports truncation instead of walking past the entry budget', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            for (let i = 0; i < 20; i++) {
                addFile(m, `/repo/app${i}/package.json`, packageJson({ react: '1.0.0' }));
            }

            const result = await scan(m, { maxEntries: 5 });

            expect(result.truncated).to.be.true;
            expect(result.projects.length).to.be.lessThan(20);
        });

        it('rejects an invalid entry budget', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');

            await assert.rejects(findWorkspaceProjects(m.vscode, undefined, { maxEntries: 0 }), RangeError);
        });

        it('throws CancellationError once the token is cancelled', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));
            let checks = 0;
            const token = {
                get isCancellationRequested() { return ++checks > 2; },
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } satisfies vscode.CancellationToken;

            await assert.rejects(findWorkspaceProjects(m.vscode, token), CancellationError);
        });
    });
});

function scan(m: MockVsCodeResult, options?: FindWorkspaceProjectsOptions): Promise<WorkspaceScanResult> {
    return findWorkspaceProjects(m.vscode, undefined, options);
}

async function scanByPath(m: MockVsCodeResult, options?: FindWorkspaceProjectsOptions) {
    const result = await scan(m, options);
    return new Map(result.projects.map(project => [project.relativePath, project]));
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

function angularJson(outputPath: string): string {
    return JSON.stringify({
        projects: { app: { architect: { build: { options: { outputPath } } } } },
    });
}
