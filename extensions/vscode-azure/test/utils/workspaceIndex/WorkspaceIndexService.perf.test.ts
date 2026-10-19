/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addWorkspaceFolder, createMockVsCode, fireFileSystemEvent, ManualDebounceScheduler, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { functionsDetector, FunctionsHostFileTag } from '../../../src/functions/functionsDetector';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { WorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';

const directoryCount = 80;
const filesPerDirectory = 50;

// On a local Windows checkout backed by an M.2 SSD, the measured work is
// approximately 60ms for a full build and under 1ms for an incremental update.
// The assertions stay deliberately loose to accommodate slower CI filesystems.
const detectors: readonly WorkspaceDetector[] = [
    functionsDetector,
    ...Array.from({ length: 4 }, (_, index): WorkspaceDetector => ({
        id: `noop-${index}`,
        namespace: `noop-${index}`,
        inspect: () => undefined,
    })),
];

describe('WorkspaceIndexService performance (integration)', () => {
    let fixtureRoot: string;

    before(async function () {
        this.timeout(30_000);
        fixtureRoot = await mkdtemp(join(tmpdir(), 'vscode-azure-workspace-index-'));
        await Promise.all(Array.from({ length: directoryCount }, async (_, directoryIndex) => {
            const directory = join(fixtureRoot, `project-${directoryIndex}`);
            await mkdir(directory);
            await Promise.all([
                writeFile(join(directory, 'host.json'), '{}'),
                ...Array.from({ length: filesPerDirectory }, (_, fileIndex) =>
                    writeFile(join(directory, `source-${fileIndex}.ts`), '')),
            ]);
        }));
    });

    after(async () => {
        await rm(fixtureRoot, { force: true, recursive: true });
    });

    afterEach(() => {
        mock.restoreAll();
    });

    it('indexes a large workspace through the real filesystem within its performance budget', async () => {
        const { service, mock: m } = createRealFileSystemService(fixtureRoot);

        const startedAt = performance.now();
        const index = await service.getIndex();
        const elapsedMs = performance.now() - startedAt;

        expect(index.withTag(FunctionsHostFileTag)).to.have.length(directoryCount);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(directoryCount + 1);
        expect(elapsedMs).to.be.lessThan(5_000);
        service.dispose();
    });

    it('updates one file without rescanning the real filesystem tree', async () => {
        const { service, mock: m, scheduler } = createRealFileSystemService(fixtureRoot);
        await service.getIndex();
        const readsBeforeUpdate = m.fs.readDirectory.mock.callCount();
        const changedFile = join(fixtureRoot, 'project-0', 'host.json');
        await writeFile(changedFile, '{"version":"2.0"}');

        const startedAt = performance.now();
        fireFileSystemEvent(m, changedFile);
        await scheduler.flush();
        const elapsedMs = performance.now() - startedAt;

        expect(m.fs.readDirectory.mock.callCount() - readsBeforeUpdate).to.equal(1);
        expect((await service.getIndex()).withTag(FunctionsHostFileTag)).to.have.length(directoryCount);
        expect(elapsedMs).to.be.lessThan(1_000);
        service.dispose();
    });
});

function createRealFileSystemService(root: string): {
    readonly service: WorkspaceIndexService;
    readonly mock: MockVsCodeResult;
    readonly scheduler: ManualDebounceScheduler;
} {
    const m = createMockVsCode();
    addWorkspaceFolder(m, root);
    useRealFileSystem(m);
    const scheduler = new ManualDebounceScheduler();
    return {
        service: new WorkspaceIndexService(m.vscode, detectors, scheduler),
        mock: m,
        scheduler,
    };
}

/** Routes the workspace filesystem calls used by the index to a real temporary tree. */
function useRealFileSystem(m: MockVsCodeResult): void {
    m.fs.readDirectory.mock.mockImplementation(async uri =>
        (await readdir(uri.fsPath, { withFileTypes: true })).map(entry => [
            entry.name,
            entry.isDirectory() ? m.vscode.FileType.Directory : m.vscode.FileType.File,
        ] satisfies [string, vscode.FileType]));
    m.fs.stat.mock.mockImplementation(async uri => {
        const result = await stat(uri.fsPath);
        return {
            type: result.isDirectory() ? m.vscode.FileType.Directory : m.vscode.FileType.File,
            ctime: result.ctimeMs,
            mtime: result.mtimeMs,
            size: result.size,
        };
    });
}
