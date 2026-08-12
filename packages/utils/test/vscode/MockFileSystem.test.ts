/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { MockFileSystem, MockFileType } from './MockFileSystem';
import { MockUri } from './MockUri';

describe('MockFileSystem (unit)', () => {
    describe('addFile', () => {
        it('implicitly creates the parent directories', async () => {
            const fs = new MockFileSystem();
            fs.addFile(MockUri.file('/repo/src/app.ts'), 'contents');

            expect(fs.directories).to.include('/repo');
            expect(fs.directories).to.include('/repo/src');
            expect((await fs.stat(MockUri.file('/repo/src'))).type).to.equal(MockFileType.Directory);
        });
    });

    describe('writeFile', () => {
        it('implicitly creates the parent directories, like the real filesystem', async () => {
            const fs = new MockFileSystem();
            await fs.writeFile(MockUri.file('/repo/out/bundle.js'), Buffer.from('code'));

            const entries = await fs.readDirectory(MockUri.file('/repo/out'));
            expect(entries).to.deep.equal([['bundle.js', MockFileType.File]]);
        });
    });

    describe('addSymbolicLink', () => {
        it('stats as a link combined with its target type', async () => {
            const fs = new MockFileSystem();
            fs.addSymbolicLink(MockUri.file('/repo/link'), MockFileType.Directory);

            const stat = await fs.stat(MockUri.file('/repo/link'));
            expect(stat.type).to.equal(MockFileType.SymbolicLink | MockFileType.Directory);
        });

        it('is not followed to a target', async () => {
            const fs = new MockFileSystem();
            fs.addSymbolicLink(MockUri.file('/repo/link'), MockFileType.Directory);

            await expect(fs.readDirectory(MockUri.file('/repo/link'))).to.be.rejectedWith(/File not found/);
        });
    });

    describe('readDirectory', () => {
        it('returns only the direct children, with their types', async () => {
            const fs = new MockFileSystem();
            fs.addFile(MockUri.file('/repo/package.json'), '{}');
            fs.addFile(MockUri.file('/repo/src/app.ts'), '');
            fs.addDirectory(MockUri.file('/repo/dist'));
            fs.addSymbolicLink(MockUri.file('/repo/link'), MockFileType.File);

            const entries = await fs.readDirectory(MockUri.file('/repo'));

            expect([...entries].sort()).to.deep.equal([
                ['dist', MockFileType.Directory],
                ['link', MockFileType.SymbolicLink | MockFileType.File],
                ['package.json', MockFileType.File],
                ['src', MockFileType.Directory],
            ]);
        });

        it('rejects for a directory that does not exist', async () => {
            const fs = new MockFileSystem();
            await expect(fs.readDirectory(MockUri.file('/missing'))).to.be.rejectedWith(/File not found/);
        });
    });

    describe('delete', () => {
        it('removes files, directories, and symbolic links', async () => {
            const fs = new MockFileSystem();
            const link = MockUri.file('/repo/link');
            fs.addSymbolicLink(link, MockFileType.File);

            await fs.delete(link);

            expect(fs.symbolicLinks.has(link.path)).to.be.false;
        });
    });
});
