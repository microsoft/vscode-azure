/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getSafeExecPath } from '../../src/base/getSafeExecPath';

// These tests exercise the real filesystem and Windows PATH-resolution behavior.
describe('getSafeExecPath (integration)', () => {
    // Unique per-name so the process-lifetime cache never collides between tests.
    let counter = 0;
    const uniqueName = () => `azd-safe-exec-test-${process.pid}-${counter++}`;

    let pathDir: string;
    let cwdDir: string;
    const originalPath = process.env.PATH;
    const originalPathExt = process.env.PATHEXT;
    const originalCwd = process.cwd();

    beforeEach(async () => {
        pathDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-exec-path-'));
        cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-exec-cwd-'));
        process.chdir(cwdDir);
        // Deterministic PATH/PATHEXT for the scan.
        process.env.PATH = pathDir;
        process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        if (originalPath === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = originalPath;
        }
        if (originalPathExt === undefined) {
            delete process.env.PATHEXT;
        } else {
            process.env.PATHEXT = originalPathExt;
        }
        await fs.rm(pathDir, { recursive: true, force: true });
        await fs.rm(cwdDir, { recursive: true, force: true });
    });

    it('should return the command unchanged on non-Windows platforms', async function () {
        if (process.platform === 'win32') {
            this.skip();
        }
        const name = uniqueName();
        // Even with a cwd-planted file, non-Windows must not resolve it.
        await fs.writeFile(path.join(cwdDir, name), '');
        expect(await getSafeExecPath(name)).to.equal(name);
    });

    it('should NOT resolve a cwd-planted binary that is not on PATH (Windows)', async function () {
        if (process.platform !== 'win32') {
            this.skip();
        }
        const name = uniqueName();
        // Drop a same-named executable in the cwd only; it must be ignored.
        await fs.writeFile(path.join(cwdDir, `${name}.cmd`), '@echo hijacked');
        expect(await getSafeExecPath(name)).to.equal(name);
    });

    it('should resolve to the PATH copy even when a cwd copy exists (Windows)', async function () {
        if (process.platform !== 'win32') {
            this.skip();
        }
        const name = uniqueName();
        const onPath = path.win32.join(pathDir, `${name}.cmd`);
        await fs.writeFile(onPath, '@echo real');
        // A cwd copy must lose to the PATH copy.
        await fs.writeFile(path.join(cwdDir, `${name}.cmd`), '@echo hijacked');

        const resolved = await getSafeExecPath(name);
        expect(path.win32.normalize(resolved).toLowerCase()).to.equal(path.win32.normalize(onPath).toLowerCase());
    });

    it('should leave an explicit path unchanged (Windows)', async function () {
        if (process.platform !== 'win32') {
            this.skip();
        }
        const explicit = 'C:\\tools\\azd.exe';
        expect(await getSafeExecPath(explicit)).to.equal(explicit);
    });
});
