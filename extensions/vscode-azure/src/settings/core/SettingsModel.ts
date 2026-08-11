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

/** A single key-level difference between two {@linkcode SettingsMap}s. */
export interface SettingsChange {
    readonly key: string;
    /** Value on the left side, or `undefined` if the key is absent there. */
    readonly before?: SettingsEntry;
    /** Value on the right side, or `undefined` if the key is absent there. */
    readonly after?: SettingsEntry;
    readonly kind: 'added' | 'removed' | 'changed';
}

/** The complete set of differences between two {@linkcode SettingsMap}s. */
export type SettingsDiff = readonly SettingsChange[];

/**
 * Index a {@linkcode SettingsMap} by key for O(1) lookup.
 *
 * The last entry wins if the map contains duplicate keys; callers that care about duplicates should
 * reject them beforehand (the JSONC parser does).
 */
export function toSettingsIndex(settings: SettingsMap): Map<string, SettingsEntry> {
    return new Map(settings.map(entry => [entry.key, entry]));
}

/**
 * Compute the key-level differences between {@linkcode before} and {@linkcode after}.
 *
 * Entries are matched by key (case-sensitive, as Azure treats setting names). An entry is `changed`
 * when its value or any metadata field differs. Results are ordered by `after`'s ordering first,
 * then by keys present only in `before`, so the output reads naturally as "what the user did".
 */
export function diffSettings(before: SettingsMap, after: SettingsMap): SettingsDiff {
    const beforeIndex = toSettingsIndex(before);
    const afterIndex = toSettingsIndex(after);
    const changes: SettingsChange[] = [];

    for (const entry of after) {
        const previous = beforeIndex.get(entry.key);
        if (!previous) {
            changes.push({ key: entry.key, after: entry, kind: 'added' });
        } else if (!entriesEqual(previous, entry)) {
            changes.push({ key: entry.key, before: previous, after: entry, kind: 'changed' });
        }
    }

    for (const entry of before) {
        if (!afterIndex.has(entry.key)) {
            changes.push({ key: entry.key, before: entry, kind: 'removed' });
        }
    }

    return changes;
}

function entriesEqual(a: SettingsEntry, b: SettingsEntry): boolean {
    if (a.value !== b.value) {
        return false;
    }

    const aKeys = Object.keys(a.metadata ?? {});
    const bKeys = Object.keys(b.metadata ?? {});
    if (aKeys.length !== bKeys.length) {
        return false;
    }

    return aKeys.every(key => a.metadata?.[key] === b.metadata?.[key]);
}
