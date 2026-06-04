/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { GoBackError } from '../../wizard/GoBackError';

describe('GoBackError (unit)', () => {
    it('should have the name "GoBackError"', () => {
        const err = new GoBackError();
        expect(err.name).to.equal('GoBackError');
    });

    it('should have the message "Go back"', () => {
        const err = new GoBackError();
        expect(err.message).to.equal('Go back');
    });

    describe('test', () => {
        it('should return true for GoBackError instances', () => {
            expect(GoBackError.test(new GoBackError())).to.be.true;
        });

        it('should return true for errors with name "GoBackError"', () => {
            const err = new Error('whatever');
            err.name = 'GoBackError';
            expect(GoBackError.test(err)).to.be.true;
        });

        it('should return false for regular errors', () => {
            expect(GoBackError.test(new Error('nope'))).to.be.false;
        });

        it('should return false for non-error values', () => {
            expect(GoBackError.test(null)).to.be.false;
            expect(GoBackError.test(undefined)).to.be.false;
        });
    });
});
