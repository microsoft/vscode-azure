/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IVsCode, type LoadMoreOptions, createDefaultLoadMoreOptions } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import { LoadMoreCommandId } from '../constants';
import { IAzureViewViewItemTree } from '../services';
import type { ManagedCommand } from './ManagedCommand';

@injectable()
export class LoadMore implements ManagedCommand {
    public constructor(
        @inject(IAzureViewViewItemTree) private readonly viewItemTree: IAzureViewViewItemTree,
    ) { }

    public async execute(parentViewItem: string): Promise<void> {
        await this.viewItemTree.loadMore(parentViewItem);
    }
}

/**
 * Default {@link LoadMoreOptions} implementation for Azure resource trees
 */
export function defaultLoadMoreOptions(code: IVsCode): LoadMoreOptions<string> {
    return createDefaultLoadMoreOptions<string>({
        createLoadMoreViewItem: key => key,
        getTreeItem: (parentViewItem, loading) => {
            const item = new code.TreeItem(
                loading ? code.l10n.t('Loading...') : code.l10n.t('Load More...'),
                code.TreeItemCollapsibleState.None,
            );

            if (!loading) {
                item.command = {
                    command: LoadMoreCommandId,
                    title: '',
                    arguments: [parentViewItem],
                };
            } else {
                item.iconPath = new code.ThemeIcon('loading~spin');
            }

            return item;
        },
    });
}
