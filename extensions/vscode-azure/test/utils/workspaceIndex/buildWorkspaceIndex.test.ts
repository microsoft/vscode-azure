/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFile, addWorkspaceFolder, createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { buildWorkspaceIndex } from '../../../src/utils/workspaceIndex/buildWorkspaceIndex';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import type { WorkspaceIndex } from '../../../src/utils/workspaceIndex/WorkspaceIndex';
import { tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';
import { csharpDetector, CsProjectRoot, CsSourceFile, functionsDetectorFor, nodeDetector, NodeSourceFile, TestFunctionName, TestFunctionsProject } from './mockDetectors';

describe('buildWorkspaceIndex (unit)', () => {
    describe('namespacing', () => {
        it('keeps same-named tags from different namespaces apart', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/App.cs', '');
            addWorkspaceFile(m, '/repo/app.js', '');

            const index = await build(m, [csharpDetector, nodeDetector]);

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

            await expect(build(m, [forger])).to.be.rejectedWith(/may only apply tags in namespace 'forger'/);
        });

        it('rejects two detectors sharing a namespace', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            const other: WorkspaceDetector = { ...csharpDetector, id: 'csharp-2' };

            await expect(build(m, [csharpDetector, other])).to.be.rejectedWith(/both use the tag namespace/);
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
            addWorkspaceFile(m, '/repo/host.json', '{}');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);
            const root = m.vscode.Uri.file('/repo');

            expect(index.has(root, CsProjectRoot)).to.be.true;
            expect(index.has(root, TestFunctionsProject)).to.be.true;
        });

        it('accumulates repeated values for one tag', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/host.json', '{}');
            addWorkspaceFile(m, '/repo/Orders.cs',
                '[Function("PlaceOrder")]\n[Function("CancelOrder")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);
            const [file] = index.withTag(TestFunctionName);

            expect(file.relativePath).to.equal('Orders.cs');
            expect(file.values).to.deep.equal(['PlaceOrder', 'CancelOrder']);
        });

        it('does not retain untagged nodes', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/readme.md', '');

            const index = await build(m, [csharpDetector]);

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

            await build(m, [recorder]);

            expect(seen).to.deep.equal(['.', 'src', 'src/App.cs']);
        });

        it('runs detectors in registration order, so later ones see earlier tags', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/host.json', '{}');
            addWorkspaceFile(m, '/repo/App.cs', '[Function("Ping")]');

            // The functions detector only inspects files the C# detector has
            // already recognised as source.
            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(TestFunctionName).flatMap(f => f.values)).to.deep.equal(['Ping']);
        });

        it('resolves the nearest tagged ancestor across untagged directories', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/host.json', '{}');
            addWorkspaceFile(m, '/repo/deeply/nested/App.cs', '[Function("Deep")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(TestFunctionName).flatMap(f => f.values)).to.deep.equal(['Deep']);
        });

        it('does not tag files outside the tagged ancestor', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/api/host.json', '{}');
            addWorkspaceFile(m, '/repo/api/Inside.cs', '[Function("Inside")]');
            addWorkspaceFile(m, '/repo/other/Outside.cs', '[Function("Outside")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(TestFunctionName).flatMap(f => f.values)).to.deep.equal(['Inside']);
        });
    });

    describe('dispatch', () => {
        it('only inspects nodes matching the declared interest', async () => {
            const inspected: string[] = [];
            const detector: WorkspaceDetector = {
                id: 'picky',
                namespace: tagNamespace('picky'),
                files: { names: ['host.json'], suffixes: ['.csproj'] },
                inspect(item) { inspected.push(item.name); },
            };
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/host.json', '{}');
            addWorkspaceFile(m, '/repo/Api.csproj', '');
            addWorkspaceFile(m, '/repo/readme.md', '');

            await build(m, [detector]);

            expect(inspected.sort()).to.deep.equal(['Api.csproj', 'host.json']);
        });

        it('exposes directory contents to directory detectors only', async () => {
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

            await build(m, [detector]);

            expect(sizes.get('.')).to.equal(1);
            // A file node has no children of its own.
            expect(sizes.get('App.cs')).to.equal(0);
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

            await build(m, [reader('a'), reader('b')]);

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

            await expect(build(m, [detector])).to.be.rejectedWith(/detector failed/);
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

function build(
    m: MockVsCodeResult,
    detectors: readonly WorkspaceDetector[],
): Promise<WorkspaceIndex> {
    return buildWorkspaceIndex(m.vscode, detectors);
}


