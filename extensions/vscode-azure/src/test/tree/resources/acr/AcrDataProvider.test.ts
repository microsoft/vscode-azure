/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AcrDataProvider } from '../../../../tree/resources/acr/AcrDataProvider';

describe('AcrDataProvider.canHandle', () => {
    // canHandle does not use the injected dependencies, so null stubs are sufficient
    const provider = new AcrDataProvider(null as any, null as any);

    it('(unit) should return false for null', () => {
        expect(provider.canHandle(null)).to.equal(false);
    });

    it('(unit) should return false for undefined', () => {
        expect(provider.canHandle(undefined)).to.equal(false);
    });

    it('(unit) should return false for a plain object that is not an ACR resource', () => {
        expect(provider.canHandle({ foo: 'bar' })).to.equal(false);
    });
});
