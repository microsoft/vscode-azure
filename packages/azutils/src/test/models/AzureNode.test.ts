/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
    getNodeType,
    isAccount,
    isGenericResource,
    isResourceGroup,
    isSubscription,
    isTenant,
    isVirtualGroup,
    isVirtualResource,
    SubscriptionArmType,
} from '../../models/AzureNode';
import type { GenericResource } from '../../models/GenericResource';
import type { ResourceGroup, VirtualGroup } from '../../models/Grouping';
import type { VirtualResource } from '../../models/VirtualResource';
import { makeAccount, makeSubscription, makeTenant } from '../mockAzure';

function makeGenericResource(overrides?: Partial<GenericResource>): GenericResource {
    return {
        id: '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1',
        name: 'site1',
        type: 'Microsoft.Web/sites',
        location: 'eastus',
        logicalType: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    } as GenericResource;
}

function makeResourceGroup(overrides?: Partial<ResourceGroup>): ResourceGroup {
    return {
        ...makeGenericResource({
            id: '/subscriptions/sub-1/resourceGroups/rg1',
            name: 'rg1',
            type: 'Microsoft.Resources/resourceGroups',
            logicalType: 'Microsoft.Resources/resourceGroups',
        }),
        groupingStrategy: 'resourceGroup',
        groupingValue: 'rg1',
        subscription: makeSubscription(),
        ...overrides,
    } as ResourceGroup;
}

function makeVirtualGroup(overrides?: Partial<VirtualGroup>): VirtualGroup {
    return {
        groupingStrategy: 'resourceType',
        groupingValue: 'Microsoft.Web/sites',
        subscription: makeSubscription(),
        ...overrides,
    } as VirtualGroup;
}

function makeVirtualResource(overrides?: Partial<VirtualResource>): VirtualResource {
    return {
        virtualType: 'repository',
        virtualPath: 'myrepo',
        azureResource: makeGenericResource(),
        ...overrides,
    } as VirtualResource;
}

describe('AzureNode (unit)', () => {
    describe('isAccount', () => {
        it('should return true for account nodes', () => {
            expect(isAccount(makeAccount())).to.be.true;
        });

        it('should return false for tenant nodes', () => {
            expect(isAccount(makeTenant())).to.be.false;
        });

        it('should return false for subscription nodes', () => {
            expect(isAccount(makeSubscription())).to.be.false;
        });
    });

    describe('isTenant', () => {
        it('should return true for tenant nodes', () => {
            expect(isTenant(makeTenant())).to.be.true;
        });

        it('should return false for subscription nodes (which also have tenantId)', () => {
            expect(isTenant(makeSubscription())).to.be.false;
        });

        it('should return false for account nodes', () => {
            expect(isTenant(makeAccount())).to.be.false;
        });
    });

    describe('isSubscription', () => {
        it('should return true for subscription nodes', () => {
            expect(isSubscription(makeSubscription())).to.be.true;
        });

        it('should return false for tenant nodes', () => {
            expect(isSubscription(makeTenant())).to.be.false;
        });

        it('should return false for account nodes', () => {
            expect(isSubscription(makeAccount())).to.be.false;
        });
    });

    describe('isResourceGroup', () => {
        it('should return true for resource group nodes', () => {
            expect(isResourceGroup(makeResourceGroup())).to.be.true;
        });

        it('should return false for virtual group nodes', () => {
            expect(isResourceGroup(makeVirtualGroup())).to.be.false;
        });

        it('should return false for generic resource nodes', () => {
            expect(isResourceGroup(makeGenericResource())).to.be.false;
        });
    });

    describe('isVirtualGroup', () => {
        it('should return true for virtual group nodes', () => {
            expect(isVirtualGroup(makeVirtualGroup())).to.be.true;
        });

        it('should return false for resource group nodes', () => {
            expect(isVirtualGroup(makeResourceGroup())).to.be.false;
        });

        it('should return true for location grouping', () => {
            expect(isVirtualGroup(makeVirtualGroup({ groupingStrategy: 'location' }))).to.be.true;
        });
    });

    describe('isGenericResource', () => {
        it('should return true for generic resource nodes', () => {
            expect(isGenericResource(makeGenericResource())).to.be.true;
        });

        it('should return false for resource group nodes (even though they conform to GenericResource)', () => {
            expect(isGenericResource(makeResourceGroup())).to.be.false;
        });

        it('should return false for account nodes', () => {
            expect(isGenericResource(makeAccount())).to.be.false;
        });
    });

    describe('isVirtualResource', () => {
        it('should return true for virtual resource nodes', () => {
            expect(isVirtualResource(makeVirtualResource())).to.be.true;
        });

        it('should return false for generic resource nodes', () => {
            expect(isVirtualResource(makeGenericResource())).to.be.false;
        });
    });

    describe('getNodeType', () => {
        it('should return virtualType for virtual resources', () => {
            expect(getNodeType(makeVirtualResource())).to.equal('repository');
        });

        it('should return logicalType for generic resources', () => {
            expect(getNodeType(makeGenericResource())).to.equal('Microsoft.Web/sites');
        });

        it('should return logicalType for resource groups', () => {
            expect(getNodeType(makeResourceGroup())).to.equal('Microsoft.Resources/resourceGroups');
        });

        it('should return SubscriptionArmType for subscriptions', () => {
            expect(getNodeType(makeSubscription())).to.equal(SubscriptionArmType);
        });

        it('should return "tenant" for tenants', () => {
            expect(getNodeType(makeTenant())).to.equal('tenant');
        });

        it('should return "account" for accounts', () => {
            expect(getNodeType(makeAccount())).to.equal('account');
        });
    });
});
