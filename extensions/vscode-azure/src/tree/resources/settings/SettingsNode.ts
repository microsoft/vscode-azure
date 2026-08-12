/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type GenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';

/**
 * Virtual-type discriminator for the settings tree node.
 *
 * A structural identifier, not display text. Shared by the data provider, the view provider, and
 * the edit command so none of them duplicates a string literal.
 */
export const SettingsCollectionVirtualType = 'settings.collection';

/**
 * A settings collection node, e.g. the "Application Settings" node under a Function App.
 *
 * This is a leaf: individual settings are not shown in the tree, because the whole collection is
 * edited as a document. That also keeps setting values -- frequently secrets -- out of a tree that
 * is often visible during screen shares.
 *
 * `virtualPath` carries the collection id, which is what distinguishes one settings node from
 * another on the same resource.
 */
export type SettingsCollectionNode = VirtualResource;

/** Build the collection node for {@linkcode collectionId} on {@linkcode resource}. */
export function createCollectionNode(resource: GenericResource, collectionId: string): SettingsCollectionNode {
    return {
        virtualType: SettingsCollectionVirtualType,
        virtualPath: collectionId,
        azureResource: resource,
    };
}

/** Type guard for a settings collection node. */
export function isSettingsCollectionNode(node: unknown): node is SettingsCollectionNode {
    return !!node
        && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && (node as VirtualResource).virtualType === SettingsCollectionVirtualType;
}

/** The collection id a settings node names. */
export function collectionIdOf(node: SettingsCollectionNode): string {
    return node.virtualPath;
}
