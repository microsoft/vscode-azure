/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { Disposable } from '../../vscode/Disposable';

describe('Disposable (unit)', () => {
    describe('None', () => {
        it('should have a dispose method that does nothing', () => {
            expect(() => { Disposable.None.dispose(); }).to.not.throw();
        });
    });

    describe('test', () => {
        it('should return true for objects with a dispose function', () => {
            const d = { dispose(): void { /* noop */ } };
            expect(Disposable.test(d)).to.be.true;
        });

        it('should return false for objects without dispose', () => {
            expect(Disposable.test({})).to.be.false;
        });

        it('should return false for null/undefined', () => {
            expect(Disposable.test(null)).to.be.false;
            expect(Disposable.test(undefined)).to.be.false;
        });

        it('should return false for non-objects', () => {
            expect(Disposable.test('string')).to.be.false;
            expect(Disposable.test(42)).to.be.false;
        });

        it('should return false when dispose is not a function', () => {
            expect(Disposable.test({ dispose: 'not a function' })).to.be.false;
        });
    });

    describe('from', () => {
        it('should dispose all passed disposables', () => {
            let a = false;
            let b = false;
            const combined = Disposable.from(
                { dispose(): void { a = true; } },
                { dispose(): void { b = true; } },
            );

            combined.dispose();

            expect(a).to.be.true;
            expect(b).to.be.true;
        });

        it('should not throw if one disposable throws', () => {
            let disposed = false;
            const combined = Disposable.from(
                { dispose(): void { throw new Error('fail'); } },
                { dispose(): void { disposed = true; } },
            );

            expect(() => { combined.dispose(); }).to.not.throw();
            expect(disposed).to.be.true;
        });

        it('should return a disposable for zero inputs', () => {
            const combined = Disposable.from();
            expect(() => { combined.dispose(); }).to.not.throw();
        });
    });
});
