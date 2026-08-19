/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeSubscription, makeTenant } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, withSettings } from '@microsoft/vscode-azure-utils/testing';
import { ConfigurationSection, SelectedSubscriptionsConfigurationKey } from '../../src/constants';
import type { SelectedSubscriptionsFilter } from '../../src/utils/subscriptionFilter';
import { createSubscriptionFilter, parseSubscriptionFilterKey, subscriptionFilterKey } from '../../src/utils/subscriptionFilter';

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

    describe('createSubscriptionFilter', () => {
        /** Build the filter with the setting temporarily set to `selected`. */
        function filterFor(selected: string[]): SelectedSubscriptionsFilter | undefined {
            const mockResult = createMockVsCode();
            const key = `${ConfigurationSection}.${SelectedSubscriptionsConfigurationKey}`;
            return withSettings(mockResult, { [key]: selected }, () => createSubscriptionFilter(mockResult.vscode)) as SelectedSubscriptionsFilter | undefined;
        }

        it('should return undefined when nothing is selected', () => {
            // An empty setting means "no filtering", not "admit nothing" --
            // conflating the two shows an empty tree.
            expect(filterFor([])).to.be.undefined;
        });

        it('should admit a named tenant and reject one the setting never mentions', () => {
            const filter = filterFor(['tenant-1/sub-1']);

            expect(filter?.admitsTenant(makeTenant({ tenantId: 'tenant-1' }))).to.be.true;
            expect(filter?.admitsTenant(makeTenant({ tenantId: 'tenant-2' }))).to.be.false;
        });

        it('should admit only the exact tenant/subscription pair', () => {
            const filter = filterFor(['tenant-1/sub-1']);

            expect(filter?.admitsSubscription(makeSubscription({ tenantId: 'tenant-1', subscriptionId: 'sub-1' }))).to.be.true;
            // The same subscription reached through another tenant is a
            // different node, and the user selected only one of them.
            expect(filter?.admitsSubscription(makeSubscription({ tenantId: 'tenant-2', subscriptionId: 'sub-1' }))).to.be.false;
            expect(filter?.admitsSubscription(makeSubscription({ tenantId: 'tenant-1', subscriptionId: 'sub-2' }))).to.be.false;
        });

        it('should match ids case-insensitively', () => {
            // Ids arrive inconsistently cased from ARM, the auth API, and this
            // user-editable setting.
            const filter = filterFor(['TENANT-1/SUB-1']);

            expect(filter?.admitsTenant(makeTenant({ tenantId: 'tenant-1' }))).to.be.true;
            expect(filter?.admitsSubscription(makeSubscription({ tenantId: 'tenant-1', subscriptionId: 'sub-1' }))).to.be.true;
        });

        it('should ignore a malformed entry that names no subscription', () => {
            const filter = filterFor(['tenant-1']);

            // The tenant half is still usable, so the tenant is admitted...
            expect(filter?.admitsTenant(makeTenant({ tenantId: 'tenant-1' }))).to.be.true;
            // ...but no pair was named, so no subscription under it is.
            expect(filter?.admitsSubscription(makeSubscription({ tenantId: 'tenant-1', subscriptionId: 'sub-1' }))).to.be.false;
        });
    });
});
