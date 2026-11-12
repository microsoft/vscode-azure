/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addWorkspaceFile, addWorkspaceFolder, createMockVsCode, fireFileSystemEvent, ManualDebounceScheduler } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { functionsDetector, FunctionsHostFileTag } from '../../../src/functions/functionsDetector';
import { WorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { Attribute, attributeDetector, csharpDetector } from './mockDetectors';

describe('WorkspaceIndexService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('builds lazily and reuses the result', async () => {
        const { service, mock: m } = createService();

        // Constructing the service must not touch the filesystem.
        expect(m.fs.readDirectory.mock.callCount()).to.equal(0);

        const first = await service.getIndex();
        const reads = m.fs.readDirectory.mock.callCount();
        const second = await service.getIndex();

        expect(reads).to.be.greaterThan(0);
        expect(second).to.equal(first);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(reads);
        service.dispose();
    });

    it('watches everything, with a single string glob', () => {
        const { service, mock: m } = createService();

        const patterns = m.workspace.createFileSystemWatcher.mock.calls.map(call => call.arguments[0]);
        // A narrower pattern would not reduce what crosses into the extension
        // host, and would miss a deleted folder, which is reported as one event
        // for the folder rather than one per file inside it.
        expect(patterns).to.deep.equal(['**']);
        // Strings only: a RelativePattern would start a second recursive watch.
        expect(patterns.every(pattern => typeof pattern === 'string')).to.be.true;
        service.dispose();
    });

    it('rebuilds and notifies when a watched file changes', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        addWorkspaceFile(m, '/repo/api/host.json', '{}');
        fireFileSystemEvent(m, '/repo/api/host.json');
        await scheduler.flush();

        expect(changed).to.equal(1);
        const index = await service.getIndex();
        expect(index.withTag(FunctionsHostFileTag).map(u => u.path))
            .to.deep.equal(['/repo/host.json', '/repo/api/host.json']);
        service.dispose();
    });

    it('ignores events inside excluded directories', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();
        const reads = m.fs.readDirectory.mock.callCount();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        // What an `npm install` produces in bulk.
        for (const path of [
            '/repo/node_modules/left-pad/host.json',
            '/repo/node_modules/a/node_modules/b/host.json',
            '/repo/bin/host.json',
        ]) {
            fireFileSystemEvent(m, path);
        }

        // Nothing was even scheduled, so there is no rebuild to flush.
        expect(scheduler.hasPending).to.be.false;
        expect(changed).to.equal(0);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(reads);
        service.dispose();
    });

    it('does not scan an excluded directory when the directory itself changes', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();
        addWorkspaceFile(m, '/repo/node_modules/dependency/host.json', '{}');
        const readsBeforeUpdate = m.fs.readDirectory.mock.callCount();

        fireFileSystemEvent(m, '/repo/node_modules', 'create');
        await scheduler.flush();

        expect(m.fs.readDirectory.mock.callCount() - readsBeforeUpdate).to.equal(1);
        expect((await service.getIndex()).withTag(FunctionsHostFileTag).map(uri => uri.path))
            .to.deep.equal(['/repo/host.json']);
        service.dispose();
    });

    describe('exclusion boundaries', () => {
        // Paths relative to the `/repo` workspace folder, and whether an event
        // for each should reach the index. An excluded name only counts as a
        // whole path segment, and only as an intermediate one.
        const cases: readonly (readonly [path: string, rebuilds: boolean])[] = [
            ['host.json', true],
            ['api/host.json', true],
            // Excluded names must match a whole segment, not a prefix or suffix.
            ['.github/workflows/ci.yml', true],
            ['binaries/host.json', true],
            ['my-bin/host.json', true],
            // The excluded directory itself appearing or disappearing does
            // change what the walk would find, so it is not ignored.
            ['node_modules', true],
            ['node_modules/left-pad/host.json', false],
            ['a/node_modules/b/host.json', false],
            ['NODE_MODULES/x/host.json', false],
            ['src/bin/host.json', false],
            ['.git/HEAD', false],
        ];

        for (const [path, rebuilds] of cases) {
            it(`${rebuilds ? 'rebuilds for' : 'ignores'} ${path}`, async () => {
                const { service, mock: m, scheduler } = createService();
                await service.getIndex();

                fireFileSystemEvent(m, `/repo/${path}`);

                expect(scheduler.hasPending).to.equal(rebuilds);
                service.dispose();
            });
        }
    });

    it('does not exclude a workspace folder whose own path looks excluded', async () => {
        const m = createMockVsCode();
        addWorkspaceFolder(m, '/home/me/build/site');
        addWorkspaceFile(m, '/home/me/build/site/host.json', '{}');
        const scheduler = new ManualDebounceScheduler();
        const service = new WorkspaceIndexService(m.vscode, [functionsDetector], scheduler);
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        // 'build' is excluded, but only as a segment *within* the folder.
        fireFileSystemEvent(m, '/home/me/build/site/host.json');
        await scheduler.flush();

        expect(changed).to.equal(1);
        service.dispose();
    });

    it('coalesces a burst of events into a single rebuild', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        for (let i = 0; i < 10; i++) {
            fireFileSystemEvent(m, '/repo/host.json');
        }
        await scheduler.flush();

        // The burst collapsed to a single scheduled callback.
        expect(changed).to.equal(1);
        expect(scheduler.hasPending).to.be.false;
        service.dispose();
    });

    it('serializes an event batch behind an update already in progress', async () => {
        const m = createMockVsCode();
        addWorkspaceFolder(m, '/repo');
        addWorkspaceFile(m, '/repo/api/host.json', '{}');
        const scheduler = new ManualDebounceScheduler();
        const service = new WorkspaceIndexService(m.vscode, [functionsDetector], scheduler);
        await service.getIndex();

        const statStarted = Promise.withResolvers<boolean>();
        const releaseStat = Promise.withResolvers<vscode.FileStat>();
        m.fs.stat.mock.mockImplementationOnce(() => {
            statStarted.resolve(true);
            return releaseStat.promise;
        });

        fireFileSystemEvent(m, '/repo/api/host.json');
        const firstUpdate = scheduler.flush();
        await statStarted.promise;

        await m.fs.delete(m.vscode.Uri.file('/repo/api/host.json'));
        fireFileSystemEvent(m, '/repo/api/host.json', 'delete');
        const secondUpdate = scheduler.flush();

        releaseStat.resolve({ type: m.vscode.FileType.File, ctime: 0, mtime: 0, size: 0 });
        await Promise.all([firstUpdate, secondUpdate]);

        expect((await service.getIndex()).withTag(FunctionsHostFileTag)).to.deep.equal([]);
        service.dispose();
    });

    it('rebuilds when workspace folders change', async () => {
        const { service, mock: m } = createService();
        await service.getIndex();
        const reads = m.fs.readDirectory.mock.callCount();

        m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [] });
        await service.getIndex();

        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(reads);
        service.dispose();
    });

    it('does not retain a failed build', async () => {
        const { service, mock: m } = createService();
        m.fs.readDirectory.mock.mockImplementationOnce(
            () => Promise.reject(Object.assign(new Error('denied'), { code: 'NoPermissions' })));

        await expect(service.getIndex()).to.be.rejectedWith('denied');
        const index = await service.getIndex();

        expect(index.withTag(FunctionsHostFileTag)).to.have.length(1);
        service.dispose();
    });

    it('stops watching once disposed', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });
        service.dispose();

        fireFileSystemEvent(m, '/repo/host.json');

        expect(scheduler.hasPending).to.be.false;
        expect(changed).to.equal(0);
    });

    it('evicts a deleted folder and everything under it', async () => {
        const m = createMockVsCode();
        addWorkspaceFolder(m, '/repo');
        addWorkspaceFile(m, '/repo/host.json', '{}');
        addWorkspaceFile(m, '/repo/api/host.json', '{}');
        const scheduler = new ManualDebounceScheduler();
        const service = new WorkspaceIndexService(m.vscode, [functionsDetector], scheduler);

        const index = await service.getIndex();
        expect(index.withTag(FunctionsHostFileTag).map(u => u.path))
            .to.deep.equal(['/repo/host.json', '/repo/api/host.json']);

        // Deleting a folder reports one event for the folder itself, never one
        // per file inside it, so the subtree has to be swept from that alone.
        await m.fs.delete(m.vscode.Uri.file('/repo/api/host.json'));
        await m.fs.delete(m.vscode.Uri.file('/repo/api'));
        fireFileSystemEvent(m, '/repo/api', 'delete');
        await scheduler.flush();

        expect((await service.getIndex()).withTag(FunctionsHostFileTag).map(u => u.path))
            .to.deep.equal(['/repo/host.json']);
        service.dispose();
    });

    it('does not double a tag\'s values when a file is re-inspected', async () => {
        const m = createMockVsCode();
        addWorkspaceFolder(m, '/repo');
        addWorkspaceFile(m, '/repo/Orders.cs', '[Name("PlaceOrder")]');
        const scheduler = new ManualDebounceScheduler();
        const service = new WorkspaceIndexService(
            m.vscode, [csharpDetector, attributeDetector], scheduler);

        const index = await service.getIndex();
        const orders = m.vscode.Uri.file('/repo/Orders.cs');
        expect(index.valuesOf(orders, Attribute)).to.deep.equal(['PlaceOrder']);

        // The node must be evicted before it is inspected again, or its values
        // accumulate on top of the ones already recorded.
        fireFileSystemEvent(m, '/repo/Orders.cs');
        await scheduler.flush();

        expect((await service.getIndex()).valuesOf(orders, Attribute)).to.deep.equal(['PlaceOrder']);
        service.dispose();
    });

    it('picks up a file added after the first build', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();

        addWorkspaceFile(m, '/repo/api/host.json', '{}');
        fireFileSystemEvent(m, '/repo/api/host.json', 'create');
        await scheduler.flush();

        expect((await service.getIndex()).withTag(FunctionsHostFileTag).map(u => u.path))
            .to.deep.equal(['/repo/host.json', '/repo/api/host.json']);
        service.dispose();
    });

    it('does not announce a change when nothing tagged was touched', async () => {
        const { service, mock: m, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        addWorkspaceFile(m, '/repo/readme.md', '');
        fireFileSystemEvent(m, '/repo/readme.md', 'create');
        await scheduler.flush();

        expect(changed).to.equal(0);
        service.dispose();
    });
});

/**
 * Builds a service over a `/repo` workspace containing a root `host.json`, with
 * a scheduler the test can flush on demand. Watchers are reachable through
 * {@linkcode fireFileSystemEvent}.
 */
function createService() {
    const m = createMockVsCode();
    addWorkspaceFolder(m, '/repo');
    addWorkspaceFile(m, '/repo/host.json', '{}');

    const scheduler = new ManualDebounceScheduler();
    return {
        service: new WorkspaceIndexService(m.vscode, [functionsDetector], scheduler),
        mock: m,
        scheduler,
    };
}
