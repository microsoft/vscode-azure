/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap } from '../../src/data/CaselessMap';

/** Builds a map from `[key, value]` pairs, since the class takes no initializer. */
function makeMap<V>(entries: readonly (readonly [string, V])[]): CaselessMap<V> {
    const map = new CaselessMap<V>();
    for (const [key, value] of entries) {
        map.set(key, value);
    }
    return map;
}

describe('CaselessMap (unit)', () => {
    describe('get and has', () => {
        it('should match keys regardless of the casing on either side', () => {
            const map = makeMap([['Foo', 1], ['BAR', 2]]);
            expect(map.get('foo')).to.equal(1);
            expect(map.get('bar')).to.equal(2);
            expect(map.has('fOo')).to.be.true;
        });

        it('should return undefined and false for absent keys', () => {
            const map = makeMap([['Foo', 1]]);
            expect(map.get('baz')).to.be.undefined;
            expect(map.has('baz')).to.be.false;
        });

        it('should fold ordinally rather than by locale', () => {
            // Under a Turkish locale, `'I'.toLocaleLowerCase()` is the dotless '\u0131',
            // which would break matching against the ASCII 'i'.
            const map = makeMap([['ID', 1]]);
            expect(map.get('id')).to.equal(1);
            expect(map.get('\u0131d')).to.be.undefined;
        });
    });

    describe('set', () => {
        it('should not duplicate keys differing only by case', () => {
            const map = makeMap([['Foo', 1], ['FOO', 2]]);
            expect([...map.values()]).to.deep.equal([2]);
        });

        it('should replace the value but keep the casing of the first key set', () => {
            const map = makeMap([['Foo', 1], ['FOO', 2]]);
            expect(map.get('foo')).to.equal(2);
            expect([...map]).to.deep.equal([['Foo', 2]]);
        });

        it('should be chainable', () => {
            const map = new CaselessMap<number>();
            expect(map.set('a', 1)).to.equal(map);
        });
    });

    describe('delete', () => {
        it('should remove entries regardless of casing', () => {
            const map = makeMap([['Foo', 1]]);
            expect(map.delete('FOO')).to.be.true;
            expect(map.has('foo')).to.be.false;
            expect([...map]).to.deep.equal([]);
        });

        it('should return false when the key is absent', () => {
            const map = makeMap([['Foo', 1]]);
            expect(map.delete('bar')).to.be.false;
            expect(map.has('foo')).to.be.true;
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            const map = makeMap([['a', 1], ['b', 2]]);
            map.clear();
            expect([...map]).to.deep.equal([]);
        });
    });

    describe('iteration', () => {
        it('should yield the original key casing in insertion order', () => {
            const map = makeMap([['Alpha', 1], ['BETA', 2]]);
            map.set('gamma', 3);
            expect([...map]).to.deep.equal([['Alpha', 1], ['BETA', 2], ['gamma', 3]]);
            expect([...map.values()]).to.deep.equal([1, 2, 3]);
        });

        it('should reflect a value replaced through a differently-cased key', () => {
            const map = makeMap([['Alpha', 1]]);
            map.set('ALPHA', 9);
            expect([...map]).to.deep.equal([['Alpha', 9]]);
        });
    });
});
