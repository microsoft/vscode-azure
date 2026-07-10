/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { getLastPick, type PickContext } from '../../../src/tree/pick/PickContext';

describe('getLastPick (unit)', () => {
    it('should return the last pick from the context', () => {
        const ctx: PickContext<string> = {
            picks: [
                { item: 'first', treeItem: { label: 'First' } },
                { item: 'second', treeItem: { label: 'Second' } },
            ],
        };

        const last = getLastPick(ctx);
        expect(last?.item).to.equal('second');
    });

    it('should return undefined for an empty picks array', () => {
        const ctx: PickContext<string> = { picks: [] };
        expect(getLastPick(ctx)).to.be.undefined;
    });

    it('should return the only pick when there is exactly one', () => {
        const ctx: PickContext<string> = {
            picks: [{ item: 'only', treeItem: { label: 'Only' } }],
        };

        expect(getLastPick(ctx)?.item).to.equal('only');
    });
});
