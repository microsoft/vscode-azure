/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Workspace clean script. Recursively removes build output folders (`dist`,
 * `coverage`) and packaging artifacts (`*.vsix`, `*.tgz`) from the current
 * working directory. Intended to be invoked per workspace via `npm run clean`.
 * Missing folders are ignored.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const folders = ['dist', 'coverage'];
const artifactExtensions = ['.vsix', '.tgz'];

for (const folder of folders) {
    const resolved = path.resolve(folder);
    await fs.rm(resolved, { recursive: true, force: true });
}

const entries = await fs.readdir('.');
for (const entry of entries) {
    if (artifactExtensions.some(ext => entry.endsWith(ext))) {
        await fs.rm(entry, { force: true });
    }
}
