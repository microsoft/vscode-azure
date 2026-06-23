/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { isAzureSubscription } from '../../auth/AzureSubscription';
import { makeSubscription } from '../mockAzure';

describe('isAzureSubscription (unit)', () => {
    it('should return true for a well-formed subscription', () => {
        expect(isAzureSubscription(makeSubscription())).to.be.true;
    });

    it('should return true for a minimal object carrying the defining fields', () => {
        expect(isAzureSubscription({ subscriptionId: 's', tenantId: 't', accountId: 'a' })).to.be.true;
    });

    it('should return false for non-object values', () => {
        expect(isAzureSubscription(null)).to.be.false;
        expect(isAzureSubscription(undefined)).to.be.false;
        expect(isAzureSubscription('subscription')).to.be.false;
        expect(isAzureSubscription(42)).to.be.false;
    });

    it('should return false when subscriptionId is missing', () => {
        expect(isAzureSubscription({ tenantId: 't', accountId: 'a' })).to.be.false;
    });

    it('should return false when tenantId is missing', () => {
        expect(isAzureSubscription({ subscriptionId: 's', accountId: 'a' })).to.be.false;
    });

    it('should return false when accountId is missing', () => {
        expect(isAzureSubscription({ subscriptionId: 's', tenantId: 't' })).to.be.false;
    });
});
