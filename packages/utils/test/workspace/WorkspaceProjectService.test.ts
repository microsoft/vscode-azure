/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { WorkspaceProjectService } from '../../src/workspace/WorkspaceProjectService';
import { createMockVsCode, type MockVsCodeResult } from '../vscode/MockVsCode';

describe('WorkspaceProjectService (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('scans once and reuses the result until something changes', async () => {
        const m = createMockVsCode();
        setUpRepo(m);
        const service = new WorkspaceProjectService(m.vscode);

        const first = await service.getProjects();
        const reads = m.fs.readDirectory.mock.callCount();
        const second = await service.getProjects();

        expect(first.map(p => p.relativePath)).to.deep.equal(['.']);
        expect(second).to.deep.equal(first);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(reads);
        service.dispose();
    });

    it('watches with string globs so no additional recursive watcher is created', () => {
        const m = createMockVsCode();
        setUpRepo(m);

        const service = new WorkspaceProjectService(m.vscode);

        const patterns = m.workspace.createFileSystemWatcher.mock.calls.map(call => call.arguments[0]);
        expect(patterns).to.have.lengthOf(2);
        // Strings only: a RelativePattern would start a second recursive watch.
        expect(patterns.every(pattern => typeof pattern === 'string')).to.be.true;
        expect(patterns.some(pattern => typeof pattern === 'string' && pattern.includes('package.json'))).to.be.true;
        expect(patterns).to.include('**/.gitignore');
        service.dispose();
    });

    it('rescans and notifies when a project file changes', async () => {
        const m = createMockVsCode();
        const watchers = captureWatchers(m);
        setUpRepo(m);
        const service = new WorkspaceProjectService(m.vscode);
        await service.getProjects();
        const reads = m.fs.readDirectory.mock.callCount();

        let changed = 0;
        service.onDidChangeProjects(() => { changed++; });

        addFile(m, '/repo/api/package.json', packageJson({ vue: '1.0.0' }));
        await fireAndSettle(watchers, m, '/repo/api/package.json');

        expect(changed).to.equal(1);
        const projects = await service.getProjects();
        expect(projects.map(p => p.relativePath)).to.deep.equal(['.', 'api']);
        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(reads);
        service.dispose();
    });

    it('ignores events for gitignored and generated paths', async () => {
        const m = createMockVsCode();
        const watchers = captureWatchers(m);
        setUpRepo(m);
        addFile(m, '/repo/.gitignore', 'secret/\n');
        const service = new WorkspaceProjectService(m.vscode);
        await service.getProjects();
        const reads = m.fs.readDirectory.mock.callCount();

        let changed = 0;
        service.onDidChangeProjects(() => { changed++; });

        // The marker glob also matches manifests under node_modules, which is
        // exactly what an `npm install` produces in bulk.
        for (const path of [
            '/repo/node_modules/left-pad/package.json',
            '/repo/node_modules/a/node_modules/b/package.json',
            '/repo/dist/package.json',
            '/repo/secret/package.json',
        ]) {
            await fireAndSettle(watchers, m, path);
        }

        expect(changed).to.equal(0);
        expect(m.fs.readDirectory.mock.callCount()).to.equal(reads);
        service.dispose();
    });

    it('coalesces a burst of events into a single rescan', async () => {
        const m = createMockVsCode();
        const watchers = captureWatchers(m);
        setUpRepo(m);
        const service = new WorkspaceProjectService(m.vscode);
        await service.getProjects();

        let changed = 0;
        service.onDidChangeProjects(() => { changed++; });

        mock.timers.enable({ apis: ['setTimeout'] });
        for (let i = 0; i < 10; i++) {
            fire(watchers, m, '/repo/package.json');
        }
        await flush();
        mock.timers.tick(600);
        mock.timers.reset();

        expect(changed).to.equal(1);
        service.dispose();
    });

    it('reacts to an edited gitignore', async () => {
        const m = createMockVsCode();
        const watchers = captureWatchers(m);
        setUpRepo(m);
        addFile(m, '/repo/.gitignore', 'api/\n');
        addFile(m, '/repo/api/package.json', packageJson({ vue: '1.0.0' }));
        const service = new WorkspaceProjectService(m.vscode);

        expect((await service.getProjects()).map(p => p.relativePath)).to.deep.equal(['.']);

        addFile(m, '/repo/.gitignore', '\n');
        await fireAndSettle(watchers, m, '/repo/.gitignore');

        expect((await service.getProjects()).map(p => p.relativePath)).to.deep.equal(['.', 'api']);
        service.dispose();
    });

    it('rescans when workspace folders change', async () => {
        const m = createMockVsCode();
        const folder = setUpRepo(m);
        const service = new WorkspaceProjectService(m.vscode);
        await service.getProjects();
        const reads = m.fs.readDirectory.mock.callCount();

        m.workspaceFoldersChangeEmitter.fire({ added: [], removed: [folder] });
        await service.getProjects();

        expect(m.fs.readDirectory.mock.callCount()).to.be.greaterThan(reads);
        service.dispose();
    });

    it('does not retain a failed scan', async () => {
        const m = createMockVsCode();
        setUpRepo(m);
        m.fs.readDirectory.mock.mockImplementationOnce(
            () => Promise.reject(Object.assign(new Error('denied'), { code: 'NoPermissions' })));
        const service = new WorkspaceProjectService(m.vscode);

        await expectRejection(service.getProjects(), 'denied');
        const projects = await service.getProjects();

        expect(projects.map(p => p.relativePath)).to.deep.equal(['.']);
        service.dispose();
    });

    it('stops watching once disposed', async () => {
        const m = createMockVsCode();
        const watchers = captureWatchers(m);
        setUpRepo(m);
        const service = new WorkspaceProjectService(m.vscode);
        await service.getProjects();

        let changed = 0;
        service.onDidChangeProjects(() => { changed++; });
        service.dispose();

        await fireAndSettle(watchers, m, '/repo/package.json');

        expect(changed).to.equal(0);
    });
});

