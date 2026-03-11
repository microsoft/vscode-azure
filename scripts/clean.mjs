/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

const folders = ['dist', 'coverage', '.nyc_output'];

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
