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
 * A pull that throws **poisons** the listing permanently: the error reaches
 * every reader, including one that had already advanced past earlier pages and
 * comes back for more, and no further pull is attempted. Retaining a truncated
 * result would let a later read replay it as if it were the whole listing, and
 * silently resuming a reader across a failed pull would splice two different
 * attempts together. Retrying is the owner's job -- {@linkcode AzureListingStore}
 * replaces a poisoned listing with a fresh one on the next read.
 *
 * @typeParam T - The item type carried by each {@linkcode Page}.
 */
export class CachedPagedListing<T> {
    private readonly pages: Page<T>[] = [];
    private iterator: AsyncIterator<Page<T>> | undefined;
    private exhausted = false;
    private pending: Promise<boolean> | undefined;
    /** Boxed so a thrown `undefined` still registers as a failure. */
    private failure: { readonly error: unknown } | undefined;

    /**
     * @param factory - Produces the underlying listing, called on the first
     *   pull. Replays and resumed reads reuse the iterator it returned.
     */
    public constructor(private readonly factory: () => AsyncIterable<Page<T>>) { }

    /** Whether a pull has thrown, leaving this listing permanently unusable. */
    public get hasFailed(): boolean {
        return this.failure !== undefined;
    }

    /**
     * Read the listing from the beginning, replaying cached pages first and
     * fetching further pages only if the reader keeps asking.
     *
     * @throws The failure that poisoned the listing, if any pull has thrown.
     */
    public async *read(): AsyncIterable<Page<T>> {
        let index = 0;

        for (; ;) {
            if (this.failure) {
                throw this.failure.error;
            }

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
            return true;
        } catch (error) {
            this.failure = { error };
            throw error;
        }
    }
}
