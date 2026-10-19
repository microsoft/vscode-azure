/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExternalError } from '../../src/base/ExternalError';
import { basename, dirname, fileExists, isFileNotFoundError, readJson, readRequiredJson, readText, relativePath } from '../../src/vscode/fsHelpers';
import { MockFileSystem } from './MockFileSystem';
import { MockUri } from './MockUri';
import { createMockVsCode } from './MockVsCode';

describe('fsHelpers (unit)', () => {
    describe('isFileNotFoundError', () => {
        it('returns true for the missing-file error code', () => {
            expect(isFileNotFoundError(Object.assign(new Error('nope'), { code: 'FileNotFound' }))).to.be.true;
        });

        it('returns false for other filesystem errors', () => {
            expect(isFileNotFoundError(Object.assign(new Error('nope'), { code: 'NoPermissions' }))).to.be.false;
        });

        it('returns false for non-errors', () => {
            expect(isFileNotFoundError(new Error('plain'))).to.be.false;
            expect(isFileNotFoundError(undefined)).to.be.false;
            expect(isFileNotFoundError(null)).to.be.false;
            expect(isFileNotFoundError('FileNotFound')).to.be.false;
        });
    });

    describe('relativePath', () => {
        it('returns the path below the base', () => {
            expect(relativePath(MockUri.file('/repo'), MockUri.file('/repo/src/app.ts')))
                .to.equal('src/app.ts');
        });

        it('returns an empty string for the base itself', () => {
            expect(relativePath(MockUri.file('/repo'), MockUri.file('/repo'))).to.equal('');
        });

        it('ignores a trailing slash on the base', () => {
            const base = MockUri.from({ scheme: 'file', path: '/repo/' });
            expect(relativePath(base, MockUri.file('/repo/src'))).to.equal('src');
        });

        it('returns undefined when the uri is outside the base', () => {
            expect(relativePath(MockUri.file('/repo'), MockUri.file('/other/app.ts'))).to.be.undefined;
        });

        it('does not treat a sibling with a shared prefix as inside', () => {
            expect(relativePath(MockUri.file('/repo'), MockUri.file('/repo-other/app.ts'))).to.be.undefined;
        });
    });

    describe('readText', () => {
        it('decodes the file as UTF-8', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/readme.md');
            m.fs.addFile(uri, 'hello');
            expect(await readText(m.vscode, uri)).to.equal('hello');
        });

        it('returns undefined when the file does not exist', async () => {
            const m = createMockVsCode();
            expect(await readText(m.vscode, m.vscode.Uri.file('/project/missing.md'))).to.be.undefined;
        });

        it('propagates other filesystem errors', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/denied.md');
            m.fs.readFile.mock.mockImplementation(
                () => Promise.reject(MockFileSystem.createError('NoPermissions', uri)),
            );

            await expect(readText(m.vscode, uri)).to.be.rejectedWith(/No permissions/);
        });
    });

    describe('readJson', () => {
        it('parses the file contents', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/package.json');
            m.fs.addFile(uri, '{ "name": "test" }');
            expect(await readJson(m.vscode, uri)).to.deep.equal({ name: 'test' });
        });

        it('returns undefined when the file does not exist', async () => {
            const m = createMockVsCode();
            expect(await readJson(m.vscode, m.vscode.Uri.file('/project/missing.json'))).to.be.undefined;
        });

        it('returns undefined for malformed JSON', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/package.json');
            m.fs.addFile(uri, '{ "name": ');
            expect(await readJson(m.vscode, uri)).to.be.undefined;
        });
    });

    describe('readRequiredJson', () => {
        it('returns parsed JSON values for caller validation', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/metadata.json');
            for (const value of [{ name: 'test' }, ['first', 'second'], null, false, 0, 'text']) {
                m.fs.addFile(uri, JSON.stringify(value));
                expect(await readRequiredJson(m.vscode, uri)).to.deep.equal(value);
            }
        });

        it('reports a missing file by basename', async () => {
            const m = createMockVsCode();
            await expect(readRequiredJson(m.vscode, m.vscode.Uri.file('/project/missing.json')))
                .to.be.rejectedWith(ExternalError, 'The file \'missing.json\' is missing.');
        });

        it('reports malformed JSON without including file contents', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/metadata.json');
            m.fs.addFile(uri, '{ "secret": "sensitive-value",');
            await expect(readRequiredJson(m.vscode, uri))
                .to.be.rejectedWith(ExternalError, /^The file 'metadata.json' is not valid JSON\.$/);
        });

        it('propagates other filesystem errors', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/denied.json');
            m.fs.readFile.mock.mockImplementation(
                () => Promise.reject(MockFileSystem.createError('NoPermissions', uri)),
            );
            await expect(readRequiredJson(m.vscode, uri)).to.be.rejectedWith(/No permissions/);
        });
    });

    describe('fileExists', () => {
        it('returns true when the file exists', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/host.json');
            m.fs.addFile(uri, '{}');
            expect(await fileExists(m.vscode, uri)).to.be.true;
        });

        it('returns false when the file does not exist', async () => {
            const m = createMockVsCode();
            const uri = m.vscode.Uri.file('/project/missing.json');
            expect(await fileExists(m.vscode, uri)).to.be.false;
        });
    });

    describe('dirname', () => {
        it('returns the containing directory', () => {
            expect(dirname(MockUri.file('/repo/src/app.ts')).path).to.equal('/repo/src');
        });

        it('is a fixed point at the root, so upward walks terminate', () => {
            const root = dirname(MockUri.file('/repo'));
            expect(root.path).to.equal('/');
            expect(dirname(root).path).to.equal('/');
        });
    });

    describe('basename', () => {
        it('returns the last path segment', () => {
            const uri = MockUri.file('/workspace/my-project');
            expect(basename(uri)).to.equal('my-project');
        });

        it('handles a single segment', () => {
            const uri = MockUri.file('/root');
            expect(basename(uri)).to.equal('root');
        });

        it('ignores trailing slashes', () => {
            const uri = MockUri.from({ scheme: 'file', path: '/workspace/folder/' });
            expect(basename(uri)).to.equal('folder');
        });

        it('falls back to the full path for empty segments', () => {
            const uri = MockUri.from({ scheme: 'untitled', path: '' });
            expect(basename(uri)).to.equal('');
        });
    });
});
