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
 * Returns the path to `azure.yaml` or `azure.yml` in the given
 * directory, or `undefined` if neither exists.
 */
export async function findAzureYaml(directory: string): Promise<string | undefined> {
    for (const name of AzureYamlFileNames) {
        const filePath = path.join(directory, name);
        try {
            await fs.access(filePath);
            return filePath;
        } catch {
            // file not found -- try next
        }
    }
    return undefined;
}
