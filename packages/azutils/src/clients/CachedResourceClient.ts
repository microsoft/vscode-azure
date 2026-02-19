/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Cache, type CacheKey, type IVsCode } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';
import type { ResourceClientResolver } from './ResourceClientResolver';

/**
 * Base class for high-level Azure resource clients that adds list-caching with
 * TTL + inflight deduplication and change-notification on top of the low-level
 * REST client.
 *
 * Subclasses implement {@link fetchList} to call the appropriate REST API, and
 * may add additional methods (e.g. `get()`, `getByList()`).
 *
 * @typeParam TScope - The cache key type for list operations.
 */
export abstract class CachedResourceClient<TScope extends CacheKey> {
    private readonly listCache: Cache<TScope, GenericResource[]>;
    private readonly emitter;

    /** Fires when cached data has been invalidated. */
    public readonly onDidChange;

    protected constructor(
        vscode: IVsCode,
        protected readonly resolveClient: ResourceClientResolver,
        ttl: number,
    ) {
        this.emitter = new vscode.EventEmitter<void>();
        this.onDidChange = this.emitter.event;
        this.listCache = new Cache(
            (scope) => this.fetchList(scope),
            ttl,
        );
    }

    /**
     * List resources for the given scope. Cached with TTL; concurrent calls
     * for the same scope are coalesced.
     */
    public async list(scope: TScope): Promise<GenericResource[]> {
        return this.listCache.get(scope);
    }

    /** Invalidate cached results for a specific scope. */
    public invalidate(scope: TScope): void;
    /** Invalidate cached results matching a selector. */
    public invalidate(selector: (scope: TScope) => boolean): void;
    public invalidate(scopeOrSelector: TScope | ((scope: TScope) => boolean)): void {
        this.listCache.invalidate(scopeOrSelector as TScope);
        this.emitter.fire();
    }

    /** Dispose the change-notification emitter. */
    public dispose(): void {
        this.emitter.dispose();
    }

    /** Fetch the resource list from the API. Called by the cache on a miss. */
    protected abstract fetchList(scope: TScope): Promise<GenericResource[]>;
}
