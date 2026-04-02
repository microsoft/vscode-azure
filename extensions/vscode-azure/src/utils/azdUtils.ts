/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/**
 * Executes the `azd` CLI with the given arguments. Throws an
 * actionable error when `azd` is not installed or not on PATH.
 *
 * TODO: replace with AZD extension API when available
 */
export async function execAzd(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    try {
        return await execFileAsync('azd', args, { cwd });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                'Azure Developer CLI (azd) was not found. Install it from https://aka.ms/azure-dev/install and ensure it is available on your PATH.',
                { cause: error },
            );
        }
        throw error;
    }
}

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
            // file not found -- try next
        }
    }
    return false;
}
