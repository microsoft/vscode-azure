/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CacheKey {
    toString(): string;
}

export interface CacheEntry<T> {
    readonly value: T;
    readonly fetchedAt: number;
    readonly ttl: number;
}

export class Cache<TKey extends CacheKey, TValue> {
    private readonly cache = new Map<string, CacheEntry<TValue>>();
    private readonly inflight = new Map<string, Promise<TValue>>();

    public constructor(
        private readonly fillCache: (key: TKey) => Promise<TValue>,
        private readonly ttl: number
    ) { }

    public async get(key: TKey): Promise<TValue> {
        const cacheKey = key.toString();
        const maybeEntry = this.cache.get(cacheKey);

        if (maybeEntry && (Date.now() <= maybeEntry.fetchedAt + maybeEntry.ttl)) {
            // Cache hit and still valid
            return maybeEntry.value;
        } else if (maybeEntry) {
            // Cache hit but expired, delete and then fall into below logic to refresh
            this.cache.delete(cacheKey);
        }

        // If there's already an in-flight fetch for this key, piggyback on it
        const existing = this.inflight.get(cacheKey);
        if (existing) {
            return existing;
        }

        // Cache miss or expired, fetch new value
        const promise = this.fillCache(key).then(value => {
            this.cache.set(cacheKey, { value, fetchedAt: Date.now(), ttl: this.ttl });
            return value;
        }).finally(() => {
            this.inflight.delete(cacheKey);
        });

        this.inflight.set(cacheKey, promise);
        return promise;
    }

    public invalidate(key: TKey): void;
    public invalidate(selector: (stringKey: string) => boolean): void;
    public invalidate(keyOrSelector: TKey | ((stringKey: string) => boolean)): void {
        if (typeof keyOrSelector === 'function') {
            for (const cacheKey of this.cache.keys()) {
                const key = cacheKey;
                if (keyOrSelector(key)) {
                    this.cache.delete(cacheKey);
                }
            }
        } else {
            this.cache.delete(keyOrSelector.toString());
        }
    }
}
