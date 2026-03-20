/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PagedAsyncIterableIterator } from '@azure/core-paging';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { toPages } from '../../rest/toPages';

/** Helper to create a mock PagedAsyncIterableIterator from an array of pages. */
function mockIterator<T>(pages: T[][]): PagedAsyncIterableIterator<T, T[]> {
    const byPageIterator: AsyncIterableIterator<T[]> = {
        [Symbol.asyncIterator]() { return this; },
        next() {
            const result = pages.shift();
            return Promise.resolve(
                result !== undefined
                    ? { value: result, done: false as const }
                    : { value: undefined as unknown as T[], done: true as const },
            );
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
        const getContinuationToken = () => undefined;

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, getContinuationToken)) {
            result.push(page);
        }

        expect(result).to.have.length(2);
        expect(result[0].items).to.deep.equal(['a', 'b']);
        expect(result[1].items).to.deep.equal(['c']);
    });

    it('should set hasMore based on getContinuationToken', async () => {
        const pages = [['a', 'b'], ['c']];
        const iterator = mockIterator(pages);

        let callCount = 0;
        const getContinuationToken = () => {
            callCount++;
            return callCount === 1 ? 'token-for-next' : undefined;
        };

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, getContinuationToken)) {
            result.push(page);
        }

        expect(result[0].hasMore).to.be.true;
        expect(result[1].hasMore).to.be.false;
    });

    it('should apply a map function when provided', async () => {
        const iterator = mockIterator([[1, 2], [3]]);
        const getContinuationToken = () => undefined;

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, getContinuationToken, (n: number) => `item-${n}`)) {
            result.push(page);
        }

        expect(result[0].items).to.deep.equal(['item-1', 'item-2']);
        expect(result[1].items).to.deep.equal(['item-3']);
    });

    it('should handle an empty iterator', async () => {
        const iterator = mockIterator<string>([]);
        const getContinuationToken = () => undefined;

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, getContinuationToken)) {
            result.push(page);
        }

        expect(result).to.have.length(0);
    });

    it('should handle a single page with no items', async () => {
        const iterator = mockIterator<string>([[]]);
        const getContinuationToken = () => undefined;

        const result: { items: string[]; hasMore: boolean }[] = [];
        for await (const page of toPages(iterator, getContinuationToken)) {
            result.push(page);
        }

        expect(result).to.have.length(1);
        expect(result[0].items).to.deep.equal([]);
        expect(result[0].hasMore).to.be.false;
    });
});
