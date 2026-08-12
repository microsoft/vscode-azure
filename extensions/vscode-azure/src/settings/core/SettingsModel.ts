/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A single name/value setting. */
export interface SettingsEntry {
    /** The setting name. Unique within its collection; compared case-sensitively. */
    readonly key: string;
    /** The setting value. */
    readonly value: string;
}

/**
 * An ordered, immutable collection of settings.
 *
 * Order is meaningful only for display and serialization; equality is by key.
 */
export type SettingsMap = readonly SettingsEntry[];

/**
 * A point-in-time read of one settings collection on one resource, plus the facts the serializer
 * and the editor header need in order to describe it honestly.
 */
export interface SettingsSnapshot {
    /** Entries as read from the service. */
    readonly entries: SettingsMap;
    /** Display name of the owning resource, for the document header. */
    readonly resourceName: string;
    /** Display name of the collection (e.g. "Application settings"), for the document header. */
    readonly collectionLabel: string;
    /** When `false`, the document is opened read-only. */
    readonly writable: boolean;
}
