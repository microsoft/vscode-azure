/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type { ITreeItem } from '../../../vscode/IVsCode';

export class MockTreeItem implements vscode.TreeItem, ITreeItem {
    label?: string | vscode.TreeItemLabel;
    id?: string;
    iconPath?: string | vscode.IconPath;
    description?: string | boolean;
    tooltip?: string | vscode.MarkdownString;
    command?: vscode.Command;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    contextValue?: string;
    resourceUri?: vscode.Uri;

    constructor(labelOrUri: string | vscode.Uri, collapsibleState?: vscode.TreeItemCollapsibleState) {
        if (typeof labelOrUri === 'string') {
            this.label = labelOrUri;
        } else {
            this.resourceUri = labelOrUri;
        }
        this.collapsibleState = collapsibleState;
    }
}
