/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from './MockVsCode';
import { MockRelativePattern } from './MockValueTypes';
import { MockUri } from './MockUri';

describe('MockVsCode (unit)', () => {
    describe('workspace.findFiles', () => {
        function seed(...paths: string[]) {
            const m = createMockVsCode();
            for (const path of paths) {
                m.fs.addFile(MockUri.file(path), '{}');
            }
            return m;
        }

        it('matches a basename-only include anywhere, as VS Code resolves relative globs', async () => {
            const m = seed('/repo/host.json', '/repo/src/host.json', '/repo/other.json');

            const found = await m.vscode.workspace.findFiles('host.json');

            expect(found.map(u => u.path)).to.deep.equal(['/repo/host.json', '/repo/src/host.json']);
        });

        it('applies the same basename normalization to the exclude glob', async () => {
            // A bare `node_modules` exclude must behave like `**\/node_modules`,
            // otherwise tests would quietly diverge from real VS Code behavior.
            const m = seed('/repo/package.json', '/repo/node_modules/pkg/package.json');

            const found = await m.vscode.workspace.findFiles('**/package.json', 'node_modules');

            expect(found.map(u => u.path)).to.deep.equal(['/repo/package.json']);
        });

        it('honors a path-shaped exclude glob', async () => {
            const m = seed('/repo/package.json', '/repo/node_modules/pkg/package.json');

            const found = await m.vscode.workspace.findFiles('**/package.json', '**/node_modules/**');

            expect(found.map(u => u.path)).to.deep.equal(['/repo/package.json']);
        });

        it('scopes results to a RelativePattern base', async () => {
            const m = seed('/repo/host.json', '/elsewhere/host.json');

            const found = await m.vscode.workspace.findFiles(
                new MockRelativePattern(MockUri.file('/repo'), '**/host.json'));

            expect(found.map(u => u.path)).to.deep.equal(['/repo/host.json']);
        });

        it('caps results at maxResults', async () => {
            const m = seed('/repo/a/host.json', '/repo/b/host.json', '/repo/c/host.json');

            const found = await m.vscode.workspace.findFiles('**/host.json', undefined, 2);

            expect(found).to.have.length(2);
        });
    });
});
