/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/**
 * Checks whether the given directory contains an `azure.yaml` or
 * `azure.yml` file, indicating an existing azd project.
 */
export async function isAzdProject(directory: string): Promise<boolean> {
    for (const name of AzureYamlFileNames) {
        try {
            await fs.access(path.join(directory, name));
            return true;
        } catch {
            // file not found — try next
        }
    }
    return false;
}
