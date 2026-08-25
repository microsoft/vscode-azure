/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { collectPages } from '../../src/index';
import { filterPages, flattenPages, isAsyncIterable, type Page } from '../../src/data/Page';

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

    describe('filterPages', () => {
        function pages(): AsyncIterable<Page<string>> {
            return toAsync<Page<string>>([
                { items: ['a', 'b'], hasMore: true },
                { items: ['c'], hasMore: false },
            ]);
        }

        it('should drop rejected items without merging or dropping pages', async () => {
            const result = await collectPages(filterPages(pages(), item => item !== 'b'));

            expect(result).to.deep.equal([
                { items: ['a'], hasMore: true },
                { items: ['c'], hasMore: false },
            ]);
        });

        it('should keep a page that lost every item, so hasMore still reaches the reader', async () => {
            const result = await collectPages(filterPages(pages(), item => item === 'c'));

            expect(result).to.deep.equal([
                { items: [], hasMore: true },
                { items: ['c'], hasMore: false },
            ]);
        });

        it('should admit everything when no predicate is given', async () => {
            const result = await collectPages(filterPages(pages()));

            expect(result).to.deep.equal([
                { items: ['a', 'b'], hasMore: true },
                { items: ['c'], hasMore: false },
            ]);
        });

        it('should pull only the pages the reader asks for', async () => {
            const pulled: string[] = [];
            async function* counting(): AsyncIterable<Page<string>> {
                pulled.push('first');
                yield await Promise.resolve({ items: ['a'], hasMore: true });
                pulled.push('second');
                yield await Promise.resolve({ items: ['b'], hasMore: false });
            }

            await filterPages(counting(), () => true)[Symbol.asyncIterator]().next();

            expect(pulled).to.deep.equal(['first']);
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
