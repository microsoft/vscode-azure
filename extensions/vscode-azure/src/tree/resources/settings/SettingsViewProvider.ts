/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { EditSettings } from '../../../commands/settings/EditSettings';
import { IAzureViewDataTree } from '../../../services';
import { ISettingsRegistry } from '../../../settings/SettingsRegistry';
import { combineContextValues } from '../../combineContextValues';
import { collectionIdOf, isSettingsCollectionNode, type SettingsCollectionNode } from './SettingsNode';

/**
 * View-layer provider for settings nodes.
 *
 * Renders the collection as a leaf whose single action opens it for editing. No values appear in
 * the tree, so nothing here needs masking.
 *
 * A product that permits only a subset registers its **own** view provider ahead of this one and
 * attaches only the context values it wants: a command whose context value is absent never matches
 * its `when` clause, so the menu item never appears. Enforcement lives in
 * {@linkcode SettingsAdapter.write}, so a restricted collection is safe even if a command is invoked
 * from the palette.
 *
 * @remarks
 * Must be registered **before** the generic view provider in `registerProducts.ts`.
 */
@injectable()
export class SettingsViewProvider implements ViewProvider<string> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        return isSettingsCollectionNode(this.tree.get(resource));
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.tree.get(key);
        if (!isSettingsCollectionNode(node)) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(node));

        return this.getCollectionTreeItem(key, node);
    }

    /** @inheritdoc */
    public getChildren(): Promise<string[]> {
        return Promise.resolve([]);
    }

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    private getCollectionTreeItem(key: string, node: SettingsCollectionNode): ITreeItem {
        const collectionId = collectionIdOf(node);
        const descriptor = this.registry.getCollection(node.azureResource, collectionId);

        const item = new this.ctx.code.TreeItem(
            descriptor?.label ?? collectionId,
            this.ctx.code.TreeItemCollapsibleState.None,
        );
        item.id = key;
        item.iconPath = new this.ctx.code.ThemeIcon('settings');
        item.contextValue = combineContextValues(EditSettings.ContextValue);
        item.command = {
            command: EditSettings.CommandId,
            title: descriptor?.label ?? collectionId,
            arguments: [key],
        };

        return item;
    }
}