interface CapturedWatcher {
    readonly pattern: string;
    fire(uri: vscode.Uri): void;
}

/**
 * Replaces `createFileSystemWatcher` with watchers whose events the test can
 * drive, applying the same glob filtering VS Code would.
 */
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
        const matches = watcher.pattern === '**/.gitignore'
            ? name === '.gitignore'
            : watcher.pattern.includes(`{`) && watcher.pattern.slice(watcher.pattern.indexOf('{') + 1, -1)
                .split(',').some(alt => alt.startsWith('*') ? name.endsWith(alt.slice(1)) : alt === name);
        if (matches) {
            watcher.fire(m.vscode.Uri.file(path));
        }
    }
}

async function fireAndSettle(watchers: readonly CapturedWatcher[], m: MockVsCodeResult, path: string): Promise<void> {
    mock.timers.enable({ apis: ['setTimeout'] });
    fire(watchers, m, path);
    await flush();
    mock.timers.tick(600);
    mock.timers.reset();
    await flush();
}

/** Lets the async event filter settle while timers are faked. */
async function flush(turns = 5): Promise<void> {
    for (let i = 0; i < turns; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

async function expectRejection(promise: Promise<unknown>, message: string): Promise<void> {
    try {
        await promise;
    } catch (error) {
        expect(String(error)).to.contain(message);
        return;
    }
    expect.fail(`expected rejection containing "${message}"`);
}

function setUpRepo(m: MockVsCodeResult): vscode.WorkspaceFolder {
    const uri = m.vscode.Uri.file('/repo');
    const folder = { uri, name: 'repo', index: 0 };
    m.workspaceFolders.push(folder);
    m.fs.addDirectory(uri);
    addFile(m, '/repo/package.json', packageJson({ react: '1.0.0' }));
    return folder;
}

function addFile(m: MockVsCodeResult, path: string, contents: string): void {
    m.fs.addFile(m.vscode.Uri.file(path), contents);
}

function packageJson(dependencies: Readonly<Record<string, string>>): string {
    return JSON.stringify({ dependencies });
}
