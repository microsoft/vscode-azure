/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { flattenPages, isAsyncIterable, type Page } from '../../data/Page';

describe('Page (unit)', () => {
    describe('isAsyncIterable', () => {
        it('should return true for an async iterable', () => {
            const iterable = { [Symbol.asyncIterator]: () => ({}) };
            expect(isAsyncIterable(iterable as AsyncIterable<Page<unknown>>)).to.be.true;
        });

        it('should return false for a plain array', () => {
            expect(isAsyncIterable([1, 2, 3])).to.be.false;
        });

        it('should return false for an empty array', () => {
            expect(isAsyncIterable([])).to.be.false;
        });
    });

    describe('flattenPages', () => {
        it('should yield all items from multiple pages', async () => {
            function* pages(): Iterable<Page<string>> {
                yield { items: ['a', 'b'], hasMore: true };
                yield { items: ['c'], hasMore: false };
            }

            const items: string[] = [];
            for await (const item of flattenPages(toAsync(pages()))) {
                items.push(item);
            }

            expect(items).to.deep.equal(['a', 'b', 'c']);
        });

        it('should handle empty pages', async () => {
            function* pages(): Iterable<Page<string>> {
                yield { items: [], hasMore: true };
                yield { items: ['a'], hasMore: false };
            }

            const items: string[] = [];
            for await (const item of flattenPages(toAsync(pages()))) {
                items.push(item);
            }

            expect(items).to.deep.equal(['a']);
        });

        it('should yield nothing for zero pages', async () => {
            const items: string[] = [];
            for await (const item of flattenPages(toAsync<Page<string>>([]))) {
                items.push(item);
            }

            expect(items).to.deep.equal([]);
        });
    });
});

function toAsync<T>(iterable: Iterable<T>): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            const iter = iterable[Symbol.iterator]();
            return {
                next: () => Promise.resolve(iter.next()),
            };
        },
    };
}
