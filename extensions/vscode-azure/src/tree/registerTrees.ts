/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { DataItemTree, type DataProvider, IActionExecutor, IVsCode, ViewItemTree, type ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { defaultLoadMoreOptions } from '../commands/LoadMore';
import { ActivityTreeViewId, AzureResourceTreeViewId, WorkspaceTreeViewId } from '../constants';
import {
    IActivityTreeView, IActivityViewDataTree, IActivityViewViewItemTree,
    IAzureResourceTreeView, IAzureViewDataTree, IAzureViewViewItemTree,
    IWorkspaceTreeView, IWorkspaceViewDataTree, IWorkspaceViewViewItemTree, pushDisposable,
} from '../services';
import type { Activity } from './activity/Activity';
import { ActivityViewProvider } from './activity/ActivityViewProvider';
import { ArmDeploymentDataProvider, IArmDeploymentDataProvider } from './activity/ArmDeploymentDataProvider';
import { ArmDeploymentViewProvider } from './activity/ArmDeploymentViewProvider';
import { CodeDeploymentDataProvider, ICodeDeploymentDataProvider } from './activity/CodeDeploymentDataProvider';
import { GenericActivityDataProvider, IGenericActivityDataProvider } from './activity/GenericActivityDataProvider';
import { AcrDataProvider } from './resources/acr/AcrDataProvider';
import { AcrViewProvider } from './resources/acr/AcrViewProvider';
import { FunctionAppDataProvider } from './resources/functions/FunctionAppDataProvider';
import { FunctionAppViewProvider } from './resources/functions/FunctionAppViewProvider';
import { GenericAzureDataProvider } from './resources/GenericAzureDataProvider';
import { GenericAzureViewProvider } from './resources/GenericAzureViewProvider';
import { AzdWorkspaceDataProvider } from './workspace/azd/AzdWorkspaceDataProvider';
import { AzdWorkspaceViewProvider } from './workspace/azd/AzdWorkspaceViewProvider';
import { EmulatorsWorkspaceDataProvider } from './workspace/emulators/EmulatorsWorkspaceDataProvider';
import { EmulatorsWorkspaceViewProvider } from './workspace/emulators/EmulatorsWorkspaceViewProvider';
import { FunctionsWorkspaceDataProvider } from './workspace/functions/FunctionsWorkspaceDataProvider';
import { FunctionsWorkspaceViewProvider } from './workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from './workspace/WorkspaceNode';

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
    registerResourcesTree(container);
    registerWorkspaceTree(container);
    registerActivityTree(container);
}

// #region Resources tree

