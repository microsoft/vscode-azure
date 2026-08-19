/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The read-only surface of a {@linkcode CaselessMap}.
 *
 * Declare parameters and fields as this type when the holder only needs to read entries,
 * so that it cannot add or remove them.
 */
export interface ICaselessMapReader<V> extends Iterable<[string, V]> {
    /** The number of distinct keys, compared case-insensitively. */
    readonly size: number;

    /** Returns `true` if `key` is present, ignoring case. */
    has(key: string): boolean;

    /** Returns the value for `key`, ignoring case, or `undefined` if absent. */
    get(key: string): V | undefined;

    /** Yields keys in their original casing, in insertion order. */
    keys(): IterableIterator<string>;

    /** Yields values in insertion order. */
    values(): IterableIterator<V>;

    /** Yields `[key, value]` pairs with keys in their original casing, in insertion order. */
    entries(): IterableIterator<[string, V]>;
}

/**
 * A map keyed by strings that compares its keys case-insensitively, while preserving the
 * casing each key was originally written with.
 *
 * Case folding is applied inside the map itself, so callers never need to fold at the call
 * site. This matters for Azure identifiers -- ARM resource IDs, resource types, tenant IDs,
 * subscription IDs, and account IDs are all case-insensitive -- where folding by hand has to
 * be remembered both when the map is populated and again at every lookup, and a missed fold
 * fails silently as an `undefined` result rather than an error.
 *
 * @remarks
 * This class deliberately does **not** extend {@linkcode Map}; see {@linkcode CaselessSet}
 * for the reasoning.
 *
 * Folding uses `toLowerCase()`, which is locale-independent, and never
 * `toLocaleLowerCase()`, which is not -- under a Turkish locale the latter folds `'I'` to
 * `'\u0131'`. Ordinal folding is the correct choice for Azure identifiers.
 *
 * Setting a key that differs only by case from an existing one updates the value but keeps
 * the casing the key was first set with, mirroring {@linkcode Map.set}.
 *
 * @example
 * ```ts
 * const deployments = new CaselessMap<Deployment>();
 * deployments.set(deployment.id, deployment);
 * deployments.get(resourceId); // matches regardless of the casing of either side
 * ```
 */
export class CaselessMap<V> implements ICaselessMapReader<V> {
    /** Maps the folded key to the casing it was first set with, plus the current value. */
    private readonly store = new Map<string, { key: string; value: V }>();

    /**
     * @param entries - Initial entries. Keys differing only by case collapse to one entry,
     * retaining the first casing seen and the last value set.
     */
    public constructor(entries?: Iterable<readonly [string, V]>) {
        if (entries) {
            for (const [key, value] of entries) {
                this.set(key, value);
            }
        }
    }

    public get size(): number {
        return this.store.size;
    }

    public has(key: string): boolean {
        return this.store.has(key.toLowerCase());
    }

    public get(key: string): V | undefined {
        return this.store.get(key.toLowerCase())?.value;
    }

    /**
     * Sets the value for `key`. If a key differing only by case is already present, its
     * value is replaced and the existing casing is kept.
     */
    public set(key: string, value: V): this {
        const folded = key.toLowerCase();
        const existing = this.store.get(folded);
        if (existing) {
            existing.value = value;
        } else {
            this.store.set(folded, { key, value });
        }
        return this;
    }

    /**
     * Removes the entry for `key`, ignoring case.
     *
     * @returns `true` if an entry was removed.
     */
    public delete(key: string): boolean {
        return this.store.delete(key.toLowerCase());
    }

    /** Removes all entries. */
    public clear(): void {
        this.store.clear();
    }

    public *keys(): IterableIterator<string> {
        for (const entry of this.store.values()) {
            yield entry.key;
        }
    }

    public *values(): IterableIterator<V> {
        for (const entry of this.store.values()) {
            yield entry.value;
        }
    }

    public *entries(): IterableIterator<[string, V]> {
        for (const entry of this.store.values()) {
            yield [entry.key, entry.value];
        }
    }

    /** Calls `callback` for each entry, with the key in its original casing, in insertion order. */
    public forEach(callback: (value: V, key: string, map: CaselessMap<V>) => void, thisArg?: unknown): void {
        for (const [key, value] of this.entries()) {
            callback.call(thisArg, value, key, this);
        }
    }

    public [Symbol.iterator](): IterableIterator<[string, V]> {
        return this.entries();
    }
}
