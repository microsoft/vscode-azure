/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem } from '@microsoft/vscode-azure-utils';
import * as vscode from 'vscode';
import { ExtensionId } from '../../src/constants';

/** Compares a rendered node with the actual manifest menu's view and context-value predicates. */
export function treeMenuMatches(command: string, view: string, item: ITreeItem): boolean {
    const extension = vscode.extensions.getExtension(ExtensionId);
    if (!extension) {
        throw new Error('The extension manifest is unavailable.');
    }
    const manifest = extension.packageJSON as {
        readonly contributes: { readonly menus: Readonly<Record<string, readonly { readonly command: string; readonly when: string }[]>> };
    };
    const entry = manifest.contributes.menus['view/item/context']
        .find(menu => menu.command === command && menu.when.includes(`view == ${view}`));
    const pattern = entry && /viewItem =~ \/(.+)\/(i?)/.exec(entry.when);
    if (!pattern) {
        throw new Error(`The context menu for ${command} in ${view} is unavailable.`);
    }
    return new RegExp(pattern[1], pattern[2]).test(item.contextValue ?? '');
}
