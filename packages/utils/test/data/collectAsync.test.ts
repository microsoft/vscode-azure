/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { collectAsync, collectPageItems, collectPages, type Page } from '../../src/index';

describe('collectAsync (unit)', () => {
    it('should collect async iterable values in order', async () => {
        expect(await collectAsync(values(1, 2, 3))).to.deep.equal([1, 2, 3]);
    });

    it('should collect paged results', async () => {
        const pages = values<Page<string>>(
            { items: ['a'], hasMore: true },
            { items: ['b', 'c'], hasMore: false },
        );

        expect(await collectPages(pages)).to.deep.equal([
            { items: ['a'], hasMore: true },
            { items: ['b', 'c'], hasMore: false },
        ]);
    });

    it('should convert an array to one complete page', async () => {
        expect(await collectPages(['a', 'b'])).to.deep.equal([
            { items: ['a', 'b'], hasMore: false },
        ]);
    });

    it('should return no pages for a missing result', async () => {
        expect(await collectPages(undefined)).to.deep.equal([]);
    });

    it('should flatten items across pages', async () => {
        const pages = values<Page<string>>(
            { items: ['a'], hasMore: true },
            { items: ['b', 'c'], hasMore: false },
        );

        expect(await collectPageItems(pages)).to.deep.equal(['a', 'b', 'c']);
    });
});

async function* values<T>(...items: T[]): AsyncIterable<T> {
    for (const item of items) {
        yield await Promise.resolve(item);
    }
}
