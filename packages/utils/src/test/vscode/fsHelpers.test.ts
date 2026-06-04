/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { basename, fileExists } from '../../vscode/fsHelpers';
import { MockUri } from './MockUri';
import { createMockVsCode } from './MockVsCode';

describe('fsHelpers (unit)', () => {
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
