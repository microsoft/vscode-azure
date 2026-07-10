/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert';
import { byAccount, byResource, bySubscription, byType } from '../../src/tree/azureSelectors';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant } from '../mockAzure';

describe('azureSelectors (unit)', () => {
    describe('byAccount', () => {
        it('matches the account node as a subtree', () => {
            const account = makeAccount({ id: 'acct-1' });
            assert.strictEqual(byAccount('acct-1')(account), 'subtree');
        });

        it('is case-insensitive on the account id', () => {
            const account = makeAccount({ id: 'Acct-ABC' });
            assert.strictEqual(byAccount('acct-abc')(account), 'subtree');
        });

        it('does not match a different account id', () => {
            const account = makeAccount({ id: 'acct-1' });
            assert.strictEqual(byAccount('acct-2')(account), undefined);
        });

        it('does not match non-account nodes', () => {
            assert.strictEqual(byAccount('acct-1')(makeSubscription()), undefined);
            assert.strictEqual(byAccount('acct-1')(makeGenericResource()), undefined);
        });
    });

    describe('bySubscription', () => {
        it('matches the subscription node as a subtree', () => {
            const sub = makeSubscription({ subscriptionId: 'sub-1' });
            assert.strictEqual(bySubscription('sub-1')(sub), 'subtree');
        });

        it('is case-insensitive on the subscription id', () => {
            const sub = makeSubscription({ subscriptionId: 'SUB-XYZ' });
            assert.strictEqual(bySubscription('sub-xyz')(sub), 'subtree');
        });

        it('does not match a different subscription or non-subscription nodes', () => {
            assert.strictEqual(bySubscription('sub-2')(makeSubscription({ subscriptionId: 'sub-1' })), undefined);
            assert.strictEqual(bySubscription('sub-1')(makeAccount()), undefined);
            assert.strictEqual(bySubscription('sub-1')(makeGenericResource()), undefined);
        });
    });

    describe('byResource', () => {
        it('matches a generic resource by ARM id as a subtree', () => {
            const resource = makeGenericResource({ id: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/site1' });
            assert.strictEqual(byResource('/subscriptions/s/resourceGroups/rg/providers/Microsoft.Web/sites/site1')(resource), 'subtree');
        });

        it('matches a resource group by ARM id', () => {
            const rg = makeResourceGroup({ id: '/subscriptions/s/resourceGroups/rg1' });
            assert.strictEqual(byResource('/subscriptions/s/resourceGroups/rg1')(rg), 'subtree');
        });

        it('is case-insensitive on the ARM id', () => {
            const resource = makeGenericResource({ id: '/Subscriptions/S/Providers/Microsoft.Web/sites/Site1' });
            assert.strictEqual(byResource('/subscriptions/s/providers/microsoft.web/sites/site1')(resource), 'subtree');
        });

        it('does not match a different id or non-resource nodes', () => {
            assert.strictEqual(byResource('/other')(makeGenericResource()), undefined);
            assert.strictEqual(byResource('/subscriptions/test-sub/resourceGroups/rg1')(makeSubscription()), undefined);
        });
    });

    describe('byType', () => {
        it('matches a generic resource by logical type as a subtree', () => {
            const resource = makeGenericResource({ logicalType: 'Microsoft.Web/sites' });
            assert.strictEqual(byType('Microsoft.Web/sites')(resource), 'subtree');
        });

        it('is case-insensitive on the type', () => {
            const resource = makeGenericResource({ logicalType: 'Microsoft.Web/sites' });
            assert.strictEqual(byType('microsoft.web/sites')(resource), 'subtree');
        });

        it('matches the well-known subscription type', () => {
            assert.strictEqual(byType('Microsoft.Resources/subscriptions')(makeSubscription()), 'subtree');
        });

        it('matches the well-known account and tenant types', () => {
            assert.strictEqual(byType('account')(makeAccount()), 'subtree');
            assert.strictEqual(byType('tenant')(makeTenant()), 'subtree');
        });

        it('does not match a different type', () => {
            assert.strictEqual(byType('Microsoft.Storage/storageAccounts')(makeGenericResource({ logicalType: 'Microsoft.Web/sites' })), undefined);
        });
    });
});
