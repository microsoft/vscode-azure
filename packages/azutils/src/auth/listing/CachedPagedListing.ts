/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '@microsoft/vscode-azure-utils';

/**
 * A lazily-consumed paged listing that remembers the pages it has already
 * produced, so a later reader replays them instead of re-fetching.
 *
 * Pages are pulled from the underlying iterator only as far as a reader actually
 * asks for them, which preserves a caller's ability to read just the first page
 * of a very long listing. A later reader that wants more resumes pulling from
 * the same iterator and appends to the same page list, so a partially-read
 * listing is completed rather than restarted.
 *
 * Concurrent readers are safe: a pull that is already in flight is shared rather
 * than duplicated, so overlapping reads never issue the same request twice.
 *
 * A pull that throws is **not** cached -- the error propagates to the waiting
 * readers, the partially-fetched pages are discarded, and the next read starts a
 * fresh listing. This matters because a listing can fail for transient reasons
 * (an expired session, a network blip), and retaining a truncated result would
 * let a retry replay it as if it were the whole listing.
 *
 * @typeParam T - The item type carried by each {@linkcode Page}.
 */
export class CachedPagedListing<T> {
    private readonly pages: Page<T>[] = [];
    private iterator: AsyncIterator<Page<T>> | undefined;
    private exhausted = false;
    private pending: Promise<boolean> | undefined;

    /**
     * @param factory - Produces the underlying listing. Called on the first pull
     *   and again after a failure discards the previous attempt; replays and
     *   resumed reads reuse the iterator it returned.
     * @param onPage - (Optional) Called once for each page that is newly
     *   fetched (never for a replayed page), before the page reaches the reader
     *   that triggered the pull.
     */
    public constructor(
        private readonly factory: () => AsyncIterable<Page<T>>,
        private readonly onPage?: (page: Page<T>) => void,
    ) { }

    /**
     * Whether the underlying listing ran to completion, so the cached pages are
     * the *whole* listing rather than a prefix of it.
     *
     * A complete listing with no items is meaningfully different from a listing
     * that was never started: the former is a cached "there are none".
     */
    public get isComplete(): boolean {
        return this.exhausted;
    }

    /**
     * Read the listing from the beginning, replaying cached pages first and
     * fetching further pages only if the reader keeps asking.
     */
    public async *read(): AsyncIterable<Page<T>> {
        let index = 0;

        for (; ;) {
            if (index < this.pages.length) {
                yield this.pages[index++];
                continue;
            }

            if (this.exhausted || !await this.advance()) {
                return;
            }
        }
    }

    /**
     * Pull one more page, coalescing with any pull already in flight so
     * concurrent readers share a single request.
     *
     * @returns `true` if a page was appended, `false` if the listing ended.
     */
    private advance(): Promise<boolean> {
        this.pending ??= this.pullNext().finally(() => { this.pending = undefined; });
        return this.pending;
    }

    private async pullNext(): Promise<boolean> {
        if (this.exhausted) {
            return false;
        }

        try {
            this.iterator ??= this.factory()[Symbol.asyncIterator]();
            const result = await this.iterator.next();
            if (result.done) {
                this.exhausted = true;
                return false;
            }

            this.pages.push(result.value);
            this.onPage?.(result.value);
            return true;
        } catch (error) {
            // Discard the partial state: the iterator is spent once it has
            // thrown, and the pages already pulled came from a listing that
            // never completed. Dropping both lets the next read start a clean
            // listing instead of resuming a broken one or replaying a truncated
            // result as if it were whole.
            this.iterator = undefined;
            this.pages.length = 0;
            throw error;
        }
    }
}
