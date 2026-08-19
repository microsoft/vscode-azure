/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource, VirtualResource } from '@microsoft/vscode-azure-azutils';
import type { SettingsMap, SettingsSnapshot } from './SettingsModel';

/**
 * The tree node a settings document belongs to.
 *
 * Usually the ARM resource itself, but a product whose settings are scoped to a *part* of a
 * resource passes that part's virtual node instead -- for example Static Web Apps, where each
 * environment has its own application settings and the ARM resource has none of its own.
 */
export type SettingsOwner = GenericResource | VirtualResource;

/**
 * Per-product access to the settings on a resource.
 *
 * An owner has at most one settings document, served by at most one adapter. Implementations own
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

    /** Whether this adapter serves the given owner. */
    canHandle(owner: SettingsOwner): boolean;

    /**
     * Read the owner's current settings.
     *
     * Set {@linkcode SettingsSnapshot.writable writable} on the returned snapshot to `false` when
     * this product will not let the user edit them; the editor then opens the document read-only.
     */
    read(owner: SettingsOwner): Promise<SettingsSnapshot>;

    /**
     * Replace the owner's settings with {@linkcode entries} in their entirety.
     *
     * Implementations own enforcement: reject the write if the settings are read-only or any entry
     * is invalid. The editor can save anything the user types, so this is the only place a product's
     * rules can be applied.
     *
     * @throws if the settings are not writable or an entry is invalid.
     */
    write(owner: SettingsOwner, entries: SettingsMap): Promise<void>;
}
