/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A single name/value setting.
 *
 * {@linkcode SettingsEntry.metadata metadata} carries service-specific side-channel fields that
 * travel with the value but are not the value -- e.g. an App Service connection string's `type`
 * (`SQLAzure`, `Custom`, ...). Collections that declare themselves unstructured leave it undefined.
 */
export interface SettingsEntry {
    /** The setting name. Unique within its collection; compared case-sensitively. */
    readonly key: string;
    /** The setting value. */
    readonly value: string;
    /** Service-specific fields that accompany the value, if the collection is structured. */
    readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * An ordered, immutable collection of settings.
 *
 * Order is meaningful only for display and serialization; equality and diffing are by key.
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
    /** Whether entries carry {@linkcode SettingsEntry.metadata}, which changes the serialized shape. */
    readonly structured: boolean;
}

