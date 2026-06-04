/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { combineContextValues } from '../../tree/combineContextValues';

describe('combineContextValues (unit)', () => {
    it('should sort and join context values with semicolons', () => {
        expect(combineContextValues('b', 'a', 'c')).to.equal('a;b;c');
    });

    it('should return a single value unchanged', () => {
        expect(combineContextValues('only')).to.equal('only');
    });

    it('should return empty string for no values', () => {
        expect(combineContextValues()).to.equal('');
    });
});
