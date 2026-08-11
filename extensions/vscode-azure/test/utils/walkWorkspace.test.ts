/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { defaultExcludedDirectories, walkWorkspace, type ScannedDirectory, type WalkWorkspaceOptions } from '../../src/utils/walkWorkspace';

describe('walkWorkspace (unit)', () => {
    describe('traversal', () => {
        it('yields directories breadth-first across every workspace folder', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/one', 0);
            addWorkspace(m, '/two', 1);
            addFile(m, '/one/deep/nested/file.txt', '');
            addFile(m, '/one/top.txt', '');
            addFile(m, '/two/only.txt', '');

            const paths = (await collect(m)).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.', 'deep', 'deep/nested', '.']);
        });

        it('visits entries in name order regardless of filesystem order', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            for (const name of ['zeta', 'alpha', 'mid']) {
                addFile(m, `/repo/${name}/file.txt`, '');
            }

            const paths = (await collect(m)).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.', 'alpha', 'mid', 'zeta']);
        });

        it('exposes file names, uris, and the containing workspace folder', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/api/host.json', '{}');

            const [, api] = await collect(m);

            expect(api.relativePath).to.equal('api');
            expect(api.uri.path).to.equal('/repo/api');
            expect([...api.fileNames]).to.deep.equal(['host.json']);
            expect(api.fileUri('host.json').path).to.equal('/repo/api/host.json');
            expect(api.workspaceFolder?.name).to.equal('repo');
        });

        it('scopes the walk to a single subtree when given a uri', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/api/src/app.cs', '');
            addFile(m, '/repo/web/index.html', '');

            const paths = (await collect(m, { scope: m.vscode.Uri.file('/repo/api') }))
                .map(d => d.relativePath);

            // Relative paths are relative to the scope root, not the folder.
            expect(paths).to.deep.equal(['.', 'src']);
        });

        it('stops descending when a consumer prunes the subtree', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/project/host.json', '{}');
            addFile(m, '/repo/project/deep/nested.txt', '');

            const visited: string[] = [];
            for await (const directory of walkWorkspace(m.vscode)) {
                visited.push(directory.relativePath);
                if (directory.fileNames.has('host.json')) {
                    directory.skipChildren();
                }
            }

            expect(visited).to.deep.equal(['.', 'project']);
        });

        it('does not follow directory symlinks', async () => {
            const m = createMockVsCode();
            const folder = addWorkspace(m, '/repo');
            m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'linked'), m.vscode.FileType.Directory);

            const paths = (await collect(m)).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.']);
        });

        it('still reads symlinked files, which cannot cause cycles', async () => {
            const m = createMockVsCode();
            const folder = addWorkspace(m, '/repo');
            addFile(m, '/repo/real.json', '{"linked":true}');
            m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'link.json'), m.vscode.FileType.File);

            const [root] = await collect(m);

            expect([...root.fileNames]).to.include('link.json');
        });
    });

    describe('exclusions', () => {
        it('skips generated and vendored directories by default', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            for (const name of ['node_modules', 'bin', 'obj', '.venv', '__pycache__', 'dist']) {
                addFile(m, `/repo/${name}/thing.txt`, '');
            }
            addFile(m, '/repo/src/app.cs', '');

            const paths = (await collect(m)).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.', 'src']);
        });

        it('accepts a caller-supplied exclusion set', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/dist/out.js', '');
            addFile(m, '/repo/custom/thing.txt', '');

            const paths = (await collect(m, {
                excludeDirectories: new Set([...defaultExcludedDirectories, 'custom']),
            })).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.']);
        });

        it('honours nested gitignore files, including re-inclusion', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/.gitignore', 'ignored/\napps/*\n!apps/keep/\n');
            addFile(m, '/repo/apps/keep/file.txt', '');
            addFile(m, '/repo/apps/drop/file.txt', '');
            addFile(m, '/repo/ignored/file.txt', '');
            addFile(m, '/repo/nested/.gitignore', 'skip/\n');
            addFile(m, '/repo/nested/skip/file.txt', '');
            addFile(m, '/repo/nested/take/file.txt', '');

            const paths = (await collect(m)).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.', 'apps', 'nested', 'apps/keep', 'nested/take']);
        });

        it('can be told to ignore gitignore files', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/.gitignore', 'secret/\n');
            addFile(m, '/repo/secret/file.txt', '');

            const paths = (await collect(m, { respectGitignore: false })).map(d => d.relativePath);

            expect(paths).to.deep.equal(['.', 'secret']);
        });
    });

    describe('reads', () => {
        it('reads text and json lazily, and only once per file', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', '{"name":"app"}');

            const [root] = await collect(m);
            expect(m.fs.readFile.mock.callCount()).to.equal(0);

            const [first, second, asText] = await Promise.all([
                root.json('package.json'),
                root.json('package.json'),
                root.text('package.json'),
            ]);

            expect(first).to.deep.equal({ name: 'app' });
            expect(second).to.deep.equal({ name: 'app' });
            expect(asText).to.equal('{"name":"app"}');
            expect(m.fs.readFile.mock.callCount()).to.equal(1);
        });

        it('reports absent and malformed files as undefined', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/broken.json', '{ nope');

            const [root] = await collect(m);

            expect(await root.json('broken.json')).to.be.undefined;
            expect(await root.json('missing.json')).to.be.undefined;
            expect(await root.text('missing.txt')).to.be.undefined;
        });

        it('skips files larger than the read budget', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/big.json', '{"padding":"aaaaaaaaaaaaaaaaaaaa"}');

            const [root] = await collect(m, { maxFileBytes: 8 });

            expect(await root.text('big.json')).to.be.undefined;
        });
    });

    describe('limits and failures', () => {
        it('reports truncation instead of walking past the entry budget', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', '{"name":"app"}');
            for (let i = 0; i < 20; i++) {
                addFile(m, `/repo/dir${i}/file.txt`, '');
            }

            const walk = walkWorkspace(m.vscode, undefined, { maxEntries: 5 });
            const seen: ScannedDirectory[] = [];
            for await (const directory of walk) {
                seen.push(directory);
            }

            expect(walk.truncated).to.be.true;
            expect(seen.length).to.be.lessThan(20);
            // A directory that has already been read must still be reported: the
            // budget bounds how far the walk descends, it does not discard work
            // already done. Dropping it would hide the root's own manifests.
            expect(seen.map(d => d.relativePath)).to.include('.');
            expect(await seen[0].json('package.json')).to.deep.equal({ name: 'app' });
        });

        it('does not report truncation when the budget is exactly met', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/a.txt', '');
            addFile(m, '/repo/b.txt', '');

            const walk = walkWorkspace(m.vscode, undefined, { maxEntries: 2 });
            await drain(walk);

            expect(walk.truncated).to.be.false;
        });

        it('reports truncation per iteration rather than latching', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/a/file.txt', '');
            addFile(m, '/repo/b/file.txt', '');

            const walk = walkWorkspace(m.vscode, undefined, { maxEntries: 2 });
            await drain(walk);
            expect(walk.truncated).to.be.true;

            // The tree shrinks under the budget, so re-iterating the same walk
            // must report this run's outcome rather than the earlier one.
            await m.fs.delete(m.vscode.Uri.file('/repo/b/file.txt'));
            await m.fs.delete(m.vscode.Uri.file('/repo/b'));

            const paths: string[] = [];
            for await (const directory of walk) {
                paths.push(directory.relativePath);
            }

            expect(paths).to.deep.equal(['.', 'a']);
            expect(walk.truncated).to.be.false;
        });

        it('rejects an invalid entry budget', () => {
            const m = createMockVsCode();
            expect(() => walkWorkspace(m.vscode, undefined, { maxEntries: 0 })).to.throw(RangeError);
        });

        it('ignores directories that vanish mid-walk but surfaces other failures', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/gone/file.txt', '');
            m.fs.readDirectory.mock.mockImplementationOnce(
                () => Promise.reject(Object.assign(new Error('denied'), { code: 'NoPermissions' })));

            await assert.rejects(collect(m), /denied/);
        });

        it('throws CancellationError once the token is cancelled', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/a/file.txt', '');
            let checks = 0;
            const token = {
                get isCancellationRequested() { return ++checks > 1; },
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } satisfies vscode.CancellationToken;

            await assert.rejects(collect(m, {}, token), CancellationError);
        });

        it('yields nothing when no workspace folder is open', async () => {
            expect(await collect(createMockVsCode())).to.be.empty;
        });
    });

    // The two consumers this primitive exists for want different result shapes:
    // one classification per project (a create wizard's defaults) and many
    // definitions per source file (functions in a project). Both are expressed
    // here to prove the walk does not favour either.
    describe('consumer shapes', () => {
        it('supports one-result-per-directory classification', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/web/package.json', '{"dependencies":{"react":"1"}}');
            addFile(m, '/repo/api/package.json', '{"dependencies":{"vue":"1"}}');

            const projects: { path: string; framework: string }[] = [];
            for await (const directory of walkWorkspace(m.vscode)) {
                const manifest = await directory.json('package.json') as
                    { dependencies?: Record<string, string> } | undefined;
                const dependencies = manifest?.dependencies ?? {};
                const framework = ['react', 'vue'].find(name => name in dependencies);
                if (framework) {
                    projects.push({ path: directory.relativePath, framework });
                }
            }

            expect(projects).to.deep.equal([
                { path: 'api', framework: 'vue' },
                { path: 'web', framework: 'react' },
            ]);
        });

        it('supports many-results-per-file extraction from source', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/src/Orders.cs',
                '[Function("PlaceOrder")] public void A() {}\n[Function("CancelOrder")] public void B() {}');
            addFile(m, '/repo/src/Health.cs', '[Function("Ping")] public void C() {}');
            addFile(m, '/repo/obj/Generated.cs', '[Function("ShouldNotAppear")] public void D() {}');

            const found: string[] = [];
            for await (const directory of walkWorkspace(m.vscode)) {
                for (const name of directory.fileNames) {
                    if (!name.endsWith('.cs')) {
                        continue;
                    }
                    const source = await directory.text(name) ?? '';
                    for (const match of source.matchAll(/\[Function\("([^"]+)"\)\]/g)) {
                        found.push(match[1]);
                    }
                }
            }

            expect(found.sort()).to.deep.equal(['CancelOrder', 'Ping', 'PlaceOrder']);
        });

        it('serves several consumers from a single walk and a single read', async () => {
            const m = createMockVsCode();
            addWorkspace(m, '/repo');
            addFile(m, '/repo/package.json', '{"name":"app","dependencies":{"react":"1"}}');

            const names: string[] = [];
            const frameworks: string[] = [];
            for await (const directory of walkWorkspace(m.vscode)) {
                // Two independent consumers inspecting the same directory.
                const a = await directory.json('package.json') as { name?: string } | undefined;
                if (a?.name) {
                    names.push(a.name);
                }
                const b = await directory.json('package.json') as
                    { dependencies?: Record<string, string> } | undefined;
                if (b?.dependencies?.react) {
                    frameworks.push('react');
                }
            }

            expect(names).to.deep.equal(['app']);
            expect(frameworks).to.deep.equal(['react']);
            expect(m.fs.readDirectory.mock.callCount()).to.equal(1);
            expect(m.fs.readFile.mock.callCount()).to.equal(1);
        });
    });
});

async function collect(
    m: MockVsCodeResult,
    options?: WalkWorkspaceOptions,
    token?: vscode.CancellationToken,
): Promise<ScannedDirectory[]> {
    const directories: ScannedDirectory[] = [];
    for await (const directory of walkWorkspace(m.vscode, token, options)) {
        directories.push(directory);
    }
    return directories;
}

/** Iterates a walk to completion, discarding the directories. */
async function drain(walk: AsyncIterable<ScannedDirectory>): Promise<void> {
    for await (const directory of walk) {
        void directory;
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
