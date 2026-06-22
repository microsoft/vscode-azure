/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert';
import { Everything, isKeyMatch, Roots, selfOnly, subtreeOf } from '../../tree/Selector';

describe('Selector (unit)', () => {
    describe('selfOnly', () => {
        it('builds a self-scoped key match recognized by isKeyMatch', () => {
            const match = selfOnly('a', 'b');
            assert.strictEqual(match.scope, 'self');
            assert.deepStrictEqual([...match.match], ['a', 'b']);
            assert.strictEqual(isKeyMatch(match), true);
        });

        it('accepts resource objects as well as keys', () => {
            const resource = { id: 'r1' };
            const match = selfOnly<{ id: string }>(resource, 'k1');
            assert.strictEqual(match.scope, 'self');
            assert.deepStrictEqual([...match.match], [resource, 'k1']);
        });
    });

    describe('subtreeOf', () => {
        it('builds a subtree-scoped key match recognized by isKeyMatch', () => {
            const match = subtreeOf('a');
            assert.strictEqual(match.scope, 'subtree');
            assert.deepStrictEqual([...match.match], ['a']);
            assert.strictEqual(isKeyMatch(match), true);
        });
    });

    describe('isKeyMatch', () => {
        it('rejects values that are not key matches', () => {
            assert.strictEqual(isKeyMatch(undefined), false);
            assert.strictEqual(isKeyMatch(null), false);
            assert.strictEqual(isKeyMatch('a'), false);
            assert.strictEqual(isKeyMatch(123), false);
            assert.strictEqual(isKeyMatch(['a', 'b']), false);
            assert.strictEqual(isKeyMatch({ scope: 'self', match: ['a'] }), false);
            assert.strictEqual(isKeyMatch(() => 'self'), false);
            assert.strictEqual(isKeyMatch(Roots), false);
            assert.strictEqual(isKeyMatch(Everything), false);
        });
    });

    describe('sentinels', () => {
        it('Roots and Everything are distinct symbols', () => {
            assert.strictEqual(typeof Roots, 'symbol');
            assert.strictEqual(typeof Everything, 'symbol');
            assert.notStrictEqual(Roots, Everything);
        });
    });
});
