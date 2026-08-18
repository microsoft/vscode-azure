/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { addWorkspaceFile, addWorkspaceFolder, createMockVsCode, type MockVsCodeResult } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import { walkWorkspace, type ScannedDirectory } from '../../../src/utils/workspaceIndex/walkWorkspace';

describe('walkWorkspace (unit)', () => {
    describe('traversal', () => {
        it('yields directories breadth-first across every workspace folder', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/one');
            addWorkspaceFolder(m, '/two');
            addWorkspaceFile(m, '/one/deep/nested/file.txt', '');
            addWorkspaceFile(m, '/one/top.txt', '');
            addWorkspaceFile(m, '/two/only.txt', '');

            const paths = (await collect(m)).map(d => d.uri.path);

            expect(paths).to.deep.equal(['/one', '/one/deep', '/one/deep/nested', '/two']);
        });

        it('visits entries in name order regardless of filesystem order', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            for (const name of ['zeta', 'alpha', 'mid']) {
                addWorkspaceFile(m, `/repo/${name}/file.txt`, '');
            }

            const paths = (await collect(m)).map(d => d.uri.path);

            expect(paths).to.deep.equal(['/repo', '/repo/alpha', '/repo/mid', '/repo/zeta']);
        });

        it('exposes each directory\'s uri and file names', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/api/host.json', '{}');

            const [, api] = await collect(m);

            expect(api.uri.path).to.equal('/repo/api');
            expect([...api.fileNames]).to.deep.equal(['host.json']);
        });

        it('does not follow directory symlinks', async () => {
            const m = createMockVsCode();
            const folder = addWorkspaceFolder(m, '/repo');
            m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'linked'), m.vscode.FileType.Directory);

            const paths = (await collect(m)).map(d => d.uri.path);

            expect(paths).to.deep.equal(['/repo']);
        });

        it('still lists symlinked files, which cannot cause cycles', async () => {
            const m = createMockVsCode();
            const folder = addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/real.json', '{"linked":true}');
            m.fs.addSymbolicLink(m.vscode.Uri.joinPath(folder.uri, 'link.json'), m.vscode.FileType.File);

            const [root] = await collect(m);

            expect([...root.fileNames]).to.include('link.json');
        });
    });

    describe('exclusions', () => {
        it('skips generated and vendored directories by default', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            for (const name of ['node_modules', 'bin', 'obj', '.venv', '__pycache__', 'dist']) {
                addWorkspaceFile(m, `/repo/${name}/thing.txt`, '');
            }
            addWorkspaceFile(m, '/repo/src/app.cs', '');

            const paths = (await collect(m)).map(d => d.uri.path);

            expect(paths).to.deep.equal(['/repo', '/repo/src']);
        });
    });

    describe('limits and failures', () => {
        it('ignores directories that vanish mid-walk but surfaces other failures', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/gone/file.txt', '');
            m.fs.readDirectory.mock.mockImplementationOnce(
                () => Promise.reject(Object.assign(new Error('denied'), { code: 'NoPermissions' })));

            await expect(collect(m)).to.be.rejectedWith(/denied/);
        });

        it('throws CancellationError once the token is cancelled', async () => {
            const m = createMockVsCode();
            addWorkspaceFolder(m, '/repo');
            addWorkspaceFile(m, '/repo/a/file.txt', '');
            let checks = 0;
            const token = {
                get isCancellationRequested() { return ++checks > 1; },
                onCancellationRequested: () => ({ dispose: () => undefined }),
            } satisfies vscode.CancellationToken;

            await expect(collect(m, token)).to.be.rejectedWith(CancellationError);
        });

        it('yields nothing when no workspace folder is open', async () => {
            expect(await collect(createMockVsCode())).to.be.empty;
        });
    });
});

async function collect(
    m: MockVsCodeResult,
    token?: vscode.CancellationToken,
): Promise<ScannedDirectory[]> {
    const directories: ScannedDirectory[] = [];
    for await (const directory of walkWorkspace(m.vscode, token)) {
        directories.push(directory);
    }
    return directories;
}
