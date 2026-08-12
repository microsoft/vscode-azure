/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { buildWorkspaceIndex } from '../../../src/utils/workspaceIndex/buildWorkspaceIndex';
import type { DetectorContext, WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import type { WorkspaceIndex } from '../../../src/utils/workspaceIndex/WorkspaceIndex';
import { StandardTagNames, tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';

// Two independent products that both talk about "source files" -- the case
// namespacing exists for.
const csharp = tagNamespace('csharp');
const CsProjectRoot = csharp.tag(StandardTagNames.projectRoot);
const CsSourceFile = csharp.tag(StandardTagNames.sourceFile);

const node = tagNamespace('node');
const NodeSourceFile = node.tag(StandardTagNames.sourceFile);

const functions = tagNamespace('functions');
const FunctionsProject = functions.tag(StandardTagNames.projectRoot);
const FunctionName = functions.tag<string>('functionName');

/** Tags `.cs` files and the directories holding a `.csproj`. */
const csharpDetector: WorkspaceDetector = {
    id: 'csharp',
    namespace: csharp,
    directories: true,
    files: { suffixes: ['.cs'] },
    inspect(item) {
        if (item.isDirectory) {
            if ([...item.fileNames].some(name => name.endsWith('.csproj'))) {
                item.tag(CsProjectRoot);
            }
        } else {
            item.tag(CsSourceFile);
        }
    },
};

const nodeDetector: WorkspaceDetector = {
    id: 'node',
    namespace: node,
    files: { suffixes: ['.js'] },
    inspect(item) { item.tag(NodeSourceFile); },
};

describe('buildWorkspaceIndex (unit)', () => {
    describe('namespacing', () => {
        it('keeps same-named tags from different namespaces apart', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/App.cs', '');
            addFile(m, '/repo/app.js', '');

            const index = await build(m, [csharpDetector, nodeDetector]);

            expect(paths(index.withTag(CsSourceFile))).to.deep.equal(['App.cs']);
            expect(paths(index.withTag(NodeSourceFile))).to.deep.equal(['app.js']);
        });

        it('finds every namespace with withTagName', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/App.cs', '');
            addFile(m, '/repo/app.js', '');

            const index = await build(m, [csharpDetector, nodeDetector]);

            expect(paths(index.withTagName(StandardTagNames.sourceFile)))
                .to.deep.equal(['App.cs', 'app.js']);
        });

        it('rejects a detector applying another namespace\'s tag', async () => {
            const forger: WorkspaceDetector = {
                id: 'forger',
                namespace: tagNamespace('forger'),
                files: { suffixes: ['.cs'] },
                inspect(item) { item.tag(CsSourceFile); },
            };
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/App.cs', '');

            await assert.rejects(build(m, [forger]), /may only apply tags in namespace 'forger'/);
        });

        it('rejects two detectors sharing a namespace', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            const other: WorkspaceDetector = { ...csharpDetector, id: 'csharp-2' };

            await assert.rejects(build(m, [csharpDetector, other]), /both use the tag namespace/);
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
            addWorkspace(m);
            addFile(m, '/repo/Api.csproj', '');
            addFile(m, '/repo/host.json', '{}');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);
            const root = index.tagsOf(m.vscode.Uri.file('/repo')).map(tag => tag.qualifiedName);

            expect(root).to.have.members(['csharp:projectRoot', 'functions:projectRoot']);
        });

        it('accumulates repeated values for one tag', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/host.json', '{}');
            addFile(m, '/repo/Orders.cs',
                '[Function("PlaceOrder")]\n[Function("CancelOrder")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);
            const [file] = index.withTag(FunctionName);

            expect(file.relativePath).to.equal('Orders.cs');
            expect(file.values).to.deep.equal(['PlaceOrder', 'CancelOrder']);
        });

        it('does not retain untagged nodes', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/readme.md', '');

            const index = await build(m, [csharpDetector]);

            expect(index.tagsOf(m.vscode.Uri.file('/repo/readme.md'))).to.be.empty;
            expect(index.has(m.vscode.Uri.file('/repo/readme.md'), CsSourceFile)).to.be.false;
        });

        it('reports truncation from the underlying walk', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            for (let i = 0; i < 20; i++) {
                addFile(m, `/repo/dir${i}/App.cs`, '');
            }

            const index = await build(m, [csharpDetector], { maxEntries: 5 });

            expect(index.truncated).to.be.true;
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
            addWorkspace(m);
            addFile(m, '/repo/src/App.cs', '');

            await build(m, [recorder]);

            expect(seen).to.deep.equal(['.', 'src', 'src/App.cs']);
        });

        it('runs detectors in registration order, so later ones see earlier tags', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/host.json', '{}');
            addFile(m, '/repo/App.cs', '[Function("Ping")]');

            // The functions detector only inspects files the C# detector has
            // already recognised as source.
            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(FunctionName).flatMap(f => f.values)).to.deep.equal(['Ping']);
        });

        it('resolves the nearest tagged ancestor across untagged directories', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/host.json', '{}');
            addFile(m, '/repo/deeply/nested/App.cs', '[Function("Deep")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(FunctionName).flatMap(f => f.values)).to.deep.equal(['Deep']);
        });

        it('does not tag files outside the tagged ancestor', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/api/host.json', '{}');
            addFile(m, '/repo/api/Inside.cs', '[Function("Inside")]');
            addFile(m, '/repo/other/Outside.cs', '[Function("Outside")]');

            const index = await build(m, [csharpDetector, functionsDetectorFor(['.cs'])]);

            expect(index.withTag(FunctionName).flatMap(f => f.values)).to.deep.equal(['Inside']);
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
            addWorkspace(m);
            addFile(m, '/repo/host.json', '{}');
            addFile(m, '/repo/Api.csproj', '');
            addFile(m, '/repo/readme.md', '');

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
            addWorkspace(m);
            addFile(m, '/repo/App.cs', '');

            await build(m, [detector]);

            expect(sizes.get('.')).to.equal(1);
            // A file node has no children of its own.
            expect(sizes.get('App.cs')).to.equal(0);
        });

        it('reads a file once per detector that asks for it', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/App.cs', 'contents');
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
            addWorkspace(m);

            await assert.rejects(build(m, [detector]), /detector failed/);
        });

        it('throws CancellationError once the token is cancelled', async () => {
            const m = createMockVsCode();
            addWorkspace(m);
            addFile(m, '/repo/a/App.cs', '');
            let checks = 0;
            const token = {
                get isCancellationRequested() { return ++checks > 1; },
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } satisfies vscode.CancellationToken;

            await assert.rejects(
                buildWorkspaceIndex(m.vscode, [csharpDetector], token),
                CancellationError);
        });
    });
});

