/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { toPages } from '../../rest/toPages';

/** Helper to create a mock PagedAsyncIterableIterator from an array of pages. */
function mockIterator<T>(pages: T[][], hasMore?: boolean[]): PagedAsyncIterableIterator<T, T[]> {
    let index = 0;
    const byPageIterator: AsyncIterableIterator<T[]> = {
        [Symbol.asyncIterator]() { return this; },
        next() {
            const result = pages.shift();
            if (result === undefined) {
                return Promise.resolve({ value: undefined as unknown as T[], done: true as const });
            }
            const page = result;
            if (hasMore) {
                Object.assign(page, { continuationToken: hasMore[index] ? 'next-token' : undefined });
            }
            index++;
            return Promise.resolve({ value: page, done: false as const });
        },
    };

    return {
        [Symbol.asyncIterator]() { return this; },
        next: () => Promise.resolve({ value: undefined as unknown as T, done: true as const }),
        byPage: () => byPageIterator,
    };
}

describe('toPages (unit)', () => {
    it('should yield pages from the iterator', async () => {
        const iterator = mockIterator([['a', 'b'], ['c']]);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator)) {
            result.push(page);
        }

        expect(result).to.have.length(2);
        expect(result[0].items).to.deep.equal(['a', 'b']);
        expect(result[1].items).to.deep.equal(['c']);
    });

    it('should set hasMore based on continuationToken on the page array', async () => {
        const iterator = mockIterator([['a', 'b'], ['c']], [true, false]);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator)) {
            result.push(page);
        }

        expect(result[0].hasMore).to.be.true;
        expect(result[1].hasMore).to.be.false;
    });

    it('should apply a map function when provided', async () => {
        const iterator = mockIterator([[1, 2], [3]]);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, (n: number) => `item-${n}`)) {
            result.push(page);
        }

        expect(result[0].items).to.deep.equal(['item-1', 'item-2']);
        expect(result[1].items).to.deep.equal(['item-3']);
    });

    it('should use getContinuationToken when provided (classic SDK shape)', async () => {
        // Simulate a classic SDK: pages do NOT carry continuationToken on
        // the array; instead the SDK exposes a separate helper.
        const tokens = new WeakMap<object, string>();
        const pages = [[1, 2], [3]];
        tokens.set(pages[0], 'next-token');
        const iterator = mockIterator(pages);
        const getContinuationToken = (page: unknown) => tokens.get(page as object);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, (n: number) => `item-${n}`, getContinuationToken)) {
            result.push(page);
        }

        expect(result[0].items).to.deep.equal(['item-1', 'item-2']);
        expect(result[0].hasMore).to.be.true;
        expect(result[1].items).to.deep.equal(['item-3']);
        expect(result[1].hasMore).to.be.false;
    });

    it('should handle an empty iterator', async () => {
        const iterator = mockIterator<string>([]);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator)) {
            result.push(page);
        }

        expect(result).to.have.length(0);
    });

    it('should handle a single page with no items', async () => {
        const iterator = mockIterator<string>([[]]);

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator)) {
            result.push(page);
        }

        expect(result).to.have.length(1);
        expect(result[0].items).to.deep.equal([]);
        expect(result[0].hasMore).to.be.false;
    });
});
