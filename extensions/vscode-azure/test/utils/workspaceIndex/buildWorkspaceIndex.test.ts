/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFile, addWorkspaceFolder, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { buildWorkspaceIndex } from '../../../src/utils/workspaceIndex/buildWorkspaceIndex';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { createTag } from '../../../src/utils/workspaceIndex/tags';
import { Attribute, attributeDetector, csharpDetector, CsProjectFile, CsSourceFile, nodeDetector, NodeProjectFile, NodeSourceFile } from './mockDetectors';

describe('buildWorkspaceIndex (unit)', () => {
    describe('namespacing', () => {
        it('keeps same-named tags from different namespaces apart', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/Api.csproj', '');
            addWorkspaceFile(m, '/repo/App.cs', '');
            addWorkspaceFile(m, '/repo/package.json', '');
            addWorkspaceFile(m, '/repo/app.js', '');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, nodeDetector]);

            expect(index.withTag(CsProjectFile).map(u => u.path)).to.deep.equal(['/repo/Api.csproj']);
            expect(index.withTag(CsSourceFile).map(u => u.path)).to.deep.equal(['/repo/App.cs']);
            expect(index.withTag(NodeProjectFile).map(u => u.path)).to.deep.equal(['/repo/package.json']);
            expect(index.withTag(NodeSourceFile).map(u => u.path)).to.deep.equal(['/repo/app.js']);
        });

        it('rejects a detector applying another namespace\'s tag', async () => {
            const forger: WorkspaceDetector = {
                id: 'forger',
                namespace: 'forger',
                inspect(item) {
                    if (item.name.endsWith('.cs')) {
                        item.tag(CsSourceFile);
                    }
                },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');

            await expect(buildWorkspaceIndex(m.vscode, [forger])).to.be.rejectedWith(/may only apply tags in namespace 'forger'/);
        });

        it('rejects namespace and tag names containing the qualifier separator', () => {
            expect(() => createTag('a:b', 'ok')).to.throw(RangeError);
            expect(() => createTag('', 'ok')).to.throw(RangeError);
            expect(() => createTag('ok', 'a:b')).to.throw(RangeError);
        });
    });

    describe('tags', () => {
        it('records many tags on one node', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/Orders.cs', '[Name("PlaceOrder")]');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);
            const file = m.vscode.Uri.file('/repo/Orders.cs');

            expect(index.has(file, CsSourceFile)).to.be.true;
            expect(index.has(file, Attribute)).to.be.true;
        });

        it('accumulates repeated values for one tag', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/Orders.cs',
                '[Name("PlaceOrder")]\n[Name("CancelOrder")]');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);
            const [file] = index.withTag(Attribute);

            expect(file.path).to.equal('/repo/Orders.cs');
            expect(index.valuesOf(file, Attribute)).to.deep.equal(['PlaceOrder', 'CancelOrder']);
        });

        it('reports no values for a valueless or absent tag', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector]);
            const file = m.vscode.Uri.file('/repo/App.cs');

            expect(index.valuesOf(file, CsSourceFile)).to.be.empty;
            expect(index.valuesOf(file, Attribute)).to.be.empty;
        });

        it('does not retain untagged nodes', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/readme.md', '');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector]);

            expect(index.has(m.vscode.Uri.file('/repo/readme.md'), CsSourceFile)).to.be.false;
        });
    });

    describe('ordering', () => {
        it('indexes a directory before its contents', async () => {
            const seen: string[] = [];
            const recorder: WorkspaceDetector = {
                id: 'recorder',
                namespace: 'recorder',
                inspect(item) { seen.push(item.uri.path); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/src/App.cs', '');

            await buildWorkspaceIndex(m.vscode, [recorder]);

            expect(seen).to.deep.equal(['/repo', '/repo/src', '/repo/src/App.cs']);
        });

        it('runs detectors in registration order, so later ones see earlier tags', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '[Name("Ping")]');

            // The attribute detector only inspects files the C# detector has
            // already recognised as source.
            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);
            const [file] = index.withTag(Attribute);

            expect(index.valuesOf(file, Attribute)).to.deep.equal(['Ping']);
        });

        it('tags nothing when the detector it layers on did not run', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '[Name("Ping")]');

            const index = await buildWorkspaceIndex(m.vscode, [attributeDetector]);

            expect(index.withTag(Attribute)).to.be.empty;
        });
    });

    describe('dispatch', () => {
        it('offers every file and directory to every detector', async () => {
            const inspected: string[] = [];
            const detector: WorkspaceDetector = {
                id: 'recorder',
                namespace: 'recorder',
                inspect(item) { inspected.push(item.uri.path); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/Api.csproj', '');
            addWorkspaceFile(m, '/repo/readme.md', '');
            addWorkspaceFile(m, '/repo/src/App.cs', '');

            await buildWorkspaceIndex(m.vscode, [detector]);

            expect(inspected.sort()).to.deep.equal(
                ['/repo', '/repo/Api.csproj', '/repo/readme.md', '/repo/src', '/repo/src/App.cs']);
        });

        it('names both files and directories by their final path segment', async () => {
            const names = new Map<string, string>();
            const detector: WorkspaceDetector = {
                id: 'names',
                namespace: 'names',
                inspect(item) { names.set(item.uri.path, item.name); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/src/App.cs', '');

            await buildWorkspaceIndex(m.vscode, [detector]);

            expect(names.get('/repo')).to.equal('repo');
            expect(names.get('/repo/src')).to.equal('src');
            expect(names.get('/repo/src/App.cs')).to.equal('App.cs');
        });

        it('shows a directory its file names, and a file none', async () => {
            const sizes = new Map<string, number>();
            const detector: WorkspaceDetector = {
                id: 'sizes',
                namespace: 'sizes',
                inspect(item) { sizes.set(item.uri.path, item.fileNames.size); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');
            addWorkspaceFile(m, '/repo/readme.md', '');

            await buildWorkspaceIndex(m.vscode, [detector]);

            expect(sizes.get('/repo')).to.equal(2);
            // A file is not shown its siblings, so that an incremental update
            // never has to re-inspect them.
            expect(sizes.get('/repo/App.cs')).to.equal(0);
        });

        it('reads a file once per detector that asks for it', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', 'contents');
            const reader = (id: string): WorkspaceDetector => ({
                id,
                namespace: id,
                inspect: async item => {
                    if (!item.isDirectory) {
                        await item.text();
                    }
                },
            });

            await buildWorkspaceIndex(m.vscode, [reader('a'), reader('b')]);

            // Reads are not cached: unrelated detectors rarely want the same
            // file, so a shared cache would cost more than it saves.
            expect(m.fs.readFile.mock.callCount()).to.equal(2);
        });
    });

    describe('failures', () => {
        it('surfaces a detector error', async () => {
            const detector: WorkspaceDetector = {
                id: 'boom',
                namespace: 'boom',
                inspect() { throw new Error('detector failed'); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');

            await expect(buildWorkspaceIndex(m.vscode, [detector])).to.be.rejectedWith(/detector failed/);
        });

        it('throws CancellationError once the token is cancelled', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/a/App.cs', '');
            let checks = 0;
            const token = {
                get isCancellationRequested() { return ++checks > 1; },
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } satisfies vscode.CancellationToken;

            await expect(buildWorkspaceIndex(m.vscode, [csharpDetector], token))
                .to.be.rejectedWith(CancellationError);
        });
    });
});
