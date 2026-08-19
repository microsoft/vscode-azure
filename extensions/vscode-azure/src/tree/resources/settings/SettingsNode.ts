/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsAdapter, SettingsOwner } from '../../../settings/SettingsAdapter';

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
    /** Adapter selected by the provider that owns {@linkcode SettingsNode.owner owner}. */
    readonly adapter: SettingsAdapter;

    /**
     * The node these settings belong to, handed back to the adapter on every read and write.
     *
     * Equal to {@linkcode VirtualResource.azureResource azureResource} when the settings hang off
     * the ARM resource itself, and the owning virtual node when they hang off a part of it.
     */
    readonly owner: SettingsOwner;

    /**
     * File name stem for the settings document tab, without an extension.
     *
     * Distinguishes tabs when one ARM resource has several settings documents -- two Static Web
     * Apps environments would otherwise both open as `mySite.settings.jsonc`.
     */
    readonly documentName: string;
}

/**
 * Build a settings child when {@linkcode adapter} supports {@linkcode owner}.
 *
 * Pass the ARM resource as {@linkcode owner} for resource-wide settings, or a virtual node for
 * settings scoped to a part of a resource; the node is then keyed beneath that virtual node so
 * sibling parts each get their own document.
 *
 * @param documentName Overrides the document's file name stem. Supply it whenever one resource can
 * have more than one settings document, so the editor tabs are distinguishable.
 */
export function getSettingsNodes(owner: SettingsOwner, adapter: SettingsAdapter, documentName?: string): SettingsNode[] {
    if (!adapter.canHandle(owner)) {
        return [];
    }

    const ownerIsVirtual = isVirtualResource(owner);
    const azureResource = ownerIsVirtual ? owner.azureResource : owner;

    return [{
        virtualType: SettingsVirtualType,
        virtualPath: ownerIsVirtual ? `${owner.virtualPath}/${SettingsVirtualType}` : SettingsVirtualType,
        azureResource,
        owner,
        documentName: documentName ?? azureResource.name,
        adapter,
    }];
}

/** Type guard for a settings node. */
export function isSettingsNode(node: unknown): node is SettingsNode {
    return !!node
        && typeof node === 'object'
        && isVirtualResource(node as VirtualResource)
        && (node as VirtualResource).virtualType === SettingsVirtualType
        && !!(node as Partial<SettingsNode>).adapter
        && !!(node as Partial<SettingsNode>).owner;
}
