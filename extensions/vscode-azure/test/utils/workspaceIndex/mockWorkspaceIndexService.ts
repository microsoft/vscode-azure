/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '@microsoft/vscode-azure-utils';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { MutableWorkspaceIndex } from '../../../src/utils/workspaceIndex/WorkspaceIndex';
import type { IWorkspaceIndexService } from '../../../src/utils/workspaceIndex/WorkspaceIndexService';

/** Creates a queryable index of tagged URIs without scanning or watching a workspace. */
export function createMockWorkspaceIndexService(tagged: Readonly<Record<string, readonly vscode.Uri[]>> = {}): IWorkspaceIndexService {
    const index = new MutableWorkspaceIndex();
    for (const [tag, uris] of Object.entries(tagged)) {
        for (const uri of uris) {
            index.add(uri, tag, undefined);
        }
    }
    return {
        getIndex: mock.fn(() => Promise.resolve(index)),
        onDidChangeIndex: new EventEmitter<void>().event,
    };
}
