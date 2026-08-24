/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { Disposable } from '../../src/vscode/Disposable';

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

        it('should ignore undefined entries', () => {
            const disposable = { dispose: mock.fn() };
            const combined = Disposable.from(undefined, disposable, undefined);

            expect(() => { combined.dispose(); }).to.not.throw();
            expect(disposable.dispose.mock.callCount()).to.equal(1);
        });

        it('should return a disposable for zero inputs', () => {
            const combined = Disposable.from();
            expect(() => { combined.dispose(); }).to.not.throw();
        });
    });

    describe('disposeAll', () => {
        it('should dispose each argument in order', () => {
            const order: string[] = [];
            Disposable.disposeAll(
                { dispose(): void { order.push('a'); } },
                { dispose(): void { order.push('b'); } },
            );

            expect(order).to.deep.equal(['a', 'b']);
        });

        it('should dispose the contents of arrays, including nested ones', () => {
            const order: string[] = [];
            Disposable.disposeAll(
                { dispose(): void { order.push('a'); } },
                [
                    { dispose(): void { order.push('b'); } },
                    [{ dispose(): void { order.push('c'); } }],
                ],
            );

            expect(order).to.deep.equal(['a', 'b', 'c']);
        });

        it('should ignore undefined, null, and non-disposable values', () => {
            const disposable = { dispose: mock.fn() };

            expect(() => {
                Disposable.disposeAll(undefined, null, 42, 'string', {}, { dispose: 'not a function' }, [undefined, disposable]);
            }).to.not.throw();
            expect(disposable.dispose.mock.callCount()).to.equal(1);
        });

        it('should keep disposing after one disposable throws', () => {
            const disposable = { dispose: mock.fn() };

            expect(() => {
                Disposable.disposeAll({ dispose(): void { throw new Error('fail'); } }, disposable);
            }).to.not.throw();
            expect(disposable.dispose.mock.callCount()).to.equal(1);
        });

        it('should do nothing for zero inputs', () => {
            expect(() => { Disposable.disposeAll(); }).to.not.throw();
            expect(() => { Disposable.disposeAll([]); }).to.not.throw();
        });
    });
});
