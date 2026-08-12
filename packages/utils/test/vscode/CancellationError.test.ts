/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, throwIfCancelled } from '../../src/vscode/CancellationError';

describe('CancellationError (unit)', () => {
    describe('throwIfCancelled', () => {
        it('does nothing when the token is not cancelled', () => {
            expect(() => {
                throwIfCancelled({
                    isCancellationRequested: false,
                    onCancellationRequested: () => ({ dispose: () => undefined }),
                });
            }).to.not.throw();
        });

        it('does nothing when there is no token', () => {
            expect(() => { throwIfCancelled(undefined); }).to.not.throw();
        });

        it('throws CancellationError once the token is cancelled', () => {
            expect(() => {
                throwIfCancelled({
                    isCancellationRequested: true,
                    onCancellationRequested: () => ({ dispose: () => undefined }),
                });
            }).to.throw(CancellationError);
        });

        it('carries the step name onto the error', () => {
            expect(() => {
                throwIfCancelled({
                    isCancellationRequested: true,
                    onCancellationRequested: () => ({ dispose: () => undefined }),
                }, 'WalkWorkspace');
            }).to.throw(CancellationError).with.property('stepName', 'WalkWorkspace');
        });
    });

    it('should have the name "Canceled"', () => {
        const err = new CancellationError();
        expect(err.name).to.equal('Canceled');
    });

    it('should use the default message when none is provided', () => {
        const err = new CancellationError();
        expect(err.message).to.equal('Canceled');
    });

    it('should use a custom message when provided', () => {
        const err = new CancellationError('user dismissed');
        expect(err.message).to.equal('user dismissed');
    });

    it('should store stepName', () => {
        const err = new CancellationError('msg', 'PickSubscription');
        expect(err.stepName).to.equal('PickSubscription');
    });

    describe('test', () => {
        it('should return true for CancellationError instances', () => {
            expect(CancellationError.test(new CancellationError())).to.be.true;
        });

        it('should return true for errors with name "Canceled"', () => {
            const err = new Error('whatever');
            err.name = 'Canceled';
            expect(CancellationError.test(err)).to.be.true;
        });

        it('should return true for errors with name "Cancelled" (VS Code spelling)', () => {
            const err = new Error('whatever');
            err.name = 'Cancelled';
            expect(CancellationError.test(err)).to.be.true;
        });

        it('should return false for regular errors', () => {
            expect(CancellationError.test(new Error('nope'))).to.be.false;
        });

        it('should return false for non-error values', () => {
            expect(CancellationError.test(null)).to.be.false;
            expect(CancellationError.test(undefined)).to.be.false;
            expect(CancellationError.test('string')).to.be.false;
        });
    });
});
