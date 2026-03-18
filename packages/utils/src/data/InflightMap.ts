/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deduplicates concurrent async operations by key. If a call comes in for a key
 * that already has an in-flight promise, the existing promise is returned instead
 * of starting a new operation.
 *
 * TODO: add tests
 */
export class InflightMap<T> {
    private readonly inflight = new Map<string, Promise<T>>();

    /**
     * Returns `true` if an operation for the given key is currently in-flight.
     */
    public has(key: string): boolean {
        return this.inflight.has(key);
    }

    /**
     * Returns the result of `fn`, deduplicating by `key`. If a call for the same
     * key is already in-flight, the existing promise is returned. Otherwise, `fn`
     * is called and its promise is tracked until it settles.
     */
    public getOrRun(key: string, fn: () => Promise<T>): Promise<T> {
        let existing = this.inflight.get(key);
        if (!existing) {
            existing = Promise.resolve(fn()).finally(() => {
                this.inflight.delete(key);
            });
            this.inflight.set(key, existing);
        }
        return existing;
    }

    /**
     * Like {@link getOrRun}, but the entry is **kept** after the promise settles,
     * so subsequent calls return the cached result without re-invoking `fn`.
     */
    public getOrCreate(key: string, fn: () => Promise<T>): Promise<T> {
        let existing = this.inflight.get(key);
        if (!existing) {
            existing = Promise.resolve(fn());
            this.inflight.set(key, existing);
        }
        return existing;
    }
}
