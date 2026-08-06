/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { DataItemTree, type DataProvider, IActionExecutor, IVsCode, type LoadMoreOptions, ViewItemTree, type ViewProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ResolutionContext, ServiceIdentifier } from 'inversify';
import { defaultLoadMoreOptions } from '../commands/tree/LoadMore';
import { ActivityTreeViewId, AzureResourceTreeViewId, WorkspaceTreeViewId } from '../constants';
import type { ProductRegistrar, ProviderEntry } from '../registration/ProductRegistrar';
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
import { AzureAccountDataProvider, IAzureAccountDataProvider } from './resources/AzureAccountDataProvider';
import { AzureResourceDataProvider } from './resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from './resources/GenericAzureViewProvider';
import { AzdWorkspaceDataProvider } from './workspace/azd/AzdWorkspaceDataProvider';
import { AzdWorkspaceViewProvider } from './workspace/azd/AzdWorkspaceViewProvider';
import { EmulatorsWorkspaceDataProvider } from './workspace/emulators/EmulatorsWorkspaceDataProvider';
import { EmulatorsWorkspaceViewProvider } from './workspace/emulators/EmulatorsWorkspaceViewProvider';
import { FunctionsWorkspaceDataProvider } from './workspace/functions/FunctionsWorkspaceDataProvider';
import { FunctionsWorkspaceViewProvider } from './workspace/functions/FunctionsWorkspaceViewProvider';
import type { WorkspaceNode } from './workspace/WorkspaceNode';

/**
 * Bind the Azure resources tree, workspace tree, and activity tree into the
 * DI container.
 *
 * Provider registration order matters: specific providers are bound before
 * the generic fallback so {@linkcode ProviderRegistry} dispatches to the
 * most specific match.
 *
 * All tree views are eagerly resolved so their construction kicks off
 * the full subscription/resource load.
 */
export function registerTrees(container: Container, products?: ProductRegistrar): void {
    // Resources tree
    registerTree<ConcreteAzureNode>(container, {
        treeViewId: AzureResourceTreeViewId,
        dataTreeId: IAzureViewDataTree,
        viewItemTreeId: IAzureViewViewItemTree,
        treeViewServiceId: IAzureResourceTreeView,
        dataProvidersId: IAzureViewDataProviders,
        viewProvidersId: IAzureViewViewProviders,
        getKey: resource => AzureNodeId.from(resource).toString(),
        ttl: 5 * 60 * 1000, // 5 minute TTL
        loadMoreOptions: context => defaultLoadMoreOptions(context.get(IVsCode)),
        // Registration order matters: specific providers first, generic fallback last.
        dataProviders: [
            ...products?.getResourceDataProviders() ?? [],
            [IAzureAccountDataProvider, AzureAccountDataProvider], // singleton so mock-data mode can rebind it
            AzureResourceDataProvider,
        ],
        viewProviders: [
            ...products?.getResourceViewProviders() ?? [],
            GenericAzureViewProvider,
        ],
    });

    // Workspace tree
    registerTree<WorkspaceNode>(container, {
        treeViewId: WorkspaceTreeViewId,
        dataTreeId: IWorkspaceViewDataTree,
        viewItemTreeId: IWorkspaceViewViewItemTree,
        treeViewServiceId: IWorkspaceTreeView,
        dataProvidersId: IWorkspaceViewDataProviders,
        viewProvidersId: IWorkspaceViewViewProviders,
        getKey: node => node.id,
        // Workspace discovery is cheap (filesystem stats); refresh every
        // minute so newly-added `azure.yaml` / `host.json` files appear.
        ttl: 60 * 1000,
        dataProviders: [
            AzdWorkspaceDataProvider,
            FunctionsWorkspaceDataProvider,
            EmulatorsWorkspaceDataProvider,
        ],
        viewProviders: [
            AzdWorkspaceViewProvider,
            FunctionsWorkspaceViewProvider,
            EmulatorsWorkspaceViewProvider,
        ],
    });

    // Activity tree
    registerTree<Activity>(container, {
        treeViewId: ActivityTreeViewId,
        dataTreeId: IActivityViewDataTree,
        viewItemTreeId: IActivityViewViewItemTree,
        treeViewServiceId: IActivityTreeView,
        dataProvidersId: IActivityViewDataProviders,
        viewProvidersId: IActivityViewViewProviders,
        getKey: activity => activity.id,
        ttl: Infinity, // Providers manage freshness via polling and change events
        // Singleton+alias tuples so commands can @inject each provider directly.
        dataProviders: [
            [IArmDeploymentDataProvider, ArmDeploymentDataProvider],
            [ICodeDeploymentDataProvider, CodeDeploymentDataProvider],
            [IGenericActivityDataProvider, GenericActivityDataProvider],
        ],
        viewProviders: [
            ArmDeploymentViewProvider,
            ActivityViewProvider, // generic fallback last
        ],
    });
}

// #region Internal provider collection identifiers

