/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cache, type CacheKey, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { ResourceFetcher } from './ResourceFetcher';

/**
 * A generic resource store that wraps a list-scoped cache and exposes a
 * change-notification event.
 *
 * - `list()` is cached with TTL and inflight deduplication.
 * - `get()` always fetches fresh from the API (uncached).
 * - `getByList()` is a convenience: calls `list()` and picks out the match.
 * - `invalidate()` clears cache entries and fires `onDidChange`.
 *
 * One instance per resource type. Supply a {@link ResourceFetcher} to teach
 * the store how to call the API for your resource type.
 *
 * @typeParam TResource - The resource shape stored and returned.
 * @typeParam TScopeKey - The cache key type for list operations.
 * @typeParam TItemKey - The key type for identifying a single resource.
 */
export class ResourceStore<TResource, TScopeKey extends CacheKey, TItemKey> {
    private readonly listCache: Cache<TScopeKey, TResource[]>;
    private readonly emitter;

    /** Fires when cached data has been invalidated. Subscribe to re-render views. */
    public readonly onDidChange;

    public constructor(
        code: IVsCode,
        private readonly fetcher: ResourceFetcher<TResource, TScopeKey, TItemKey>,
        ttl: number,
    ) {
        this.emitter = new code.EventEmitter<void>();
        this.onDidChange = this.emitter.event;
        this.listCache = new Cache<TScopeKey, TResource[]>(
            (scope) => this.fetcher.fetchList(scope),
            ttl,
        );
    }

    /**
     * List resources for the given scope. Results are cached with TTL
     * and concurrent calls for the same scope are coalesced.
     */
    public async list(scope: TScopeKey): Promise<TResource[]> {
        return this.listCache.get(scope);
    }

    /**
     * Get a single resource by key. Always fetches fresh from the API (uncached).
     */
    public async get(key: TItemKey): Promise<TResource> {
        return this.fetcher.fetchItem(key);
    }

    /**
     * Get a single resource by listing its scope and picking out the match.
     * Benefits from the list cache — if the scope was recently listed, no
     * network call is made.
     *
     * @returns The matching resource, or `undefined` if not found in the list.
     */
    public async getByList(scope: TScopeKey, key: TItemKey): Promise<TResource | undefined> {
        const resources = await this.list(scope);
        return resources.find((r) => this.fetcher.itemKeyEquals(r, key));
    }

    /**
     * Invalidate cached list results for a specific scope and notify listeners.
     */
    public invalidate(scope: TScopeKey): void;
    /**
     * Invalidate cached list results matching a selector and notify listeners.
     */
    public invalidate(selector: (scope: TScopeKey) => boolean): void;
    public invalidate(scopeOrSelector: TScopeKey | ((scope: TScopeKey) => boolean)): void {
        this.listCache.invalidate(scopeOrSelector as TScopeKey);
        this.emitter.fire();
    }

    /** Dispose the change-notification emitter. */
    public dispose(): void {
        this.emitter.dispose();
    }
}
