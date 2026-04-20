/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Workspace clean script. Recursively removes build output folders (`dist`,
 * `coverage`) from the current working directory. Intended to be invoked per
 * workspace via `npm run clean`. Missing folders are ignored.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const folders = ['dist', 'coverage'];

for (const folder of folders) {
    const resolved = path.resolve(folder);
    try {
        await fs.rm(resolved, { recursive: true });
        console.log(`Removed ${resolved}`);
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }
}
