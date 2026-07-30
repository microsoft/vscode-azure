/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opt-in helper that points the extension's `.vscode-test` directory at a
 * machine-wide cache, so multiple clones/worktrees share one ~1 GB VS Code
 * download instead of each fetching their own.
 *
 * `@vscode/test-electron` resolves its cache as `<cwd>/.vscode-test` and
 * `@vscode/test-cli` never passes a `cachePath`, so a link is the only way to
 * relocate it. Run once per worktree:
 *
 *     pnpm run link-test-cache
 *
 * Set `VSCODE_TEST_CACHE_DIR` to choose the shared location; it defaults to
 * `<homedir>/.vscode-test-cache`. This is deliberately not part of
 * `postinstall`: it writes outside the repo and is useless on CI.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const linkPath = path.resolve('./extensions/vscode-azure/.vscode-test');
const targetPath = path.resolve(process.env.VSCODE_TEST_CACHE_DIR ?? path.join(os.homedir(), '.vscode-test-cache'));

/** Returns the `fs.Stats`-like entry for a path without following symlinks, or `undefined` if it doesn't exist. */
async function lstatOrUndefined(target) {
    try {
        return await fs.lstat(target);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

const existing = await lstatOrUndefined(linkPath);

if (existing?.isSymbolicLink()) {
    const current = await fs.readlink(linkPath);
    if (path.resolve(current) === targetPath) {
        console.log(`Already linked: ${linkPath} -> ${targetPath}`);
        process.exit(0);
    }

    console.log(`Replacing existing link to ${current}`);
    await fs.unlink(linkPath);
} else if (existing) {
    console.error(`Refusing to replace the existing directory at ${linkPath}.`);
    console.error('Delete it first if you want to link it to the shared cache.');
    process.exit(1);
}

await fs.mkdir(targetPath, { recursive: true });
await fs.mkdir(path.dirname(linkPath), { recursive: true });

// 'junction' is Windows-only and is the one link type that doesn't require
// elevation there; it is ignored on other platforms, which get a normal
// directory symlink.
await fs.symlink(targetPath, linkPath, 'junction');

console.log(`Linked ${linkPath} -> ${targetPath}`);
