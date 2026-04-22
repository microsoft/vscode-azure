/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

const AzureYamlFileNames = ['azure.yaml', 'azure.yml'];

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
