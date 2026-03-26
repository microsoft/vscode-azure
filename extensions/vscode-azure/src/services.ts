/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import type { ConcreteAzureNode, ConcreteAzureNodeTree } from '@microsoft/vscode-azure-azutils';
import { type DataItemTree, Disposable, IExtensionContext, type ViewItemTree } from '@microsoft/vscode-azure-utils';
import type { ResolutionContext, ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { Activity } from './tree/activity/Activity';

/** Identifier for the Azure subscription provider */
export const IAzureSubscriptionProvider: ServiceIdentifier<AzureSubscriptionProvider> = Symbol.for('IAzureSubscriptionProvider');

/** Identifier for the {@linkcode TempProjectManager} service */
export const ITempProjectManager: ServiceIdentifier<ITempProjectManager> = Symbol.for('ITempProjectManager');
export type ITempProjectManager = import('./bicep/TempProjectManager').TempProjectManager;

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
