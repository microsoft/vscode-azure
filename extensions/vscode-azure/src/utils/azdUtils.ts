/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type * as vscode from 'vscode';

const execFileAsync = promisify(execFile);
const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

/**
 * Executes the `azd` CLI with the given arguments.
 *
 * @throws {Error} when `azd` is not installed or not on PATH, wrapping
 *   the underlying `ENOENT` with an actionable install hint. Any other
 *   `execFile` error is rethrown as-is.
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
 * Returns the URI of `azure.yaml` or `azure.yml` in the given
 * directory, or `undefined` if neither exists.
 */
export async function findAzureYaml(code: IVsCode, directory: vscode.Uri): Promise<vscode.Uri | undefined> {
    for (const name of AzureYamlFileNames) {
        const fileUri = code.Uri.joinPath(directory, name);
        try {
            await code.workspace.fs.stat(fileUri);
            return fileUri;
        } catch {
            // file not found -- try next
        }
    }
    return undefined;
}
