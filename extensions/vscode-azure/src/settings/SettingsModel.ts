/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A single name/value setting. */
export interface SettingsEntry {
    /** The setting name. Unique within a resource's settings; compared case-sensitively. */
    readonly key: string;
    /** The setting value. */
    readonly value: string;
}

/**
 * An ordered, immutable set of settings.
 *
 * Order is meaningful only for display and serialization; equality is by key.
 */
export type SettingsMap = readonly SettingsEntry[];

/**
 * A point-in-time read of one resource's settings, plus the facts the serializer and the editor
 * header need in order to describe them honestly.
 */
export interface SettingsSnapshot {
    /** Entries as read from the service. */
    readonly entries: SettingsMap;
    /** Display name of the owning resource, for the document header. */
    readonly resourceName: string;
    /** Display name of the settings (e.g. "Application Settings"), for the document header. */
    readonly label: string;
    /** When `false`, the document is opened read-only. */
    readonly writable: boolean;
}
