/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SettingsMap, SettingsSnapshot } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { GenericResource } from '../models/GenericResource';

/**
 * Identifies one settings collection on a resource.
 *
 * A resource may expose several: an App Service has both application settings and connection
 * strings. The id is a stable, product-defined token that appears in the settings document's file
 * name and in tree node keys, so it must not be localized and must not change once shipped.
 */
export interface SettingsCollectionDescriptor {
    /** Stable identifier, e.g. `appSettings`. Appears in URIs and node keys; never localized. */
    readonly id: string;
    /** Localized display name, e.g. "Application settings". */
    readonly label: string;
    /**
     * Whether entries carry per-entry `metadata`. Structured collections serialize as
     * `{ "KEY": { "value": "...", ... } }` instead of `{ "KEY": "..." }`.
     */
    readonly structured: boolean;
}

/**
 * Per-product access to settings on a resource.
 *
 * Implementations own everything product-specific: which collections exist, how to read and write
 * them, and what a valid setting name looks like. The shared model, tree, editor, and commands
 * consult this interface and never branch on resource type themselves.
 *
 * @remarks
 * {@linkcode SettingsAdapter.write write} receives the collection's **complete** new contents. Keys
 * absent from `entries` must be deleted. This matches ARM's whole-dictionary PUT semantics and the
 * editor's last-writer-wins save behavior; implementations must not merge with remote state.
 */
export interface SettingsAdapter {
    /** Whether this adapter serves the given resource. */
    canHandle(resource: GenericResource): boolean;

    /** The collections this adapter exposes on {@linkcode resource}. May be empty. */
    getCollections(resource: GenericResource): readonly SettingsCollectionDescriptor[];

    /**
     * Read the current contents of a collection.
     *
     * Set {@linkcode SettingsSnapshot.writable writable} on the returned snapshot to `false` for a
     * collection this product will not let the user edit; the editor then opens it read-only.
     *
     * @throws if the collection id is not one this adapter exposes for the resource.
     */
    read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot>;

    /**
     * Replace a collection's entire contents with {@linkcode entries}.
     *
     * Implementations own enforcement: reject the write if the collection is read-only or any entry
     * is invalid. This runs for both the editor and the per-setting commands, so it is the one place
     * a product's rules cannot be bypassed.
     *
     * @throws if the collection is not writable, an entry is invalid, or the id is not one this
     * adapter exposes.
     */
    write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void>;

    /**
     * Validate a proposed setting name, for live feedback in an input box.
     *
     * Advisory only -- {@linkcode SettingsAdapter.write write} must reject an invalid name regardless,
     * since the editor can save one without ever going through a prompt.
     *
     * @returns a localized error message, or `undefined` if the name is acceptable.
     */
    validateKey?(resource: GenericResource, collectionId: string, key: string): string | undefined;
}

/**
 * Collection identifier for every registered {@linkcode SettingsAdapter}.
 *
 * Bound multi-injection style; resolve with `container.getAll(ISettingsAdapter)`. Prefer the
 * extension's settings registry, which handles dispatch, over resolving adapters directly.
 */
export const ISettingsAdapter: ServiceIdentifier<SettingsAdapter> = Symbol.for('ISettingsAdapter');
export type ISettingsAdapter = SettingsAdapter;
