/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';

const from = [
    './LICENSE.md',
    './NOTICE.html',
];

const to = [
    './packages/utils',
    './packages/azutils',
    './extensions/vscode-azure',
];

for (const fromFile of from) {
    for (const toDir of to) {
        await fs.copyFile(fromFile, `${toDir}/${fromFile}`);
    }
}