function registerResourcesTree(container: Container): void {
    // Resources view: data layer
    bindAzureViewDataProviders(container);
    container.bind(IAzureViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<ConcreteAzureNode>(
            context.get(IVsCode),
            AzureResourceTreeViewId,
            context.get(IActionExecutor),
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
            AzureResourceTreeViewId,
            context.get(IActionExecutor),
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
 * Identifier for the Azure view's {@linkcode DataProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewDataProviders: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureViewDataProviders');
function bindAzureViewDataProviders(container: Container): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    container.bind(IAzureViewDataProviders).to(AcrDataProvider).onActivation(pushDisposable);

    // Bind FunctionAppDataProvider as a singleton so commands can inject it
    // directly for cached setting reads/writes, then alias to the multi-bound ID.
    container.bind(FunctionAppDataProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    container.bind(IAzureViewDataProviders).toService(FunctionAppDataProvider);

    container.bind(IAzureViewDataProviders).to(GenericAzureDataProvider).onActivation(pushDisposable);
}

/**
 * Identifier for the Azure view's {@linkcode ViewProvider}s.
 * @internal - Not intended for use outside this file
 */
const IAzureViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IAzureViewViewProviders');
function bindAzureViewViewProviders(container: Container): void {
    // Registration order matters: specific providers first, generic fallback last.
    // ProviderRegistry.findProvider() returns the first match.
    container.bind(IAzureViewViewProviders).to(AcrViewProvider).onActivation(pushDisposable);
    container.bind(IAzureViewViewProviders).to(FunctionAppViewProvider).onActivation(pushDisposable);
    container.bind(IAzureViewViewProviders).to(GenericAzureViewProvider).onActivation(pushDisposable);
}

// #endregion

// #region Workspace tree

function registerWorkspaceTree(container: Container): void {
    // Workspace view: data layer
    bindWorkspaceViewDataProviders(container);
    container.bind(IWorkspaceViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<WorkspaceNode>(
            context.get(IVsCode),
            WorkspaceTreeViewId,
            context.get(IActionExecutor),
            node => node.id,
            // Workspace discovery is cheap (filesystem stats); refresh every
            // minute so newly-added `azure.yaml` / `host.json` files appear.
            60 * 1000,
        );

        for (const provider of context.getAll(IWorkspaceViewDataProviders)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // Workspace view: view layer
    bindWorkspaceViewViewProviders(container);
    container.bind(IWorkspaceViewViewItemTree).toDynamicValue(context => {
        const viewItemTree = new ViewItemTree<string, WorkspaceNode>(
            WorkspaceTreeViewId,
            context.get(IActionExecutor),
            {
                dataItemTree: context.get(IWorkspaceViewDataTree),
                toViewItem: node => node.id,
                getKey: key => key,
                getResourceKey: key => key,
            },
            undefined,
        );

        for (const provider of context.getAll(IWorkspaceViewViewProviders)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // Workspace view: VSCode tree view
    container.bind(IWorkspaceTreeView).toDynamicValue(context => {
        const code = context.get(IVsCode);
        return code.window.createTreeView(WorkspaceTreeViewId, {
            treeDataProvider: context.get(IWorkspaceViewViewItemTree),
            showCollapseAll: true,
            canSelectMany: false,
        });
    }).inSingletonScope().onActivation(pushDisposable);

    container.get(IWorkspaceTreeView);
}

/**
 * Identifier for the Workspace view's {@linkcode DataProvider}s.
 * @internal - Not intended for use outside this file
 */
const IWorkspaceViewDataProviders: ServiceIdentifier<DataProvider<WorkspaceNode>> = Symbol.for('IWorkspaceViewDataProviders');
function bindWorkspaceViewDataProviders(container: Container): void {
    // Registration order matters: specific providers first. Each provider's
    // `canHandle` is narrow (it matches only its own node variants), so
    // ordering here mainly affects the *appearance order* at the root.
    container.bind(IWorkspaceViewDataProviders).to(AzdWorkspaceDataProvider).onActivation(pushDisposable);
    container.bind(IWorkspaceViewDataProviders).to(FunctionsWorkspaceDataProvider).onActivation(pushDisposable);
    container.bind(IWorkspaceViewDataProviders).to(EmulatorsWorkspaceDataProvider).onActivation(pushDisposable);
}

/**
 * Identifier for the Workspace view's {@linkcode ViewProvider}s.
 * @internal - Not intended for use outside this file
 */
const IWorkspaceViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IWorkspaceViewViewProviders');
function bindWorkspaceViewViewProviders(container: Container): void {
    // Each provider dispatches on its own key prefix, so order here mainly
    // affects root-children ordering.
    container.bind(IWorkspaceViewViewProviders).to(AzdWorkspaceViewProvider).onActivation(pushDisposable);
    container.bind(IWorkspaceViewViewProviders).to(FunctionsWorkspaceViewProvider).onActivation(pushDisposable);
    container.bind(IWorkspaceViewViewProviders).to(EmulatorsWorkspaceViewProvider).onActivation(pushDisposable);
}

// #endregion

// #region Activity tree

function registerActivityTree(container: Container): void {
    // Activity view: data layer
    // Bind each provider as a singleton to its own class so commands can inject them directly.
    bindActivityViewDataProviders(container);
    container.bind(IActivityViewDataTree).toDynamicValue(context => {
        const cache = new DataItemTree<Activity>(
            context.get(IVsCode),
            ActivityTreeViewId,
            context.get(IActionExecutor),
            activity => activity.id,
            Infinity, // Providers manage freshness via polling and change events
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
            ActivityTreeViewId,
            context.get(IActionExecutor),
            {
                dataItemTree: context.get(IActivityViewDataTree),
                toViewItem: activity => activity.id,
                getKey: key => key,
                getResourceKey: key => key,
            },
            undefined,
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
    // Bind each provider as a singleton to its symbol, then alias
    // to IActivityViewDataProviders so they can be resolved both individually
    // (for commands that call track methods) and collectively (for the data tree).
    container.bind(IArmDeploymentDataProvider).to(ArmDeploymentDataProvider).inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(IArmDeploymentDataProvider);

    container.bind(ICodeDeploymentDataProvider).to(CodeDeploymentDataProvider).inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(ICodeDeploymentDataProvider);

    container.bind(IGenericActivityDataProvider).to(GenericActivityDataProvider).inSingletonScope().onActivation(pushDisposable);
    container.bind(IActivityViewDataProviders).toService(IGenericActivityDataProvider);
}

const IActivityViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IActivityViewViewProviders');
function bindActivityViewViewProviders(container: Container): void {
    // Registration order matters: specific providers first, generic fallback last.
    container.bind(IActivityViewViewProviders).to(ArmDeploymentViewProvider).onActivation(pushDisposable);
    container.bind(IActivityViewViewProviders).to(ActivityViewProvider).onActivation(pushDisposable);
}

// #endregion
