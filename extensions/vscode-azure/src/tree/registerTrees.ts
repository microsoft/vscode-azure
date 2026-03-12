/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { DataItemTree, type DataProvider, IVsCode, ViewItemTree, type ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { defaultLoadMoreOptions } from '../commands/LoadMore';
import { ActivityTreeViewId, AzureResourceTreeViewId } from '../constants';
import { IActivityTreeView, IActivityViewDataTree, IActivityViewViewItemTree, IAzureResourceTreeView, IAzureViewDataTree, IAzureViewViewItemTree, pushDisposable } from '../services';
import type { Activity } from './activity/Activity';
import { ActivityViewProvider } from './activity/ActivityViewProvider';
import { ArmDeploymentDataProvider } from './activity/ArmDeploymentDataProvider';
import { CodeDeploymentDataProvider } from './activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider } from './activity/GenericActivityDataProvider';
import { AcrDataProvider } from './resources/acr/AcrDataProvider';
import { AcrViewProvider } from './resources/acr/AcrViewProvider';
import { GenericAzureDataProvider } from './resources/GenericAzureDataProvider';
import { GenericAzureViewProvider } from './resources/GenericAzureViewProvider';

export function registerTrees(container: Container): void {
    registerResourcesTree(container);
    registerActivityTree(container);
}

// #region Resources tree

function registerResourcesTree(container: Container): void {
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
        const viewItemTree = new ViewItemTree<string, ConcreteAzureNode>(
            {
                dataItemTree: context.get(IAzureViewDataTree),
                toViewItem: resource => AzureNodeId.from(resource).toString(),
                getKey: key => key, // Identity mapping since view item is just the `AzureNodeId` string
                getResourceKey: key => key, // Identity mapping since both view and data items use the same key
            },
            defaultLoadMoreOptions(context.get(IVsCode)),
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

// #endregion

// #region Activity tree

function registerActivityTree(container: Container): void {
    // Activity view: data layer
    bindActivityViewDataProviders(container);
    container.bind(IActivityViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<Activity>(
            activity => activity.id,
            5 * 60 * 1000, // 5 minute TTL
        );

        for (const provider of context.getAll(IActivityViewDataProviders)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // Activity view: view layer
    bindActivityViewViewProviders(container);
    container.bind(IActivityViewViewItemTree).toDynamicValue(context => {
        const viewItemTree = new ViewItemTree<string, Activity>(
            {
                dataItemTree: context.get(IActivityViewDataTree),
                toViewItem: activity => activity.id,
                getKey: key => key, // Identity mapping since view item is just the `TODO` string
                getResourceKey: key => key, // Identity mapping since both view and data items use the same key
            },
            defaultLoadMoreOptions(context.get(IVsCode)),
        );

        for (const provider of context.getAll(IActivityViewViewProviders)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // Activity view: VSCode tree view
    container.bind(IActivityTreeView).toDynamicValue(context => {
        const code = context.get(IVsCode);
        return code.window.createTreeView(ActivityTreeViewId, {
            treeDataProvider: context.get(IActivityViewViewItemTree),
            showCollapseAll: true,
            canSelectMany: false,
        });
    }).inSingletonScope().onActivation(pushDisposable);

    // Eagerly resolve the tree view to kick off the whole chain
    container.get(IActivityTreeView);
}

const IActivityViewDataProviders: ServiceIdentifier<DataProvider<Activity>> = Symbol.for('IActivityViewDataProviders');
function bindActivityViewDataProviders(container: Container): void {
    container.bind(IActivityViewDataProviders).to(ArmDeploymentDataProvider).onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).to(CodeDeploymentDataProvider).onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).to(GenericActivityDataProvider).onActivation(pushDisposable);
}

const IActivityViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IActivityViewViewProviders');
function bindActivityViewViewProviders(container: Container): void {
    container.bind(IActivityViewViewProviders).to(ActivityViewProvider).onActivation(pushDisposable);
}

// #endregion
