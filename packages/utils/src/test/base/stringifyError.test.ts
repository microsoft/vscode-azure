/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as util from 'node:util';
import { stringifyError } from '../../base/stringifyError';

describe('stringifyError (unit)', () => {
    it('should return the message of an Error', () => {
        expect(stringifyError(new Error('boom'))).to.equal('boom');
    });

    it('should return the message of an Error subclass', () => {
        expect(stringifyError(new TypeError('bad type'))).to.equal('bad type');
    });

    it('should return a string unchanged', () => {
        expect(stringifyError('plain string error')).to.equal('plain string error');
    });

    it('should inspect non-string, non-Error values', () => {
        const value = { code: 'ETIMEDOUT' };
        expect(stringifyError(value)).to.equal(util.inspect(value));
    });

    it('should inspect numbers', () => {
        expect(stringifyError(42)).to.equal(util.inspect(42));
    });

    it('should inspect null', () => {
        expect(stringifyError(null)).to.equal(util.inspect(null));
    });

    it('should inspect undefined', () => {
        expect(stringifyError(undefined)).to.equal(util.inspect(undefined));
    });
});
