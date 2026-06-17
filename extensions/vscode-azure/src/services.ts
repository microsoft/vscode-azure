/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, ConcreteAzureNode, ConcreteAzureNodeTree } from '@microsoft/vscode-azure-azutils';
import { type DataItemTree, Disposable, IExtensionContext, type ViewItemTree } from '@microsoft/vscode-azure-utils';
import type { ResolutionContext, ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { Activity } from './tree/activity/Activity';
import type { WorkspaceNode } from './tree/workspace/WorkspaceNode';

// #region Azure resource tree and view identifiers

/** Identifier for the Azure resource tree cache (representing real Azure resources) */
export const IAzureViewDataTree: ServiceIdentifier<IAzureViewDataTree> = Symbol.for('IAzureViewDataTree');
export type IAzureViewDataTree = ConcreteAzureNodeTree;

/** Identifier for the Azure resource view-item tree (view layer) */
export const IAzureViewViewItemTree: ServiceIdentifier<IAzureViewViewItemTree> = Symbol.for('IAzureViewViewItemTree');
export type IAzureViewViewItemTree = ViewItemTree<string, ConcreteAzureNode>;

/** Identifier for the Azure resource VSCode tree view */
export const IAzureResourceTreeView: ServiceIdentifier<IAzureResourceTreeView> = Symbol.for('IAzureResourceTreeView');
export type IAzureResourceTreeView = vscode.TreeView<string>;

/**
 * Identifier for a resolver that maps a bare subscription id to a fully-populated
 * {@linkcode AzureSubscription} by drilling the Azure resource data tree.
 *
 * Lets activity-tree components (e.g. the ARM deployment provider) obtain an
 * authenticatable subscription handle without taking a direct dependency on the
 * resource tree. Returns `undefined` when no signed-in account exposes the id.
 */
export const ISubscriptionResolver: ServiceIdentifier<ISubscriptionResolver> = Symbol.for('ISubscriptionResolver');
export type ISubscriptionResolver = (subscriptionId: string) => Promise<AzureSubscription | undefined>;

// #endregion

// #region Workspace tree and view identifiers

/** Identifier for the workspace (local items) tree data cache */
export const IWorkspaceViewDataTree: ServiceIdentifier<IWorkspaceViewDataTree> = Symbol.for('IWorkspaceViewDataTree');
export type IWorkspaceViewDataTree = DataItemTree<WorkspaceNode>;

/** Identifier for the workspace view-item tree (view layer) */
export const IWorkspaceViewViewItemTree: ServiceIdentifier<IWorkspaceViewViewItemTree> = Symbol.for('IWorkspaceViewViewItemTree');
export type IWorkspaceViewViewItemTree = ViewItemTree<string, WorkspaceNode>;

/** Identifier for the workspace VSCode tree view */
export const IWorkspaceTreeView: ServiceIdentifier<IWorkspaceTreeView> = Symbol.for('IWorkspaceTreeView');
export type IWorkspaceTreeView = vscode.TreeView<string>;

// #endregion

// #region Activity tree and view identifiers

/** Identifier for the activity tree data cache */
export const IActivityViewDataTree: ServiceIdentifier<IActivityViewDataTree> = Symbol.for('IActivityViewDataTree');
export type IActivityViewDataTree = DataItemTree<Activity>;

/** Identifier for the activity view-item tree (view layer) */
export const IActivityViewViewItemTree: ServiceIdentifier<IActivityViewViewItemTree> = Symbol.for('IActivityViewViewItemTree');
export type IActivityViewViewItemTree = ViewItemTree<string, Activity>;

/** Identifier for the activity VSCode tree view */
export const IActivityTreeView: ServiceIdentifier<IActivityTreeView> = Symbol.for('IActivityTreeView');
export type IActivityTreeView = vscode.TreeView<string>;

// #endregion

/**
 * An activation callback that pushes a disposable service to the extension context's subscriptions.
 * Use with `.onActivation(pushDisposable)` at the end of a binding chain.
 */
export function pushDisposable<T>(context: ResolutionContext, injectable: T): T {
    if (Disposable.test(injectable)) {
        context.get(IExtensionContext).subscriptions.push(injectable);
    }
    return injectable;
}
