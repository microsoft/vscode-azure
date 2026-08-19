/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzureListingCache,
    type AzureSubscription,
    type ConcreteAzureNode,
    type ConcreteAzureNodeTree,
    ICredentialFactory,
    type IAzureListingSource as ListingSource,
    type TokenCredential,
} from '@microsoft/vscode-azure-azutils';
import {
    type DataItemTree,
    Disposable,
    IActionExecutor,
    ICodeContext,
    IExtensionContext,
    type ViewItemTree,
} from '@microsoft/vscode-azure-utils';
import type { Container, Newable, ResolutionContext, ServiceIdentifier } from 'inversify';
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
 * Identifier for the *unfiltered* account/tenant/subscription listings.
 *
 * Deliberately separate from the resource tree, which applies the
 * `vscode-azure.selectedSubscriptions` filter and so cannot show a tenant the
 * user has not selected. The flows that let the user *change* that filter
 * (Select Subscriptions, Sign In) must see past it, and depend on this instead.
 * Both are served by one cache, so neither pays twice for the same listing.
 *
 * This is the read-only half of {@linkcode IAzureListingCache}; depend on it
 * unless you need to invalidate.
 */
export const IAzureListingSource: ServiceIdentifier<IAzureListingSource> = Symbol.for('IAzureListingSource');
export type IAzureListingSource = ListingSource;

/**
 * Identifier for the shared listing cache that serves {@linkcode IAzureListingSource}.
 *
 * Adds the invalidation surface (`clear`, `clearAccount`, `refreshAccounts`) on
 * top of the listing methods. Only the owner of cache lifetime -- the data
 * provider, which watches for sign-in/out and environment changes -- should
 * depend on this; everything else depends on {@linkcode IAzureListingSource}.
 */
export const IAzureListingCache: ServiceIdentifier<AzureListingCache> = Symbol.for('IAzureListingCache');

/**
 * Identifier for a resolver that maps a bare subscription id to a fully-populated
 * {@linkcode AzureSubscription} by drilling the Azure resource data tree.
 *
 * Lets activity-tree components (e.g. the ARM deployment provider) obtain an
 * authenticatable subscription handle without taking a direct dependency on the
 * resource tree. Returns `undefined` when no signed-in account exposes the id.
 *
 * An optional `tenantId` hint narrows the drill to a single tenant when the
 * owning tenant is known (e.g. hydrated from azd). An optional `accountId` hint
 * likewise narrows the drill to a single account when the owning account is
 * known.
 */
export const ISubscriptionResolver: ServiceIdentifier<ISubscriptionResolver> = Symbol.for('ISubscriptionResolver');
export type ISubscriptionResolver = (subscriptionId: string, tenantId?: string, accountId?: string) => Promise<AzureSubscription | undefined>;

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

/**
 * A provider contribution that is either bound directly to a collection or
 * exposed as a singleton under a primary identifier and aliased into it.
 */
export type ProviderEntry<T> = Newable<T> | readonly [ServiceIdentifier<T>, Newable<T>];

/** Signature shared by subscription-scoped Azure REST client `create` methods. */
export type AzureClientCreate<TResult> = (
    context: ICodeContext,
    executor: IActionExecutor,
    credential: TokenCredential,
    subscription: AzureSubscription,
) => TResult;

/**
 * Bind a subscription-scoped Azure client provider unless another product
 * already registered the same shared provider.
 */
export function bindAzureClientProvider<TResult>(
    container: Container,
    providerId: ServiceIdentifier<(subscription: AzureSubscription) => TResult>,
    create: AzureClientCreate<TResult>,
): void {
    if (container.isBound(providerId)) {
        return;
    }

    container.bind(providerId).toFactory(context => {
        const codeContext = context.get(ICodeContext);
        const executor = context.get(IActionExecutor);
        const credentialFactory = context.get(ICredentialFactory);
        return (subscription: AzureSubscription) => create(
            codeContext,
            executor,
            credentialFactory(subscription),
            subscription,
        );
    });
}

/**
 * Bind provider entries to a collection {@linkcode ServiceIdentifier}.
 * Bare classes are bound directly; `[primaryId, Class]` tuples are bound as
 * singletons under `primaryId` and aliased into the collection.
 */
export function bindProviders<T>(
    container: Container,
    collectionId: ServiceIdentifier<T>,
    entries: readonly ProviderEntry<T>[],
): void {
    for (const entry of entries) {
        if (typeof entry === 'function') {
            container.bind(collectionId).to(entry).onActivation(pushDisposable);
        } else {
            const [primaryId, providerClass] = entry;
            if (!container.isBound(primaryId)) {
                container.bind(primaryId).to(providerClass).inSingletonScope().onActivation(pushDisposable);
            }
            container.bind(collectionId).toService(primaryId);
        }
    }
}
