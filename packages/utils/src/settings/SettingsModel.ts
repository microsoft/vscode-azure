/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sentinel written in place of a value the backing service refuses to return.
 *
 * A collection whose {@linkcode SettingsSnapshot.valuesReadable valuesReadable} is `false` serializes
 * every value as this string. On save, an entry still carrying the sentinel means *leave the remote
 * value untouched*; the sentinel is never sent to the service. Using it as the value of a **new**
 * key is an error, because there is no existing value to preserve.
 */
export const UnreadableValue = '********';

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
    /** The setting value, or {@linkcode UnreadableValue} when the service will not return it. */
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
    /** When `false`, every value is {@linkcode UnreadableValue} and must be preserved on save. */
    readonly valuesReadable: boolean;
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

/**
 * Replace any entry still carrying {@linkcode UnreadableValue} with its value from
 * {@linkcode original}, so that saving a collection whose values could not be read back does not
 * overwrite real secrets with the sentinel.
 *
 * @throws if an entry carries the sentinel but has no counterpart in {@linkcode original}. There is
 * nothing to preserve in that case, so it must surface as a validation error rather than silently
 * writing a literal `********` as the value.
 */
export function restoreUnreadableValues(entries: SettingsMap, original: SettingsMap): SettingsMap {
    const originalIndex = toSettingsIndex(original);

    return entries.map(entry => {
        if (entry.value !== UnreadableValue) {
            return entry;
        }

        const previous = originalIndex.get(entry.key);
        if (!previous) {
            throw new Error(`Cannot save the setting '${entry.key}': its value is the placeholder used for values that cannot be read back, but this setting does not exist yet, so there is no value to preserve. Enter a real value.`);
        }

        return { ...entry, value: previous.value };
    });
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
