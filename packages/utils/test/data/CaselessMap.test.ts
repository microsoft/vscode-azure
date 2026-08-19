/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessMap } from '../../src/data/CaselessMap';

describe('CaselessMap (unit)', () => {
    describe('get and has', () => {
        it('should match keys regardless of the casing on either side', () => {
            const map = new CaselessMap([['Foo', 1], ['BAR', 2]]);
            expect(map.get('foo')).to.equal(1);
            expect(map.get('bar')).to.equal(2);
            expect(map.has('fOo')).to.be.true;
        });

        it('should return undefined and false for absent keys', () => {
            const map = new CaselessMap([['Foo', 1]]);
            expect(map.get('baz')).to.be.undefined;
            expect(map.has('baz')).to.be.false;
        });

        it('should fold ordinally rather than by locale', () => {
            // Under a Turkish locale, `'I'.toLocaleLowerCase()` is the dotless '\u0131',
            // which would break matching against the ASCII 'i'.
            const map = new CaselessMap([['ID', 1]]);
            expect(map.get('id')).to.equal(1);
            expect(map.get('\u0131d')).to.be.undefined;
        });
    });

    describe('set', () => {
        it('should not duplicate keys differing only by case', () => {
            const map = new CaselessMap<number>();
            map.set('Foo', 1).set('FOO', 2);
            expect(map.size).to.equal(1);
        });

        it('should replace the value but keep the casing of the first key set', () => {
            const map = new CaselessMap<number>();
            map.set('Foo', 1).set('FOO', 2);
            expect(map.get('foo')).to.equal(2);
            expect([...map.keys()]).to.deep.equal(['Foo']);
        });

        it('should be chainable', () => {
            const map = new CaselessMap<number>();
            expect(map.set('a', 1)).to.equal(map);
        });
    });

    describe('delete', () => {
        it('should remove entries regardless of casing', () => {
            const map = new CaselessMap([['Foo', 1]]);
            expect(map.delete('FOO')).to.be.true;
            expect(map.has('foo')).to.be.false;
            expect(map.size).to.equal(0);
        });

        it('should return false when the key is absent', () => {
            const map = new CaselessMap([['Foo', 1]]);
            expect(map.delete('bar')).to.be.false;
            expect(map.size).to.equal(1);
        });
    });

    describe('clear', () => {
        it('should remove all entries', () => {
            const map = new CaselessMap([['a', 1], ['b', 2]]);
            map.clear();
            expect(map.size).to.equal(0);
            expect([...map]).to.deep.equal([]);
        });
    });

    describe('iteration', () => {
        it('should yield the original key casing in insertion order', () => {
            const map = new CaselessMap([['Alpha', 1], ['BETA', 2]]);
            map.set('gamma', 3);
            expect([...map.keys()]).to.deep.equal(['Alpha', 'BETA', 'gamma']);
            expect([...map.values()]).to.deep.equal([1, 2, 3]);
            expect([...map.entries()]).to.deep.equal([['Alpha', 1], ['BETA', 2], ['gamma', 3]]);
            expect([...map]).to.deep.equal([['Alpha', 1], ['BETA', 2], ['gamma', 3]]);
        });

        it('should reflect a value replaced through a differently-cased key', () => {
            const map = new CaselessMap([['Alpha', 1]]);
            map.set('ALPHA', 9);
            expect([...map.entries()]).to.deep.equal([['Alpha', 9]]);
        });

        it('should visit each entry once via forEach', () => {
            const map = new CaselessMap([['Alpha', 1], ['BETA', 2]]);
            const seen: [string, number][] = [];
            map.forEach((value, key, source) => {
                expect(source).to.equal(map);
                seen.push([key, value]);
            });
            expect(seen).to.deep.equal([['Alpha', 1], ['BETA', 2]]);
        });
    });
});
