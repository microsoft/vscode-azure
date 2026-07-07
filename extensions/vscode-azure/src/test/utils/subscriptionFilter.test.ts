/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { parseSubscriptionFilterKey, subscriptionFilterKey } from '../../utils/subscriptionFilter';

describe('subscriptionFilter (unit)', () => {
    describe('subscriptionFilterKey', () => {
        it('should join the tenant and subscription ids with a slash', () => {
            expect(subscriptionFilterKey('tenant-1', 'sub-2')).to.equal('tenant-1/sub-2');
        });

        it('should lowercase both halves', () => {
            expect(subscriptionFilterKey('TENANT-1', 'SUB-2')).to.equal('tenant-1/sub-2');
        });
    });

    describe('parseSubscriptionFilterKey', () => {
        it('should split a key into its two halves', () => {
            expect(parseSubscriptionFilterKey('tenant-1/sub-2')).to.deep.equal({ tenantId: 'tenant-1', subscriptionId: 'sub-2' });
        });

        it('should lowercase both halves', () => {
            expect(parseSubscriptionFilterKey('TENANT-1/SUB-2')).to.deep.equal({ tenantId: 'tenant-1', subscriptionId: 'sub-2' });
        });

        it('should yield undefined for a missing subscription half', () => {
            expect(parseSubscriptionFilterKey('tenant-1')).to.deep.equal({ tenantId: 'tenant-1', subscriptionId: undefined });
        });

        it('should yield undefined for an empty key', () => {
            expect(parseSubscriptionFilterKey('')).to.deep.equal({ tenantId: undefined, subscriptionId: undefined });
        });
    });

    it('should round-trip a build then parse back to the lowercased halves', () => {
        const key = subscriptionFilterKey('Tenant-1', 'Sub-2');
        expect(parseSubscriptionFilterKey(key)).to.deep.equal({ tenantId: 'tenant-1', subscriptionId: 'sub-2' });
    });
});
