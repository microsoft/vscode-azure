/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import type { ServiceIdentifier } from 'inversify';
import type { SettingsMap, SettingsSnapshot } from './SettingsModel';

/**
 * Per-product access to the settings on a resource.
 *
 * A resource has at most one settings document, served by at most one adapter. Implementations own
 * everything product-specific: how to read and write the settings, and what a valid setting name
 * looks like. The shared model, tree, editor, and command consult this interface and never branch
 * on resource type themselves.
 *
 * @remarks
 * {@linkcode SettingsAdapter.write write} receives the **complete** new contents. Keys absent from
 * `entries` must be deleted. This matches ARM's whole-dictionary PUT semantics and the editor's
 * last-writer-wins save behavior; implementations must not merge with remote state.
 */
export interface SettingsAdapter {
    /**
     * Localized display name for the tree node and the document header, e.g. "Application Settings".
     *
     * A getter rather than a fixed string so it is resolved in the active display language.
     */
    readonly label: string;

    /** Whether this adapter serves the given resource. */
    canHandle(resource: GenericResource): boolean;

    /**
     * Read the resource's current settings.
     *
     * Set {@linkcode SettingsSnapshot.writable writable} on the returned snapshot to `false` when
     * this product will not let the user edit them; the editor then opens the document read-only.
     */
    read(resource: GenericResource): Promise<SettingsSnapshot>;

    /**
     * Replace the resource's settings with {@linkcode entries} in their entirety.
     *
     * Implementations own enforcement: reject the write if the settings are read-only or any entry
     * is invalid. The editor can save anything the user types, so this is the only place a product's
     * rules can be applied.
     *
     * @throws if the settings are not writable or an entry is invalid.
     */
    write(resource: GenericResource, entries: SettingsMap): Promise<void>;
}

/**
 * Collection identifier for every registered {@linkcode SettingsAdapter}.
 *
 * Bound multi-injection style; resolve with `container.getAll(ISettingsAdapter)`. Prefer the
 * extension's settings registry, which handles dispatch, over resolving adapters directly.
 */
export const ISettingsAdapter: ServiceIdentifier<SettingsAdapter> = Symbol.for('ISettingsAdapter');
export type ISettingsAdapter = SettingsAdapter;
