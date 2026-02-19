/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InflightMap } from './InflightMap';

export interface CacheKey {
    toString(): string;
}

export interface CacheEntry<TKey extends CacheKey, TValue> {
    readonly key: TKey;
    readonly value: TValue;
    readonly fetchedAt: number;
    readonly ttl: number;
}

export class Cache<TKey extends CacheKey, TValue> {
    private readonly cache = new Map<string, CacheEntry<TKey, TValue>>();
    private readonly inflight = new InflightMap<TValue>();

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

        // Cache miss or expired, fetch new value (deduped if already in-flight)
        return this.inflight.getOrRun(cacheKey, async () => {
            const value = await this.fillCache(key);
            this.cache.set(cacheKey, { key, value, fetchedAt: Date.now(), ttl: this.ttl });
            return value;
        });
    }

    public invalidate(key: TKey): void;
    public invalidate(selector: (key: TKey) => boolean): void;
    public invalidate(keyOrSelector: TKey | ((key: TKey) => boolean)): void {
        if (typeof keyOrSelector === 'function') {
            for (const entry of this.cache.values()) {
                if (keyOrSelector(entry.key)) {
                    this.cache.delete(entry.key.toString());
                }
            }
        } else {
            this.cache.delete(keyOrSelector.toString());
        }
    }
}
