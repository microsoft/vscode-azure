/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { basename, fileExists, isFileNotFoundError, relativePath } from '../../src/vscode/fsHelpers';
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
