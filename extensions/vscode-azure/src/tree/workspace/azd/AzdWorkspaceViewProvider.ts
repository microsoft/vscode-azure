/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ITreeItem, ViewProvider } from '@microsoft/vscode-azure-utils';
import { IActionExecutor, IVsCode, basename } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { RevealInExplorer } from '../../../commands/RevealInExplorer';
import { IWorkspaceViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { AzdProjectKeyPrefix, AzdServiceKeyPrefix, isAzdProjectNode, isAzdServiceNode, type AzdProjectNode, type AzdServiceNode } from '../WorkspaceNode';

/**
 * View-layer provider for {@linkcode AzdProjectNode}s and their
 * {@linkcode AzdServiceNode} children.
 *
 * Dispatch is by key prefix so other workspace view providers
 * (functions, emulators) coexist on the same tree without overlap.
 */
@injectable()
export class AzdWorkspaceViewProvider implements ViewProvider<string> {
    public readonly isRoot = true;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IWorkspaceViewDataTree) private readonly dataTree: IWorkspaceViewDataTree,
    ) { }

    /** @inheritdoc */
    public canHandle(key: unknown): key is string {
        return typeof key === 'string'
            && (key.startsWith(AzdProjectKeyPrefix) || key.startsWith(AzdServiceKeyPrefix));
    }

    /** @inheritdoc */
    public async getChildren(key?: string): Promise<string[]> {
        const parent = key ? this.dataTree.get(key) : undefined;
        if (key && !parent) {
            return [];
        }
        const children = await this.dataTree.getChildren(parent);
        // At root, only return our own nodes (azd projects); peer
        // providers contribute their own root nodes independently.
        return children
            .filter(child => isAzdProjectNode(child) || isAzdServiceNode(child))
            .map(child => child.id);
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.dataTree.get(key);
        if (!node) {
            throw new Error(`Azd workspace node with key ${key} not found in cache`);
        }

        if (isAzdProjectNode(node)) {
            this.executor.setTelProp('nodeType', node.type);
            return toAzdProjectTreeItem(this.code, node);
        }
        if (isAzdServiceNode(node)) {
            this.executor.setTelProp('nodeType', node.type);
            return toAzdServiceTreeItem(this.code, node);
        }

        throw new Error(`Unexpected node type for key ${key}: ${(node as { type?: string }).type ?? 'unknown'}`);
    }
}

/** Exported for unit testing. */
export function toAzdProjectTreeItem(code: IVsCode, node: AzdProjectNode): ITreeItem {
    const item = new code.TreeItem(node.label, code.TreeItemCollapsibleState.Collapsed);
    item.id = node.id;
    item.description = code.l10n.t('Azure Developer CLI');
    item.iconPath = new code.ThemeIcon('rocket');
    item.resourceUri = node.azureYamlUri;
    item.contextValue = combineContextValues(RevealInExplorer.ContextValue);
    item.tooltip = node.azureYamlUri.path;
    return item;
}

/** Exported for unit testing. */
export function toAzdServiceTreeItem(code: IVsCode, node: AzdServiceNode): ITreeItem {
    const item = new code.TreeItem(node.label, code.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.iconPath = new code.ThemeIcon('package');
    if (node.resourceUri) {
        item.description = basename(node.resourceUri);
        item.resourceUri = node.resourceUri;
        item.contextValue = combineContextValues(RevealInExplorer.ContextValue);
        item.tooltip = node.resourceUri.path;
    } else {
        item.description = code.l10n.t('No project folder');
    }
    return item;
}
