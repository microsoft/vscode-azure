/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { IWorkspaceViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { isEmulatorNode, isEmulatorsGroupNode, type EmulatorNode, type EmulatorsGroupNode } from '../WorkspaceNode';

const EmulatorsKeyPrefix = 'workspace://emulator';

/** View-layer provider for the emulators group and its emulator children. */
@injectable()
export class EmulatorsWorkspaceViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceViewDataTree) private readonly dataTree: IWorkspaceViewDataTree,
    ) { }

    /** @inheritdoc */
    public canHandle(key: unknown): key is string {
        return typeof key === 'string' && key.startsWith(EmulatorsKeyPrefix);
    }

    /** @inheritdoc */
    public async getChildren(key?: string): Promise<string[]> {
        const parent = key ? this.dataTree.get(key) : undefined;
        if (key && !parent) {
            return [];
        }
        const children = await this.dataTree.getChildren(parent);
        return children
            .filter(child => isEmulatorsGroupNode(child) || isEmulatorNode(child))
            .map(child => child.id);
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.dataTree.get(key);
        if (isEmulatorsGroupNode(node)) {
            this.executor.setTelProp('nodeType', node.type);
            return toEmulatorsGroupTreeItem(this.code, node);
        }
        if (isEmulatorNode(node)) {
            this.executor.setTelProp('nodeType', node.type);
            return toEmulatorTreeItem(this.code, node);
        }
        throw new Error(`Emulators workspace node with key ${key} not found in cache`);
    }
}

/** Exported for unit testing. */
export function toEmulatorsGroupTreeItem(code: IVsCode, node: EmulatorsGroupNode): ITreeItem {
    const item = new code.TreeItem(node.label, code.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.iconPath = new code.ThemeIcon('server-environment');
    item.contextValue = combineContextValues('emulatorsGroup');
    return item;
}

/** Exported for unit testing. */
export function toEmulatorTreeItem(code: IVsCode, node: EmulatorNode): ITreeItem {
    const item = new code.TreeItem(node.label, code.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    item.iconPath = new code.ThemeIcon('debug-disconnect');
    item.contextValue = combineContextValues('emulator');
    return item;
}
