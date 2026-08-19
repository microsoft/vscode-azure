/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPageItems, type Page } from '@microsoft/vscode-azure-utils';
import * as assert from 'node:assert';
import { mock } from 'node:test';
import { CachedPagedListing } from '../../../src/auth/listing/CachedPagedListing';

/** A listing of `count` single-item pages that records how many were pulled. */
function countingPages(count: number) {
    const pulled: number[] = [];
    const factory = mock.fn(async function* (): AsyncIterable<Page<string>> {
        for (let index = 0; index < count; index++) {
            pulled.push(index);
            yield await Promise.resolve({ items: [`item-${index}`], hasMore: index < count - 1 });
        }
    });
    return { factory, pulled };
}

describe('CachedPagedListing (unit)', () => {
    it('pulls only the pages a reader asks for', async () => {
        const { factory, pulled } = countingPages(5);
        const listing = new CachedPagedListing(factory);

        for await (const page of listing.read()) {
            assert.deepStrictEqual(page.items, ['item-0']);
            break;
        }

        assert.deepStrictEqual(pulled, [0], 'a reader that stopped after one page must not have provoked more');
        assert.strictEqual(listing.isComplete, false);
    });

    it('resumes a partially-read listing instead of restarting it', async () => {
        const { factory, pulled } = countingPages(3);
        const listing = new CachedPagedListing(factory);

        // Pull exactly one page, leaving the rest of the listing unread.
        await listing.read()[Symbol.asyncIterator]().next();
        const all = await collectPageItems(listing.read());

        assert.deepStrictEqual(all, ['item-0', 'item-1', 'item-2']);
        assert.deepStrictEqual(pulled, [0, 1, 2], 'each page must be produced exactly once');
        assert.strictEqual(factory.mock.callCount(), 1);
        assert.strictEqual(listing.isComplete, true);
    });

    it('replays a completed listing without touching the source', async () => {
        const { factory, pulled } = countingPages(2);
        const listing = new CachedPagedListing(factory);

        assert.deepStrictEqual(await collectPageItems(listing.read()), ['item-0', 'item-1']);
        assert.deepStrictEqual(await collectPageItems(listing.read()), ['item-0', 'item-1']);
        assert.deepStrictEqual(pulled, [0, 1]);
    });

    it('collapses concurrent reads of the same listing into one pull', async () => {
        const { factory, pulled } = countingPages(3);
        const listing = new CachedPagedListing(factory);

        const [first, second] = await Promise.all([
            collectPageItems(listing.read()),
            collectPageItems(listing.read()),
        ]);

        assert.deepStrictEqual(first, ['item-0', 'item-1', 'item-2']);
        assert.deepStrictEqual(second, first);
        assert.deepStrictEqual(pulled, [0, 1, 2], 'concurrent readers must share pulls, not duplicate them');
    });

    it('indexes each page as it arrives, not when the listing completes', async () => {
        const seen: string[][] = [];
        const { factory } = countingPages(3);
        const listing = new CachedPagedListing(factory, page => seen.push([...page.items]));

        // Pull exactly one page, leaving the rest of the listing unread.
        await listing.read()[Symbol.asyncIterator]().next();

        assert.deepStrictEqual(seen, [['item-0']], 'the first page must be indexed before the second is pulled');
    });

    it('discards the pages already collected when a listing fails', async () => {
        let attempt = 0;
        const factory = mock.fn(async function* (): AsyncIterable<Page<string>> {
            attempt++;
            yield await Promise.resolve({ items: [`attempt-${attempt}-a`], hasMore: true });
            if (attempt === 1) {
                throw new Error('listing failed');
            }
            yield await Promise.resolve({ items: [`attempt-${attempt}-b`], hasMore: false });
        });
        const listing = new CachedPagedListing(factory);

        await assert.rejects(() => collectPageItems(listing.read()), /listing failed/);

        // Keeping the first page would replay a truncated listing as if it were
        // complete: the retry would serve one page and then stop.
        const retried = await collectPageItems(listing.read());
        assert.deepStrictEqual(retried, ['attempt-2-a', 'attempt-2-b']);
        assert.strictEqual(listing.isComplete, true);
    });

    it('fails a reader whose collected pages another reader discarded', async () => {
        let attempt = 0;
        const factory = mock.fn(async function* (): AsyncIterable<Page<string>> {
            const current = ++attempt;
            for (let index = 0; ; index++) {
                if (current === 1 && index === 2) {
                    throw new Error('listing failed');
                }
                yield await Promise.resolve({ items: [`attempt-${current}-${index}`], hasMore: true });
            }
        });
        const listing = new CachedPagedListing(factory);

        // Advance one reader past the pages that are about to be discarded, then
        // let a second reader drive the pull that fails.
        const reader = listing.read()[Symbol.asyncIterator]();
        assert.deepStrictEqual((await reader.next()).value?.items, ['attempt-1-0']);
        assert.deepStrictEqual((await reader.next()).value?.items, ['attempt-1-1']);
        await assert.rejects(() => collectPageItems(listing.read()), /listing failed/);

        // Resuming at the old offset would splice the second attempt's tail onto
        // the first attempt's head, silently swallowing everything in between.
        await assert.rejects(() => reader.next(), /listing failed/);
    });
});
