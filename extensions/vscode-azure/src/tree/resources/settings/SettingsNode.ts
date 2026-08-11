/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isVirtualResource, type GenericResource, type VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsEntry } from '../../../settings/core/SettingsModel';

/**
 * Separator between the collection id and the setting key inside an entry node's `virtualPath`.
 *
 * Safe because `AzureNodeId` percent-encodes `virtualPath` when serializing and decodes it when
 * parsing, so a `/` inside the path round-trips as `%2F` rather than splitting the fragment.
 */
const PathSeparator = '/';

/**
 * Virtual-type discriminators for settings tree nodes.
 *
 * These are structural identifiers, not display text. They are shared by the data provider, the
 * view provider, and the commands so none of them duplicates a string literal.
 */
export const SettingsVirtualTypes = {
    /** A settings collection category node. Its `virtualPath` is the collection id. */
    Collection: 'settings.collection',
    /** An individual setting. Its `virtualPath` is `{collectionId}/{key}`. */
    Entry: 'settings.entry',
} as const;

/**
 * A settings collection node, e.g. the "Application settings" category under a Function App.
 *
 * `virtualPath` carries the collection id, which is what distinguishes one settings node from
 * another on the same resource.
 */
export type SettingsCollectionNode = VirtualResource;

/**
 * An individual setting node.
 *
 * `virtualPath` carries `{collectionId}/{key}` rather than the bare key, because the same key can
 * legitimately exist in two collections on one resource (an app setting and a connection string
 * both named `Database`) and the node key must still be unique.
 *
 * The value travels on the node because the data provider already has it from the collection read.
 * Carrying it avoids a second service round trip in the view provider (which masks it) and in the
 * edit / copy commands. It is not part of the node key, so changing a value never orphans a node.
 */
export interface SettingsEntryNode extends VirtualResource {
    /** Current value, or the unreadable-value sentinel when the service will not return it. */
    readonly value: string;
    /** Service-specific fields accompanying the value on a structured collection. */
    readonly metadata?: Readonly<Record<string, string>>;
}

/** Build the collection node for {@linkcode collectionId} on {@linkcode resource}. */
export function createCollectionNode(resource: GenericResource, collectionId: string): SettingsCollectionNode {
    return {
        virtualType: SettingsVirtualTypes.Collection,
        virtualPath: collectionId,
        azureResource: resource,
    };
}

/** Build the entry node for {@linkcode entry} within {@linkcode collectionId} on {@linkcode resource}. */
export function createEntryNode(resource: GenericResource, collectionId: string, entry: SettingsEntry): SettingsEntryNode {
    return {
        virtualType: SettingsVirtualTypes.Entry,
        virtualPath: `${collectionId}${PathSeparator}${entry.key}`,
        azureResource: resource,
        value: entry.value,
        metadata: entry.metadata,
    };
}

/** Type guard for any settings-owned virtual node. */
export function isSettingsNode(node: unknown): node is VirtualResource {
    if (!node || typeof node !== 'object' || !isVirtualResource(node as VirtualResource)) {
        return false;
    }

    const virtualType = (node as VirtualResource).virtualType;
    return virtualType === SettingsVirtualTypes.Collection || virtualType === SettingsVirtualTypes.Entry;
}

/** Type guard for a settings collection node. */
export function isSettingsCollectionNode(node: unknown): node is SettingsCollectionNode {
    return isSettingsNode(node) && node.virtualType === SettingsVirtualTypes.Collection;
}

/** Type guard for an individual setting node. */
export function isSettingsEntryNode(node: unknown): node is SettingsEntryNode {
    return isSettingsNode(node)
        && node.virtualType === SettingsVirtualTypes.Entry
        && typeof (node as SettingsEntryNode).value === 'string';
}

/** The collection id a settings node belongs to, whether it is a collection node or an entry node. */
export function collectionIdOf(node: VirtualResource): string {
    if (node.virtualType === SettingsVirtualTypes.Collection) {
        return node.virtualPath;
    }

    const separator = node.virtualPath.indexOf(PathSeparator);
    return separator < 0 ? node.virtualPath : node.virtualPath.slice(0, separator);
}

/**
 * The setting key an entry node names.
 *
 * @throws if {@linkcode node} is not an entry node -- a collection has no single key.
 */
export function settingKeyOf(node: SettingsEntryNode): string {
    if (node.virtualType !== SettingsVirtualTypes.Entry) {
        throw new Error(`Expected a settings entry node but got '${node.virtualType}'`);
    }

    const separator = node.virtualPath.indexOf(PathSeparator);
    if (separator < 0) {
        throw new Error(`Malformed settings entry path: '${node.virtualPath}'`);
    }

    // `slice` rather than `split`, so a key that itself contains a separator survives intact.
    return node.virtualPath.slice(separator + PathSeparator.length);
}

/** The collection node that owns {@linkcode node}. */
export function parentCollectionOf(node: SettingsEntryNode): SettingsCollectionNode {
    return createCollectionNode(node.azureResource, collectionIdOf(node));
}
