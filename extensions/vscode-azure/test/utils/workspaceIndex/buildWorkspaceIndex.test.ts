/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFile, addWorkspaceFolder, createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { buildWorkspaceIndex } from '../../../src/utils/workspaceIndex/buildWorkspaceIndex';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';
import { Attribute, attributeDetector, AttributedRoot, csharpDetector, CsProjectRoot, CsSourceFile, nodeDetector, NodeSourceFile } from './mockDetectors';

describe('buildWorkspaceIndex (unit)', () => {
    describe('namespacing', () => {
        it('keeps same-named tags from different namespaces apart', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');
            addWorkspaceFile(m, '/repo/app.js', '');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, nodeDetector]);

            expect(index.withTag(CsSourceFile).map(n => n.relativePath)).to.deep.equal(['App.cs']);
            expect(index.withTag(NodeSourceFile).map(n => n.relativePath)).to.deep.equal(['app.js']);
        });

        it('rejects a detector applying another namespace\'s tag', async () => {
            const forger: WorkspaceDetector = {
                id: 'forger',
                namespace: tagNamespace('forger'),
                files: { suffixes: ['.cs'] },
                inspect(item) { item.tag(CsSourceFile); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');

            await expect(buildWorkspaceIndex(m.vscode, [forger])).to.be.rejectedWith(/may only apply tags in namespace 'forger'/);
        });

        it('rejects namespace and tag names containing the qualifier separator', () => {
            expect(() => tagNamespace('a:b')).to.throw(RangeError);
            expect(() => tagNamespace('')).to.throw(RangeError);
            expect(() => tagNamespace('ok').tag('a:b')).to.throw(RangeError);
        });
    });

    describe('tags', () => {
        it('records many tags on one node', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/Api.csproj', '');
            addWorkspaceFile(m, '/repo/marker.txt', '');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);
            const root = m.vscode.Uri.file('/repo');

            expect(index.has(root, CsProjectRoot)).to.be.true;
            expect(index.has(root, AttributedRoot)).to.be.true;
        });

        it('accumulates repeated values for one tag', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/marker.txt', '');
            addWorkspaceFile(m, '/repo/Orders.cs',
                '[Name("PlaceOrder")]\n[Name("CancelOrder")]');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);
            const [file] = index.withTag(Attribute);

            expect(file.relativePath).to.equal('Orders.cs');
            expect(file.values).to.deep.equal(['PlaceOrder', 'CancelOrder']);
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
        it('indexes a directory before its contents so ancestors resolve', async () => {
            const seen: string[] = [];
            const recorder: WorkspaceDetector = {
                id: 'recorder',
                namespace: tagNamespace('recorder'),
                directories: true,
                files: { suffixes: ['.cs'] },
                inspect(item) { seen.push(item.relativePath); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/src/App.cs', '');

            await buildWorkspaceIndex(m.vscode, [recorder]);

            expect(seen).to.deep.equal(['.', 'src', 'src/App.cs']);
        });

        it('runs detectors in registration order, so later ones see earlier tags', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/marker.txt', '');
            addWorkspaceFile(m, '/repo/App.cs', '[Name("Ping")]');

            // The functions detector only inspects files the C# detector has
            // already recognised as source.
            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);

            expect(index.withTag(Attribute).flatMap(f => f.values)).to.deep.equal(['Ping']);
        });

        it('does not tag files in a directory without the marker', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/api/marker.txt', '');
            addWorkspaceFile(m, '/repo/api/Inside.cs', '[Name("Inside")]');
            addWorkspaceFile(m, '/repo/other/Outside.cs', '[Name("Outside")]');

            const index = await buildWorkspaceIndex(m.vscode, [csharpDetector, attributeDetector]);

            expect(index.withTag(Attribute).flatMap(f => f.values)).to.deep.equal(['Inside']);
        });
    });

    describe('dispatch', () => {
        it('only inspects nodes matching the declared interest', async () => {
            const inspected: string[] = [];
            const detector: WorkspaceDetector = {
                id: 'picky',
                namespace: tagNamespace('picky'),
                files: { names: ['marker.txt'], suffixes: ['.csproj'] },
                inspect(item) { inspected.push(item.name); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/marker.txt', '');
            addWorkspaceFile(m, '/repo/Api.csproj', '');
            addWorkspaceFile(m, '/repo/readme.md', '');

            await buildWorkspaceIndex(m.vscode, [detector]);

            expect(inspected.sort()).to.deep.equal(['Api.csproj', 'marker.txt']);
        });

        it('exposes the containing directory\'s file names to every detector', async () => {
            const sizes = new Map<string, number>();
            const detector: WorkspaceDetector = {
                id: 'sizes',
                namespace: tagNamespace('sizes'),
                directories: true,
                files: { suffixes: ['.cs'] },
                inspect(item) { sizes.set(item.relativePath, item.fileNames.size); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');
            addWorkspaceFile(m, '/repo/readme.md', '');

            await buildWorkspaceIndex(m.vscode, [detector]);

            expect(sizes.get('.')).to.equal(2);
            // A file sees its own siblings, itself included.
            expect(sizes.get('App.cs')).to.equal(2);
        });

        it('reads a file once per detector that asks for it', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', 'contents');
            const reader = (id: string): WorkspaceDetector => ({
                id,
                namespace: tagNamespace(id),
                files: { suffixes: ['.cs'] },
                inspect: async item => { await item.text(); },
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
                namespace: tagNamespace('boom'),
                directories: true,
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