/**
 * A Functions detector in the shape #178 needs: it tags the project directory,
 * then extracts many function names per source file, reading only files another
 * detector already recognised as source and that sit under a Functions project.
 */
function functionsDetectorFor(suffixes: readonly string[]): WorkspaceDetector {
    return {
        id: 'functions',
        namespace: functions,
        directories: true,
        files: { suffixes: [...suffixes] },
        async inspect(item: DetectorContext) {
            if (item.isDirectory) {
                if (item.fileNames.has('host.json')) {
                    item.tag(FunctionsProject);
                }
                return;
            }

            if (!item.has(CsSourceFile) || !item.ancestor(FunctionsProject)) {
                return;
            }
            const source = await item.text() ?? '';
            for (const match of source.matchAll(/\[Function\("([^"]+)"\)\]/g)) {
                item.tag(FunctionName, match[1]);
            }
        },
    };
}

function build(
    m: MockVsCodeResult,
    detectors: readonly WorkspaceDetector[],
    options?: Parameters<typeof buildWorkspaceIndex>[3],
): Promise<WorkspaceIndex> {
    return buildWorkspaceIndex(m.vscode, detectors, undefined, options);
}

function paths(nodes: readonly { relativePath: string }[]): string[] {
    return nodes.map(item => item.relativePath);
}

function addWorkspace(m: MockVsCodeResult, path = '/repo'): void {
    const uri = m.vscode.Uri.file(path);
    m.workspaceFolders.push({ uri, name: path.slice(1), index: m.workspaceFolders.length });
    m.fs.addDirectory(uri);
}

function addFile(m: MockVsCodeResult, path: string, contents: string): void {
    m.fs.addFile(m.vscode.Uri.file(path), contents);
}
