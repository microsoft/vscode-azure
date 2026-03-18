/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription, AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import type { ConcreteAzureNode, ConcreteAzureNodeTree, IAcrClient, IDeploymentClient, IResourceClient } from '@microsoft/vscode-azure-azutils';
import { type DataItemTree, Disposable, IExtensionContext, type ViewItemTree } from '@microsoft/vscode-azure-utils';
import type { ResolutionContext, ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import type { Activity } from './tree/activity/Activity';

/** Identifier for the Azure subscription provider */
export const IAzureSubscriptionProvider: ServiceIdentifier<AzureSubscriptionProvider> = Symbol.for('IAzureSubscriptionProvider');

// #region Client provider identifiers

/** Factory that creates an {@link IResourceClient} for a given subscription. */
export const IResourceClientProvider: ServiceIdentifier<IResourceClientProvider> = Symbol.for('IResourceClientProvider');
export type IResourceClientProvider = AsyncFactory<IResourceClient, [AzureSubscription]>;

/** Factory that creates an {@link IDeploymentClient} for a given subscription. */
export const IDeploymentClientProvider: ServiceIdentifier<IDeploymentClientProvider> = Symbol.for('IDeploymentClientProvider');
export type IDeploymentClientProvider = AsyncFactory<IDeploymentClient, [AzureSubscription]>;

/** Factory that creates an {@link IAcrClient} for a given subscription. */
export const IAcrClientProvider: ServiceIdentifier<IAcrClientProvider> = Symbol.for('IAcrClientProvider');
export type IAcrClientProvider = AsyncFactory<IAcrClient, [AzureSubscription]>;

// #endregion

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

/**
 * A factory function that asynchronously creates a service instance.
 * Unlike inversify's `Factory<T>` (which returns `T | Promise<T>`),
 * this always returns a `Promise<T>` so callers know they must `await`
 * the result.
 */
type AsyncFactory<T, TArgs extends unknown[]> = (...args: TArgs) => Promise<T>;