const IAzureViewDataProviders: ServiceIdentifier<DataProvider<ConcreteAzureNode>> = Symbol.for('IAzureViewDataProviders');
const IAzureViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IAzureViewViewProviders');
const IWorkspaceViewDataProviders: ServiceIdentifier<DataProvider<WorkspaceNode>> = Symbol.for('IWorkspaceViewDataProviders');
const IWorkspaceViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IWorkspaceViewViewProviders');
const IActivityViewDataProviders: ServiceIdentifier<DataProvider<Activity>> = Symbol.for('IActivityViewDataProviders');
const IActivityViewViewProviders: ServiceIdentifier<ViewProvider<string>> = Symbol.for('IActivityViewViewProviders');

// #endregion

// #region Binding glue

/**
 * A provider entry for declarative binding. Either a bare class (simple
 * binding to the collection) or a `[primaryId, Class]` tuple that binds
 * the class as a singleton under `primaryId` and aliases it into the
 * collection, so commands can `@inject(primaryId)` directly.
 */
/**
 * Configuration for {@linkcode registerTree}. All three trees share
 * the same wiring pattern; only these parameters vary.
 */
interface TreeConfig<TData> {
    readonly treeViewId: string;
    readonly dataTreeId: ServiceIdentifier<DataItemTree<TData>>;
    readonly viewItemTreeId: ServiceIdentifier<ViewItemTree<string, TData>>;
    readonly treeViewServiceId: ServiceIdentifier;
    readonly dataProvidersId: ServiceIdentifier<DataProvider<TData>>;
    readonly viewProvidersId: ServiceIdentifier<ViewProvider<string>>;
    readonly getKey: (resource: TData) => string;
    readonly ttl: number;
    readonly loadMoreOptions?: (context: ResolutionContext) => LoadMoreOptions<string>;
    readonly dataProviders: readonly ProviderEntry<DataProvider<TData>>[];
    readonly viewProviders: readonly ProviderEntry<ViewProvider<string>>[];
}

/**
 * Bind provider entries to a collection {@linkcode ServiceIdentifier}.
 * Bare classes are bound directly; `[primaryId, Class]` tuples are
 * bound as singletons under `primaryId` and aliased into the collection.
 */
export function bindProviders<T>(container: Container, collectionId: ServiceIdentifier<T>, entries: readonly ProviderEntry<T>[]): void {
    for (const entry of entries) {
        if (typeof entry === 'function') {
            container.bind(collectionId).to(entry).onActivation(pushDisposable);
        } else {
            const [primaryId, providerClass] = entry;
            // An override (e.g. the "Run (Mock Data)" entry point) may have
            // already bound `primaryId` before the trees are registered.
            if (!container.isBound(primaryId)) {
                container.bind(primaryId).to(providerClass).inSingletonScope().onActivation(pushDisposable);
            }
            container.bind(collectionId).toService(primaryId);
        }
    }
}

/**
 * Generic helper that wires up the data layer ({@linkcode DataItemTree}),
 * view layer ({@linkcode ViewItemTree}), and VS Code
 * {@linkcode vscode.TreeView TreeView} for a single tree, then eagerly
 * resolves the tree view to kick off the load chain.
 */
function registerTree<TData>(container: Container, config: TreeConfig<TData>): void {
    // Data layer
    bindProviders(container, config.dataProvidersId, config.dataProviders);
    container.bind(config.dataTreeId).toDynamicValue(context => {
        const cache = new DataItemTree<TData>(
            context.get(IVsCode),
            config.treeViewId,
            context.get(IActionExecutor),
            config.getKey,
            config.ttl,
        );

        for (const provider of context.getAll(config.dataProvidersId)) {
            cache.registerProvider(provider);
        }

        return cache;
    }).inSingletonScope().onActivation(pushDisposable);

    // View layer
    bindProviders(container, config.viewProvidersId, config.viewProviders);
    container.bind(config.viewItemTreeId).toDynamicValue(context => {
        const viewItemTree = new ViewItemTree<string, TData>(
            config.treeViewId,
            context.get(IActionExecutor),
            {
                dataItemTree: context.get(config.dataTreeId),
                toViewItem: config.getKey,
                getKey: key => key,
                getResourceKey: key => key,
            },
            config.loadMoreOptions?.(context),
        );

        for (const provider of context.getAll(config.viewProvidersId)) {
            viewItemTree.registerProvider(provider);
        }

        return viewItemTree;
    }).inSingletonScope().onActivation(pushDisposable);

    // VS Code tree view
    container.bind(config.treeViewServiceId).toDynamicValue(context => {
        const code = context.get(IVsCode);
        return code.window.createTreeView(config.treeViewId, {
            treeDataProvider: context.get(config.viewItemTreeId),
            showCollapseAll: true,
            canSelectMany: false,
        });
    }).inSingletonScope().onActivation(pushDisposable);

    // Eagerly resolve the tree view to kick off the whole chain
    container.get(config.treeViewServiceId);
}

// #endregion
