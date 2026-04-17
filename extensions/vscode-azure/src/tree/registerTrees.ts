/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { DataItemTree, type DataProvider, IActionExecutor, IOutputChannel, IVsCode, ViewItemTree, type ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { defaultLoadMoreOptions } from '../commands/LoadMore';
import { ActivityTreeViewId, AzureResourceTreeViewId } from '../constants';
import { IActivityTreeView, IActivityViewDataTree, IActivityViewViewItemTree, IAzureResourceTreeView, IAzureViewDataTree, IAzureViewViewItemTree, pushDisposable } from '../services';
import type { Activity } from './activity/Activity';
import { ActivityViewProvider } from './activity/ActivityViewProvider';
import { ArmDeploymentDataProvider } from './activity/ArmDeploymentDataProvider';
import { ArmDeploymentViewProvider } from './activity/ArmDeploymentViewProvider';
import { CodeDeploymentDataProvider } from './activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider } from './activity/GenericActivityDataProvider';
import { AcrDataProvider } from './resources/acr/AcrDataProvider';
import { AcrViewProvider } from './resources/acr/AcrViewProvider';
import { FunctionAppDataProvider } from './resources/functions/FunctionAppDataProvider';
import { FunctionAppViewProvider } from './resources/functions/FunctionAppViewProvider';
import { GenericAzureDataProvider } from './resources/GenericAzureDataProvider';
import { GenericAzureViewProvider } from './resources/GenericAzureViewProvider';

/**
 * Bind the Azure resources tree and activity tree into the DI container.
 *
 * Wires up the data layer ({@linkcode DataItemTree}), view layer
 * ({@linkcode ViewItemTree}), and VS Code {@linkcode vscode.TreeView TreeView}
 * for each tree, and registers the per-service {@linkcode DataProvider}s and
 * {@linkcode ViewProvider}s. Provider registration order matters: specific
 * providers are bound before the generic fallback so
 * {@linkcode ProviderRegistry} dispatches to the most specific match.
 *
 * Both tree views are eagerly resolved so their construction kicks off
 * the full subscription/resource load.
 */
export function registerTrees(container: Container): void {
    const output = container.get(IOutputChannel);
    const code = container.get(IVsCode);
    output.debug('[view] register resources tree');
    registerResourcesTree(container, output);
    output.debug('[view] register activity tree');
    registerActivityTree(container, output);
    output.info(code.l10n.t('[view] Registered {0} tree views', 2));
}

// #region Resources tree

function registerResourcesTree(container: Container, output: IOutputChannel): void {
    // Resources view: data layer
    bindAzureViewDataProviders(container, output);
    output.debug('[view] bind %s', 'IAzureViewDataTree');
    container.bind(IAzureViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<ConcreteAzureNode>(
            AzureResourceTreeViewId,
            context.get(IActionExecutor),
            resource => AzureNodeId.from(resource).toString(),
            5 * 60 * 1000, // 5 minute TTL
            context.get(IOutputChannel),
        );

        for (const provider of context.getAll(IAzureViewDataProviders)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // Resources view: view layer
    bindAzureViewViewProviders(container, output);
    output.debug('[view] bind %s', 'IAzureViewViewItemTree');
    container.bind(IAzureViewViewItemTree).toDynamicValue(context => {
        const viewItemTree = new ViewItemTree<string, ConcreteAzureNode>(
            AzureResourceTreeViewId,
            context.get(IActionExecutor),
            {
                dataItemTree: context.get(IAzureViewDataTree),
                toViewItem: resource => AzureNodeId.from(resource).toString(),
                getKey: key => key, // Identity mapping since view item is just the `AzureNodeId` string
                getResourceKey: key => key, // Identity mapping since both view and data items use the same key
            },
            defaultLoadMoreOptions(context.get(IVsCode)),
            context.get(IOutputChannel),
        );

        for (const provider of context.getAll(IAzureViewViewProviders)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // Resources view: VSCode tree view
    output.debug('[view] bind %s', 'IAzureResourceTreeView');
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
 * Identifier for the Azure view's {@linkcode DataProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewDataProviders: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureViewDataProviders');
function bindAzureViewDataProviders(container: Container, output: IOutputChannel): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    output.debug('[view] register data provider %s', AcrDataProvider.name);
    container.bind(IAzureViewDataProviders).to(AcrDataProvider).onActivation(pushDisposable);

    // Bind FunctionAppDataProvider as a singleton so commands can inject it
    // directly for cached setting reads/writes, then alias to the multi-bound ID.
    output.debug('[view] register data provider %s', FunctionAppDataProvider.name);
    container.bind(FunctionAppDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    container.bind(IAzureViewDataProviders).toService(FunctionAppDataProvider);

    output.debug('[view] register data provider %s', GenericAzureDataProvider.name);
    container.bind(IAzureViewDataProviders).to(GenericAzureDataProvider).onActivation(pushDisposable);
}

/**
 * Identifier for the Azure view's {@linkcode ViewProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IAzureViewViewProviders');
function bindAzureViewViewProviders(container: Container, output: IOutputChannel): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    output.debug('[view] register view provider %s', AcrViewProvider.name);
    container.bind(IAzureViewViewProviders).to(AcrViewProvider).onActivation(pushDisposable);
    output.debug('[view] register view provider %s', FunctionAppViewProvider.name);
    container.bind(IAzureViewViewProviders).to(FunctionAppViewProvider).onActivation(pushDisposable);
    output.debug('[view] register view provider %s', GenericAzureViewProvider.name);
    container.bind(IAzureViewViewProviders).to(GenericAzureViewProvider).onActivation(pushDisposable);
}

// #endregion

// #region Activity tree

function registerActivityTree(container: Container, output: IOutputChannel): void {
    // Activity view: data layer
    // Bind each provider as a singleton to its own class so commands can inject them directly.
    bindActivityViewDataProviders(container, output);
    output.debug('[view] bind %s', 'IActivityViewDataTree');
    container.bind(IActivityViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<Activity>(
            ActivityTreeViewId,
            context.get(IActionExecutor),
            activity => activity.id,
            Infinity, // Providers manage freshness via polling and change events
            context.get(IOutputChannel),
        );

        for (const provider of context.getAll(IActivityViewDataProviders)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // Activity view: view layer
    bindActivityViewViewProviders(container, output);
    output.debug('[view] bind %s', 'IActivityViewViewItemTree');
    container.bind(IActivityViewViewItemTree).toDynamicValue(context => {
        const viewItemTree = new ViewItemTree<string, Activity>(
            ActivityTreeViewId,
            context.get(IActionExecutor),
            {
                dataItemTree: context.get(IActivityViewDataTree),
                toViewItem: activity => activity.id,
                getKey: key => key,
                getResourceKey: key => key,
            },
            undefined,
            context.get(IOutputChannel),
        );

        for (const provider of context.getAll(IActivityViewViewProviders)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // Activity view: VSCode tree view
    output.debug('[view] bind %s', 'IActivityTreeView');
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
function bindActivityViewDataProviders(container: Container, output: IOutputChannel): void {
    // Bind each provider as a singleton to its own class first, then alias
    // to IActivityViewDataProviders so they can be resolved both individually
    // (for commands that call track methods) and collectively (for the data tree).
    output.debug('[view] register data provider %s', ArmDeploymentDataProvider.name);
    container.bind(ArmDeploymentDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(ArmDeploymentDataProvider);

    output.debug('[view] register data provider %s', CodeDeploymentDataProvider.name);
    container.bind(CodeDeploymentDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(CodeDeploymentDataProvider);

    output.debug('[view] register data provider %s', GenericActivityDataProvider.name);
    container.bind(GenericActivityDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(GenericActivityDataProvider);
}

const IActivityViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IActivityViewViewProviders');
function bindActivityViewViewProviders(container: Container, output: IOutputChannel): void {
    // Registration order matters: specific providers first, generic fallback last.
    output.debug('[view] register view provider %s', ArmDeploymentViewProvider.name);
    container.bind(IActivityViewViewProviders).to(ArmDeploymentViewProvider).onActivation(pushDisposable);
    output.debug('[view] register view provider %s', ActivityViewProvider.name);
    container.bind(IActivityViewViewProviders).to(ActivityViewProvider).onActivation(pushDisposable);
}

// #endregion
