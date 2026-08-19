/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The read-only surface of a {@linkcode CaselessSet}.
 *
 * Declare parameters and fields as this type when the holder only needs to look values
 * up, so that it cannot add or remove entries.
 */
export interface ICaselessSetReader extends Iterable<string> {
    /** The number of distinct values, compared case-insensitively. */
    readonly size: number;

    /** Returns `true` if `value` is present, ignoring case. */
    has(value: string): boolean;

    /** Yields values in their original casing, in insertion order. */
    keys(): IterableIterator<string>;

    /** Yields values in their original casing, in insertion order. */
    values(): IterableIterator<string>;
}

/**
 * A set of strings that compares its values case-insensitively, while preserving the
 * casing each value was originally written with.
 *
 * Case folding is applied inside the set itself, so callers never need to fold at the
 * call site. This matters for Azure identifiers -- ARM resource IDs, resource types,
 * tenant IDs, subscription IDs, and account IDs are all case-insensitive -- where folding
 * by hand has to be remembered both when the set is built and again at every lookup, and
 * a missed fold fails silently as a `false` result rather than an error.
 *
 * @remarks
 * This class deliberately does **not** extend {@linkcode Set}. An override on a `Set`
 * subclass only affects direct calls; inherited members such as `delete` and the ES2025
 * set operations read internal slots and would bypass folding entirely, and any newly
 * standardised method would be silently inherited without folding. Owning the whole
 * surface makes that impossible. It also means a `CaselessSet` cannot be passed where a
 * `Set<string>` is expected and have an unfolded value pushed into it.
 *
 * Folding uses `toLowerCase()`, which is locale-independent, and never
 * `toLocaleLowerCase()`, which is not -- under a Turkish locale the latter folds `'I'` to
 * `'\u0131'`. Ordinal folding is the correct choice for Azure identifiers.
 *
 * When values that differ only by case are added, the first casing added is the one
 * retained and yielded by iteration; later adds of the same value are no-ops.
 *
 * @example
 * ```ts
 * const tenantIds = new CaselessSet(tenants.map(t => t.tenantId));
 * tenantIds.has(someId); // matches regardless of the casing of either side
 * ```
 */
export class CaselessSet implements ICaselessSetReader {
    /** Maps the folded value to the casing it was first added with. */
    private readonly store = new Map<string, string>();

    /**
     * @param values - Initial values. Values differing only by case collapse to one entry,
     * retaining the first casing seen.
     */
    public constructor(values?: Iterable<string>) {
        if (values) {
            for (const value of values) {
                this.add(value);
            }
        }
    }

    public get size(): number {
        return this.store.size;
    }

    public has(value: string): boolean {
        return this.store.has(value.toLowerCase());
    }

    /**
     * Adds `value`. If a value differing only by case is already present, the set is
     * unchanged and the existing casing is kept.
     */
    public add(value: string): this {
        const folded = value.toLowerCase();
        if (!this.store.has(folded)) {
            this.store.set(folded, value);
        }
        return this;
    }

    /**
     * Removes `value`, ignoring case.
     *
     * @returns `true` if a value was removed.
     */
    public delete(value: string): boolean {
        return this.store.delete(value.toLowerCase());
    }

    /** Removes all values. */
    public clear(): void {
        this.store.clear();
    }

    public keys(): IterableIterator<string> {
        return this.values();
    }

    public values(): IterableIterator<string> {
        return this.store.values();
    }

    /** Yields each value paired with itself, mirroring {@linkcode Set.entries}. */
    public *entries(): IterableIterator<[string, string]> {
        for (const value of this.values()) {
            yield [value, value];
        }
    }

    /** Calls `callback` for each value, in its original casing, in insertion order. */
    public forEach(callback: (value: string, value2: string, set: CaselessSet) => void, thisArg?: unknown): void {
        for (const value of this.values()) {
            callback.call(thisArg, value, value, this);
        }
    }

    public [Symbol.iterator](): IterableIterator<string> {
        return this.values();
    }
}
