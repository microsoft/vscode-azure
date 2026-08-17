/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, ICodeContext, type ITreeItem, type ViewProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { EditSettings } from '../../../commands/settings/EditSettings';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../combineContextValues';
import { ISettingsDataProvider } from './SettingsDataProvider';
import { isSettingsNode } from './SettingsNode';

/**
 * View-layer provider for settings nodes.
 *
 * Renders the settings as a leaf whose single action opens them for editing. No values appear in
 * the tree, so nothing here needs masking.
 *
 * A product that permits only a subset registers its **own** view provider ahead of this one and
 * attaches only the context values it wants: a command whose context value is absent never matches
 * its `when` clause, so the menu item never appears. Enforcement lives in
 * {@linkcode SettingsAdapter.write}, so a restricted resource is safe even if a command is invoked
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
        @inject(ISettingsDataProvider) private readonly settings: ISettingsDataProvider,
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

        // The adapter names the node, so a product can call these something other than
        // "Application Settings". Falls back only if the node outlived its adapter.
        const label = this.settings.getAdapter(node.azureResource)?.label ?? this.ctx.code.l10n.t('Settings');

        const item = new this.ctx.code.TreeItem(label, this.ctx.code.TreeItemCollapsibleState.None);
        item.id = key;
        item.iconPath = new this.ctx.code.ThemeIcon('settings');
        item.contextValue = combineContextValues(EditSettings.ContextValue);
        item.command = {
            command: EditSettings.CommandId,
            title: label,
            arguments: [key],
        };

        return item;
    }

    /** @inheritdoc */
    public getChildren(): Promise<string[]> {
        return Promise.resolve([]);
    }

    /** @inheritdoc */
    public getParent(key: string): string | undefined {
        return AzureNodeId.parse(key).parentNodeId()?.toString();
    }
}
