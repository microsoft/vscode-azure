/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type GenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsAdapter } from '../../../settings/SettingsAdapter';

/**
 * Virtual-type discriminator for the settings tree node.
 *
 * A structural identifier, not display text. Shared by the data provider, the view provider, and
 * the edit command so none of them duplicates a string literal. It is also the node's
 * `virtualPath`, which is what makes the node's key distinct from its owning resource's.
 */
export const SettingsVirtualType = 'settings';

/**
 * A resource's settings node, e.g. the "Application Settings" node under a Function App.
 *
 * This is a leaf: individual settings are not shown in the tree, because they are edited as a
 * single document. That also keeps setting values -- frequently secrets -- out of a tree that is
 * often visible during screen shares.
 */
export interface SettingsNode extends VirtualResource {
    /** Adapter selected by the provider that owns the resource. */
    readonly adapter: SettingsAdapter;
}

/** Build a settings child when {@linkcode adapter} supports {@linkcode resource}. */
export function getSettingsNodes(resource: GenericResource, adapter: SettingsAdapter): SettingsNode[] {
    return adapter.canHandle(resource) ? [{
        virtualType: SettingsVirtualType,
        virtualPath: SettingsVirtualType,
        azureResource: resource,
        adapter,
    }] : [];
}

/** Type guard for a settings node. */
export function isSettingsNode(node: unknown): node is SettingsNode {
    return !!node
        && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && (node as VirtualResource).virtualType === SettingsVirtualType
        && !!(node as Partial<SettingsNode>).adapter;
}
