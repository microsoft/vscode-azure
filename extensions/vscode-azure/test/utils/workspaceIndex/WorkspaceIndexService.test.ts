/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addWorkspaceFile, createMockVsCode, ManualDebounceScheduler, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { azdDetector } from '../../../src/tree/workspace/azd/AzdWorkspaceDataProvider';
import { functionsDetector, FunctionsHostFile } from '../../../src/tree/workspace/functions/FunctionsWorkspaceDataProvider';
import type { WorkspaceDetector } from '../../../src/utils/workspaceIndex/WorkspaceDetector';
import { watchPattern, WorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';
import { tagNamespace } from '../../../src/utils/workspaceIndex/WorkspaceTag';

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

    it('watches only the declared files, with string globs', () => {
        const { service, mock: m } = createService();

        const patterns = m.workspace.createFileSystemWatcher.mock.calls.map(call => call.arguments[0]);
        expect(patterns).to.deep.equal(['**/{host.json}']);
        // Strings only: a RelativePattern would start a second recursive watch.
        expect(patterns.every(pattern => typeof pattern === 'string')).to.be.true;
        service.dispose();
    });

    it('rebuilds and notifies when a watched file changes', async () => {
        const { service, mock: m, watchers, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        addWorkspaceFile(m, '/repo/api/host.json', '{}');
        fire(watchers, m, '/repo/api/host.json');
        await scheduler.flush();

        expect(changed).to.equal(1);
        const index = await service.getIndex();
        expect(index.withTag(FunctionsHostFile).map(n => n.relativePath))
            .to.deep.equal(['host.json', 'api/host.json']);
        service.dispose();
    });

    it('ignores events inside excluded directories', async () => {
        const { service, mock: m, watchers, scheduler } = createService();
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
            fire(watchers, m, path);
        }

        // Nothing was even scheduled, so there is no rebuild to flush.
        expect(scheduler.hasPending).to.be.false;
        expect(changed).to.equal(0);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(reads);
        service.dispose();
    });

    it('coalesces a burst of events into a single rebuild', async () => {
        const { service, mock: m, watchers, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });

        for (let i = 0; i < 10; i++) {
            fire(watchers, m, '/repo/host.json');
        }
        await scheduler.flush();

        // The burst collapsed to a single scheduled callback.
        expect(changed).to.equal(1);
        expect(scheduler.hasPending).to.be.false;
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

        expect(index.withTag(FunctionsHostFile)).to.have.length(1);
        service.dispose();
    });

    it('stops watching once disposed', async () => {
        const { service, mock: m, watchers, scheduler } = createService();
        await service.getIndex();

        let changed = 0;
        service.onDidChangeIndex(() => { changed++; });
        service.dispose();

        fire(watchers, m, '/repo/host.json');

        expect(scheduler.hasPending).to.be.false;
        expect(changed).to.equal(0);
    });

    describe('watchPattern', () => {
        it('merges every detector interest into one glob', () => {
            // No shipped detector declares suffixes yet, so this one stands in for that half.
            const suffixes: WorkspaceDetector = {
                id: 'suffixes',
                namespace: tagNamespace('suffixes'),
                files: { suffixes: ['.csproj'] },
                inspect() { /* no-op */ },
            };

            expect(watchPattern([functionsDetector, azdDetector, suffixes]))
                .to.equal('**/{*.csproj,azure.yaml,azure.yml,host.json}');
        });

        it('watches nothing when no detector declares files', () => {
            const directoriesOnly: WorkspaceDetector = {
                id: 'dirs',
                namespace: tagNamespace('dirs'),
                directories: true,
                inspect() { /* no-op */ },
            };

            expect(watchPattern([directoriesOnly])).to.be.undefined;
        });
    });
});

interface CapturedWatcher {
    readonly pattern: string;
    fire(uri: vscode.Uri): void;
}

/**
 * Builds a service over a `/repo` workspace containing a root `host.json`, with
 * watchers the test can drive and a scheduler it can flush on demand.
 */
function createService() {
    const m = createMockVsCode();
    const watchers = captureWatchers(m);
    const uri = m.vscode.Uri.file('/repo');
    m.workspaceFolders.push({ uri, name: 'repo', index: 0 });
    m.fs.addDirectory(uri);
    addWorkspaceFile(m, '/repo/host.json', '{}');

    const scheduler = new ManualDebounceScheduler();
    return {
        service: new WorkspaceIndexService(m.vscode, [functionsDetector], scheduler),
        mock: m,
        watchers,
        scheduler,
    };
}

/** Replaces `createFileSystemWatcher` with watchers the test can drive. */
function captureWatchers(m: MockVsCodeResult): CapturedWatcher[] {
    const captured: CapturedWatcher[] = [];
    m.workspace.createFileSystemWatcher.mock.mockImplementation((pattern: unknown) => {
        const listeners: ((uri: vscode.Uri) => void)[] = [];
        const register = (listener: (uri: vscode.Uri) => void) => {
            listeners.push(listener);
            return { dispose: () => { listeners.splice(listeners.indexOf(listener), 1); } };
        };
        captured.push({
            pattern: typeof pattern === 'string' ? pattern : '',
            fire: uri => { for (const listener of [...listeners]) { listener(uri); } },
        });
        return {
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
            onDidCreate: register,
            onDidChange: register,
            onDidDelete: register,
            dispose: () => { listeners.length = 0; },
        };
    });
    return captured;
}

/** Fires the watcher whose glob matches `path`, mirroring VS Code's filtering. */
function fire(watchers: readonly CapturedWatcher[], m: MockVsCodeResult, path: string): void {
    const name = path.split('/').pop() ?? path;
    for (const watcher of watchers) {
        const alternatives = watcher.pattern.includes('{')
            ? watcher.pattern.slice(watcher.pattern.indexOf('{') + 1, -1).split(',')
            : [watcher.pattern.replace('**/', '')];
        const matches = alternatives.some(alternative => alternative.startsWith('*')
            ? name.endsWith(alternative.slice(1))
            : alternative === name);
        if (matches) {
            watcher.fire(m.vscode.Uri.file(path));
        }
    }
}
