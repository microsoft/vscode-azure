/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { AddOrEditSetting } from '../../../commands/settings/AddOrEditSetting';
import { CopySettingValue } from '../../../commands/settings/CopySettingValue';
import { DeleteSetting } from '../../../commands/settings/DeleteSetting';
import { EditSettings } from '../../../commands/settings/EditSettings';
import { RenameSetting } from '../../../commands/settings/RenameSetting';
import { ToggleSettingValueVisibility } from '../../../commands/settings/ToggleSettingValueVisibility';
import { IAzureViewDataTree } from '../../../services';
import { ISettingsRegistry } from '../../../settings/SettingsRegistry';
import { ISettingsValueVisibility } from '../../../settings/SettingsValueVisibility';
import { combineContextValues } from '../../combineContextValues';
import {
    collectionIdOf, createCollectionNode, isSettingsCollectionNode, isSettingsEntryNode, isSettingsNode,
    settingKeyOf, type SettingsCollectionNode, type SettingsEntryNode,
} from './SettingsNode';

/** Placeholder rendered in place of a hidden value. */
const MaskedValue = '\u2022'.repeat(8);

/**
 * View-layer provider for settings nodes.
 *
 * Renders the collection category and each individual setting, and attaches the context values for
 * the full shared command set.
 *
 * A product that permits only a subset registers its **own** view provider ahead of this one and
 * attaches only the context values it wants: a command whose context value is absent never matches
 * its `when` clause, so the menu item never appears. That is the same mechanism every other tree
 * node uses, which is why there is no separate capability model here. Enforcement lives in
 * {@linkcode SettingsAdapter.write}, so a restricted collection is safe even if a command is invoked
 * from the palette.
 *
 * @remarks
 * Must be registered **before** the generic view provider in `registerTrees.ts`.
 */
@injectable()
export class SettingsViewProvider implements ViewProvider<string> {
    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly tree: IAzureViewDataTree,
        @inject(ISettingsRegistry) private readonly registry: ISettingsRegistry,
        @inject(ISettingsValueVisibility) private readonly visibility: ISettingsValueVisibility,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }

        return isSettingsNode(this.tree.get(resource));
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const node = this.tree.get(key);
        if (!isSettingsNode(node)) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(node));

        return isSettingsCollectionNode(node)
            ? this.getCollectionTreeItem(key, node)
            : this.getEntryTreeItem(key, node);
    }

    /** @inheritdoc */
    public async getChildren(key?: string): Promise<string[]> {
        if (!key) {
            return [];
        }

        const node = this.tree.get(key);
        if (!node) {
            return [];
        }

        const children = await this.tree.getChildren(node);
        return children.map(child => AzureNodeId.from(child).toString());
    }

    /**
     * @inheritdoc
     *
     * An entry's parent is its **collection**, not the owning resource.
     * {@linkcode AzureNodeId.parentNodeId} models the ARM hierarchy, in which a virtual node's
     * parent is the resource, so it would skip a level here and break `reveal()`.
     */
    public getParent(key: string): string | undefined {
        const node = this.tree.get(key);

        if (isSettingsEntryNode(node)) {
            return AzureNodeId.from(createCollectionNode(node.azureResource, collectionIdOf(node))).toString();
        }

        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }

    private getCollectionTreeItem(key: string, node: SettingsCollectionNode): ITreeItem {
        const collectionId = collectionIdOf(node);
        const descriptor = this.registry.getCollection(node.azureResource, collectionId);

        const item = new this.ctx.code.TreeItem(
            descriptor?.label ?? collectionId,
            this.ctx.code.TreeItemCollapsibleState.Collapsed,
        );
        item.id = key;
        item.iconPath = new this.ctx.code.ThemeIcon('settings');
        item.contextValue = combineContextValues(...this.collectionContextValues());

        return item;
    }

    private getEntryTreeItem(key: string, node: SettingsEntryNode): ITreeItem {
        const item = new this.ctx.code.TreeItem(settingKeyOf(node), this.ctx.code.TreeItemCollapsibleState.None);
        item.id = key;
        item.iconPath = new this.ctx.code.ThemeIcon('symbol-key');
        item.description = this.describeValue(node);
        item.contextValue = combineContextValues(...this.entryContextValues());

        return item;
    }

    /**
     * The text shown beside a setting's name. Masked by default, since the resources tree is often
     * visible during screen shares.
     */
    private describeValue(node: SettingsEntryNode): string {
        return this.visibility.showValues ? node.value : MaskedValue;
    }

    private collectionContextValues(): string[] {
        return [
            EditSettings.ContextValue,
            ToggleSettingValueVisibility.ContextValue,
            AddOrEditSetting.AddContextValue,
        ];
    }

    private entryContextValues(): string[] {
        return [
            EditSettings.ContextValue,
            CopySettingValue.ContextValue,
            ToggleSettingValueVisibility.ContextValue,
            AddOrEditSetting.EditContextValue,
            RenameSetting.ContextValue,
            DeleteSetting.ContextValue,
        ];
    }
}
