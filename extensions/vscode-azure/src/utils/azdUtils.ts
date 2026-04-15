/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

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
 * Returns the URI of `azure.yaml` or `azure.yml` in the given
 * directory, or `undefined` if neither exists.
 */
export async function findAzureYaml(code: IVsCode, directory: vscode.Uri): Promise<vscode.Uri | undefined> {
    const pattern = new code.RelativePattern(directory, '{azure.yaml,azure.yml}');
    const files = await code.workspace.findFiles(pattern, undefined, 1);
    return files[0];
}
