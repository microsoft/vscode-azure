/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet } from '../../src/data/CaselessSet';

describe('CaselessSet (unit)', () => {
    describe('has', () => {
        it('should match values regardless of the casing on either side', () => {
            const set = new CaselessSet(['NODE_modules', 'Bin']);
            expect(set.has('node_modules')).to.be.true;
            expect(set.has('BIN')).to.be.true;
            expect(set.has('bIn')).to.be.true;
        });

        it('should return false for absent values', () => {
            const set = new CaselessSet(['bin']);
            expect(set.has('obj')).to.be.false;
        });

        it('should fold ordinally rather than by locale', () => {
            // Under a Turkish locale, `'I'.toLocaleLowerCase()` is the dotless '\u0131',
            // which would break matching against the ASCII 'i'.
            const set = new CaselessSet(['ID']);
            expect(set.has('id')).to.be.true;
            expect(set.has('\u0131d')).to.be.false;
        });
    });

    describe('add', () => {
        it('should not duplicate values differing only by case', () => {
            const set = new CaselessSet();
            set.add('Foo').add('FOO').add('foo');
            expect(set.size).to.equal(1);
        });

        it('should keep the casing of the first value added', () => {
            const set = new CaselessSet();
            set.add('Foo').add('FOO');
            expect([...set]).to.deep.equal(['Foo']);
        });

        it('should be chainable', () => {
            const set = new CaselessSet();
            expect(set.add('a')).to.equal(set);
        });
    });

    describe('delete', () => {
        it('should remove values regardless of casing', () => {
            const set = new CaselessSet(['Foo']);
            expect(set.delete('FOO')).to.be.true;
            expect(set.has('foo')).to.be.false;
            expect(set.size).to.equal(0);
        });

        it('should return false when the value is absent', () => {
            const set = new CaselessSet(['Foo']);
            expect(set.delete('bar')).to.be.false;
            expect(set.size).to.equal(1);
        });
    });

    describe('clear', () => {
        it('should remove all values', () => {
            const set = new CaselessSet(['a', 'b']);
            set.clear();
            expect(set.size).to.equal(0);
            expect([...set]).to.deep.equal([]);
        });
    });

    describe('iteration', () => {
        it('should yield the original casing in insertion order', () => {
            const set = new CaselessSet(['Alpha', 'BETA']);
            set.add('gamma');
            expect([...set]).to.deep.equal(['Alpha', 'BETA', 'gamma']);
            expect([...set.values()]).to.deep.equal(['Alpha', 'BETA', 'gamma']);
            expect([...set.keys()]).to.deep.equal(['Alpha', 'BETA', 'gamma']);
            expect([...set.entries()]).to.deep.equal([['Alpha', 'Alpha'], ['BETA', 'BETA'], ['gamma', 'gamma']]);
        });

        it('should visit each value once via forEach', () => {
            const set = new CaselessSet(['Alpha', 'BETA']);
            const seen: string[] = [];
            set.forEach((value, value2, source) => {
                expect(value2).to.equal(value);
                expect(source).to.equal(set);
                seen.push(value);
            });
            expect(seen).to.deep.equal(['Alpha', 'BETA']);
        });
    });
});
