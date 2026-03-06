/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { DataItemTree, type DataProvider, type ITreeItem, IVsCode, ViewItemTree, type ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { AzureResourceTreeViewId, LoadMoreCommandId } from '../constants';
import { IAzureResourceTreeView, IAzureViewDataTree, IAzureViewViewItemTree, pushDisposable } from '../services';
import { AcrDataProvider } from './acr/AcrDataProvider';
import { AcrViewProvider } from './acr/AcrViewProvider';
import { GenericAzureDataProvider } from './GenericAzureDataProvider';
import { GenericAzureViewProvider } from './GenericAzureViewProvider';

export function registerTrees(container: Container): void {
    // Resources view: data layer
    bindAzureViewDataProviders(container);
    container.bind(IAzureViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<ConcreteAzureNode>(
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000, // 5 minute TTL
        );

        for (const provider of context.getAll(IAzureViewDataProviders)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // Resources view: view layer
    bindAzureViewViewProviders(container);
    container.bind(IAzureViewViewItemTree).toDynamicValue(context => {
        const code = context.get(IVsCode);
        const loadMoreSuffix = '/~loadMore';

        const viewItemTree = new ViewItemTree<string, ConcreteAzureNode>(
            context.get(IAzureViewDataTree),
            resource => AzureNodeId.from(resource).toString(),
            key => key, // Identity mapping since view item is just the `AzureNodeId` string
            {
                isLoadMoreViewItem: key => key.endsWith(loadMoreSuffix),
                getLoadMoreViewItem: parentKey => parentKey + loadMoreSuffix,
                getParentViewItem: loadMoreKey => loadMoreKey.slice(0, -loadMoreSuffix.length),
                getTreeItem: (parentViewItem, loading) => defaultLoadMoreTreeItem(code, parentViewItem, loading),
            },
        );

        for (const provider of context.getAll(IAzureViewViewProviders)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // Resources view: VSCode tree view
    container.bind(IAzureResourceTreeView).toDynamicValue(context => {
        const code = context.get(IVsCode);
        return code.window.createTreeView(AzureResourceTreeViewId, {
            treeDataProvider: context.get(IAzureViewViewItemTree),
            showCollapseAll: true,
            canSelectMany: false,
        });
    }).inSingletonScope().onActivation(pushDisposable);

    // Eagerly resolve the tree view to kick off the whole chain
    container.get(IAzureResourceTreeView);
}

/**
 * Identifier for the Azure view's {@link DataProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewDataProviders: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureViewDataProviders');
function bindAzureViewDataProviders(container: Container): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    container.bind(IAzureViewDataProviders).to(AcrDataProvider).onActivation(pushDisposable);
    container.bind(IAzureViewDataProviders).to(GenericAzureDataProvider).onActivation(pushDisposable);
}

/**
 * Identifier for the Azure view's {@link ViewProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IAzureViewViewProviders');
function bindAzureViewViewProviders(container: Container): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    container.bind(IAzureViewViewProviders).to(AcrViewProvider).onActivation(pushDisposable);
    container.bind(IAzureViewViewProviders).to(GenericAzureViewProvider).onActivation(pushDisposable);
}

function defaultLoadMoreTreeItem(code: IVsCode, parentViewItem: string, loading: boolean): ITreeItem {
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
}
