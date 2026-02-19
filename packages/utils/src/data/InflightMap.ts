/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deduplicates concurrent async operations by key. If a call comes in for a key
 * that already has an in-flight promise, the existing promise is returned instead
 * of starting a new operation.
 */
export class InflightMap<T> {
    private readonly inflight = new Map<string, Promise<T>>();

    /**
     * Returns the result of `fn`, deduplicating by `key`. If a call for the same
     * key is already in-flight, the existing promise is returned. Otherwise, `fn`
     * is called and its promise is tracked until it settles.
     */
    public getOrRun(key: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.inflight.get(key);
        if (existing) {
            return existing;
        }

        const promise = fn().finally(() => {
            this.inflight.delete(key);
        });

        this.inflight.set(key, promise);
        return promise;
    }
}
