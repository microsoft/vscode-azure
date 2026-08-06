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
 * What a product permits on one settings collection.
 *
 * This is the mechanism that keeps product differences out of the shared layer: the framework gates
 * commands and editor behavior on these flags rather than on product identity. Adding a product
 * that, say, forbids renaming means returning `canRename: false` -- not adding a branch.
 */
export interface SettingsCapabilities {
    /** Whether new settings may be added. */
    readonly canAdd: boolean;
    /** Whether existing settings may be deleted. */
    readonly canDelete: boolean;
    /** Whether a setting may be renamed. */
    readonly canRename: boolean;
    /** Whether any write is permitted. When `false`, the editor opens read-only. */
    readonly canWrite: boolean;
    /**
     * Whether the service returns real values on read.
     *
     * When `false`, every value reads back as `UnreadableValue` and the framework preserves it on
     * save rather than writing the placeholder over the real secret.
     */
    readonly valuesReadable: boolean;
    /**
     * Validate a proposed setting name.
     *
     * @returns a localized error message, or `undefined` if the name is acceptable.
     */
    readonly validateKey?: (key: string) => string | undefined;
    /**
     * Validate a proposed metadata field value on a structured collection (e.g. a connection
     * string's `type`).
     *
     * @returns a localized error message, or `undefined` if acceptable.
     */
    readonly validateMetadata?: (field: string, value: string) => string | undefined;
}

/**
 * Per-product access to settings on a resource.
 *
 * Implementations own everything product-specific: which collections exist, what may be done to
 * them, and how to read and write them. The shared model, tree, editor, and commands consult this
 * interface and never branch on resource type themselves.
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
     * What is permitted on {@linkcode collectionId} for {@linkcode resource}.
     *
     * @throws if the collection id is not one this adapter exposes for the resource.
     */
    getCapabilities(resource: GenericResource, collectionId: string): SettingsCapabilities;

    /**
     * Read the current contents of a collection.
     *
     * @throws if the collection id is not one this adapter exposes for the resource.
     */
    read(resource: GenericResource, collectionId: string): Promise<SettingsSnapshot>;

    /**
     * Replace a collection's entire contents with {@linkcode entries}.
     *
     * @throws if the collection is not writable, or the id is not one this adapter exposes.
     */
    write(resource: GenericResource, collectionId: string, entries: SettingsMap): Promise<void>;
}

/**
 * Collection identifier for every registered {@linkcode SettingsAdapter}.
 *
 * Bound multi-injection style; resolve with `container.getAll(ISettingsAdapter)`. Prefer the
 * extension's settings registry, which handles dispatch, over resolving adapters directly.
 */
export const ISettingsAdapter: ServiceIdentifier<SettingsAdapter> = Symbol.for('ISettingsAdapter');
export type ISettingsAdapter = SettingsAdapter;
