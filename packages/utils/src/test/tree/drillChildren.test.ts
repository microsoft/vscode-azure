/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock } from 'node:test';
import type { DataItemTree } from '../../tree/DataItemTree';
import { drillChildren } from '../../tree/drillChildren';

describe('drillChildren (unit)', () => {
    /**
     * Build a minimal paged {@linkcode DataItemTree} stand-in for a single
     * resource whose children are split into `pages`. `loadMore` advances the
     * number of revealed pages and `getChildren` returns the cumulative list,
     * mirroring how the real tree appends pages to its cache.
     */
    function createPagedTree<T>(resource: T, pages: T[][]) {
        let loadedPages = 1;

        const getChildren = mock.fn((node?: T, _options?: unknown): Promise<T[]> => {
            if (node !== resource) {
                return Promise.resolve([]);
            }
            return Promise.resolve(pages.slice(0, loadedPages).flat());
        });

        const hasMore = mock.fn((node?: T): boolean => {
            if (node !== resource) {
                return false;
            }
            return loadedPages < pages.length;
        });

        const loadMore = mock.fn((_node: T): Promise<void> => {
            loadedPages++;
            return Promise.resolve();
        });

        const tree = { getChildren, hasMore, loadMore } as unknown as DataItemTree<T>;
        return { tree, getChildren, hasMore, loadMore };
    }

    async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
        const result: T[] = [];
        for await (const item of iterable) {
            result.push(item);
        }
        return result;
    }

    it('should yield every child across all pages', async () => {
        const { tree } = createPagedTree('parent', [['a', 'b'], ['c'], ['d', 'e']]);

        const result = await collect(drillChildren(tree, 'parent'));

        expect(result).to.deep.equal(['a', 'b', 'c', 'd', 'e']);
    });

    it('should yield each item exactly once even though getChildren returns cumulative pages', async () => {
        const { tree } = createPagedTree('parent', [['a'], ['b'], ['c']]);

        const result = await collect(drillChildren(tree, 'parent'));

        expect(result).to.deep.equal(['a', 'b', 'c']);
    });

    it('should lazily load pages only as the consumer pulls them', async () => {
        const { tree, loadMore } = createPagedTree('parent', [['a'], ['b'], ['c']]);

        const iterator = drillChildren(tree, 'parent')[Symbol.asyncIterator]();

        // Pulling the first page should not have triggered any loadMore yet.
        await iterator.next();
        expect(loadMore.mock.callCount()).to.equal(0);

        // Draining the rest pulls the remaining two pages.
        await iterator.next();
        await iterator.next();
        await iterator.next();
        expect(loadMore.mock.callCount()).to.equal(2);
    });

    it('should not page root-level children', async () => {
        const roots = ['x', 'y'];
        const getChildren = mock.fn((node?: string): Promise<string[]> =>
            Promise.resolve(node === undefined ? roots : []),
        );
        const hasMore = mock.fn((_node?: string): boolean => true);
        const loadMore = mock.fn((_node: string): Promise<void> => Promise.resolve());
        const tree = { getChildren, hasMore, loadMore } as unknown as DataItemTree<string>;

        const result = await collect(drillChildren(tree));

        expect(result).to.deep.equal(['x', 'y']);
        // Roots are not paged: hasMore/loadMore must never be consulted for them.
        expect(hasMore.mock.callCount()).to.equal(0);
        expect(loadMore.mock.callCount()).to.equal(0);
    });

    it('should handle an empty first page with no further pages', async () => {
        const { tree } = createPagedTree('parent', [[]]);

        const result = await collect(drillChildren(tree, 'parent'));

        expect(result).to.deep.equal([]);
    });

    it('should forward fetch options to the initial getChildren call', async () => {
        const { tree, getChildren } = createPagedTree('parent', [['a', 'b']]);
        const options = { allowInteraction: false };

        await collect(drillChildren(tree, 'parent', options));

        // The first-page fetch receives the options; the hint is not part of the
        // cache key, so only the initial getChildren needs to carry it.
        expect(getChildren.mock.calls[0].arguments[1]).to.deep.equal(options);
    });
});
