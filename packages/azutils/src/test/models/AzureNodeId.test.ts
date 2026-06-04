/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { AzureNodeId } from '../../models/AzureNodeId';
import { makeAccount, makeGenericResource, makeResourceGroup, makeSubscription, makeTenant, makeVirtualGroup, makeVirtualResource } from '../mockAzure';

describe('AzureNodeId (unit)', () => {
    afterEach(() => {
        AzureNodeId.clearParseCache();
    });

    describe('test', () => {
        it('should return true for azr:// URIs', () => {
            expect(AzureNodeId.test('azr://user1@portal.azure.com')).to.be.true;
        });

        it('should return false for https:// URIs', () => {
            expect(AzureNodeId.test('https://portal.azure.com')).to.be.false;
        });

        it('should return false for empty string', () => {
            expect(AzureNodeId.test('')).to.be.false;
        });
    });

    describe('parse + toString', () => {
        it('should round-trip an account node ID', () => {
            const uri = 'azr://user1@portal.azure.com';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isAccountNodeId()).to.be.true;
        });

        it('should round-trip a tenant node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isTenantNodeId()).to.be.true;
        });

        it('should round-trip a subscription node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isSubscriptionNodeId()).to.be.true;
        });

        it('should round-trip a resource group node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/myRg';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isResourceGroupNodeId()).to.be.true;
        });

        it('should round-trip a virtual group node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/~resourceType/Microsoft.Web%2Fsites';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isVirtualGroupNodeId()).to.be.true;
        });

        it('should round-trip a generic resource node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/mySite';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isGenericResourceNodeId()).to.be.true;
        });

        it('should round-trip a virtual resource node ID', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg#/repository/my%2Frepo';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toString()).to.equal(uri);
            expect(nodeId.isVirtualResourceNodeId()).to.be.true;
        });
    });

    describe('parse errors', () => {
        it('should throw for non-azr:// URIs', () => {
            expect(() => AzureNodeId.parse('https://portal.azure.com')).to.throw('Not an azr://');
        });

        it('should throw for URIs without /tenants/{id} after host', () => {
            expect(() => AzureNodeId.parse('azr://user1@portal.azure.com/foo')).to.throw('expected /tenants/{tenantId}');
        });

        it('should throw for virtual resource URIs with invalid fragment', () => {
            // fragment with only 1 part (needs at least 2)
            expect(() => AzureNodeId.parse(
                'azr://user1@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1#/onlytype'
            )).to.throw('Invalid azr:// URI fragment');
        });
    });

    describe('parse caching', () => {
        it('should return the same instance for repeated parse calls', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1';
            const a = AzureNodeId.parse(uri);
            const b = AzureNodeId.parse(uri);
            expect(a).to.equal(b);
        });

        it('should return fresh instances after clearParseCache()', () => {
            const uri = 'azr://user1@portal.azure.com/tenants/t1';
            const a = AzureNodeId.parse(uri);
            AzureNodeId.clearParseCache();
            const b = AzureNodeId.parse(uri);
            expect(a).to.not.equal(b);
        });
    });

    describe('from', () => {
        it('should create a node ID from an account', () => {
            const account = makeAccount();
            const nodeId = AzureNodeId.from(account);
            expect(nodeId.isAccountNodeId()).to.be.true;
            expect(nodeId.toString()).to.equal('azr://test-account@portal.azure.com');
        });

        it('should create a node ID from a tenant', () => {
            const tenant = makeTenant();
            const nodeId = AzureNodeId.from(tenant);
            expect(nodeId.isTenantNodeId()).to.be.true;
            expect(nodeId.toString()).to.equal('azr://test-account@portal.azure.com/tenants/test-tenant');
        });

        it('should create a node ID from a subscription', () => {
            const sub = makeSubscription();
            const nodeId = AzureNodeId.from(sub);
            expect(nodeId.isSubscriptionNodeId()).to.be.true;
            expect(nodeId.toString()).to.equal('azr://test-account@portal.azure.com/tenants/test-tenant/subscriptions/test-sub');
        });

        it('should create a node ID from a resource group', () => {
            const rg = makeResourceGroup({ name: 'myRg', id: '/subscriptions/test-sub/resourceGroups/myRg', groupingValue: 'myRg' });
            const nodeId = AzureNodeId.from(rg);
            expect(nodeId.isResourceGroupNodeId()).to.be.true;
            expect(nodeId.toString()).to.contain('/subscriptions/test-sub/resourceGroups/myRg');
        });

        it('should create a node ID from a virtual group', () => {
            const vg = makeVirtualGroup();
            const nodeId = AzureNodeId.from(vg);
            expect(nodeId.isVirtualGroupNodeId()).to.be.true;
            expect(nodeId.toString()).to.contain('~resourceType');
        });

        it('should create a node ID from a generic resource', () => {
            const resource = makeGenericResource();
            const nodeId = AzureNodeId.from(resource);
            expect(nodeId.isGenericResourceNodeId()).to.be.true;
        });

        it('should create a node ID from a virtual resource', () => {
            const vr = makeVirtualResource({
                virtualPath: 'myrepo/latest',
                azureResource: makeGenericResource({
                    id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg',
                    name: 'myReg',
                    type: 'Microsoft.ContainerRegistry/registries',
                    logicalType: 'Microsoft.ContainerRegistry/registries',
                }),
            });
            const nodeId = AzureNodeId.from(vr);
            expect(nodeId.isVirtualResourceNodeId()).to.be.true;
            expect(nodeId.toString()).to.contain('#/repository/');
        });

        it('should populate the parse cache so parse() returns the same instance', () => {
            const account = makeAccount();
            const nodeId = AzureNodeId.from(account);
            const parsed = AzureNodeId.parse(nodeId.toString());
            expect(parsed).to.equal(nodeId);
        });
    });

    describe('narrowing methods', () => {
        it('account node ID has only isAccountNodeId true', () => {
            const nodeId = AzureNodeId.parse('azr://user1@portal.azure.com');
            expect(nodeId.isAccountNodeId()).to.be.true;
            expect(nodeId.isTenantNodeId()).to.be.false;
            expect(nodeId.isSubscriptionNodeId()).to.be.false;
            expect(nodeId.isResourceGroupNodeId()).to.be.false;
            expect(nodeId.isVirtualGroupNodeId()).to.be.false;
            expect(nodeId.isGenericResourceNodeId()).to.be.false;
            expect(nodeId.isVirtualResourceNodeId()).to.be.false;
        });

        it('resource group node ID is a grouping and not a virtual group', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t/subscriptions/s/resourceGroups/rg';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.isResourceGroupNodeId()).to.be.true;
            expect(nodeId.isVirtualGroupNodeId()).to.be.false;
        });

        it('virtual group node ID is a grouping and not a resource group', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t/subscriptions/s/~location/eastus';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.isVirtualGroupNodeId()).to.be.true;
            expect(nodeId.isResourceGroupNodeId()).to.be.false;
        });
    });

    describe('getGrouping', () => {
        it('should return grouping data for resource group nodes', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t/subscriptions/s/resourceGroups/myRg';
            const nodeId = AzureNodeId.parse(uri);
            const grouping = nodeId.getGrouping();
            expect(grouping).to.deep.equal({
                groupingStrategy: 'resourceGroup',
                groupingValue: 'myRg',
            });
        });

        it('should return grouping data for virtual group nodes', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t/subscriptions/s/~resourceType/Microsoft.Web%2Fsites';
            const nodeId = AzureNodeId.parse(uri);
            const grouping = nodeId.getGrouping();
            expect(grouping).to.not.be.undefined;
            expect(grouping!.groupingStrategy).to.equal('resourceType');
            expect(grouping!.groupingValue).to.equal('Microsoft.Web/sites');
        });

        it('should return undefined for non-grouping nodes', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t/subscriptions/s';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.getGrouping()).to.be.undefined;
        });
    });

    describe('toPortalUrl', () => {
        it('should generate a portal URL for a subscription', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toPortalUrl()).to.equal(
                'https://portal.azure.com/#@t1/resource/subscriptions/sub-1'
            );
        });

        it('should generate a portal URL for a resource group', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toPortalUrl()).to.equal(
                'https://portal.azure.com/#@t1/resource/subscriptions/sub-1/resourceGroups/rg1'
            );
        });

        it('should generate a portal URL for a generic resource', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1';
            const nodeId = AzureNodeId.parse(uri);
            expect(nodeId.toPortalUrl()).to.equal(
                'https://portal.azure.com/#@t1/resource/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1'
            );
        });

        it('should throw for an account node', () => {
            const uri = 'azr://u@portal.azure.com';
            const nodeId = AzureNodeId.parse(uri);
            expect(() => nodeId.toPortalUrl()).to.throw('Cannot create a portal URL');
        });

        it('should throw for a tenant node', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t1';
            const nodeId = AzureNodeId.parse(uri);
            expect(() => nodeId.toPortalUrl()).to.throw('Cannot create a portal URL');
        });

        it('should throw for a virtual grouping (non-resource-group)', () => {
            const uri = 'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/~location/eastus';
            const nodeId = AzureNodeId.parse(uri);
            expect(() => nodeId.toPortalUrl()).to.throw('Cannot create a portal URL for a virtual grouping');
        });
    });

    describe('parentNodeId', () => {
        it('should return undefined for account nodes', () => {
            const nodeId = AzureNodeId.parse('azr://u@portal.azure.com');
            expect(nodeId.parentNodeId()).to.be.undefined;
        });

        it('should return the account for a tenant node', () => {
            const nodeId = AzureNodeId.parse('azr://u@portal.azure.com/tenants/t1');
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isAccountNodeId()).to.be.true;
            expect(parent!.toString()).to.equal('azr://u@portal.azure.com');
        });

        it('should return the tenant for a subscription node', () => {
            const nodeId = AzureNodeId.parse('azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1');
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isTenantNodeId()).to.be.true;
        });

        it('should return the subscription for a resource group node', () => {
            const nodeId = AzureNodeId.parse('azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1');
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isSubscriptionNodeId()).to.be.true;
        });

        it('should return the subscription for a virtual group node', () => {
            const nodeId = AzureNodeId.parse('azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/~location/eastus');
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isSubscriptionNodeId()).to.be.true;
        });

        it('should return the resource group for a generic resource', () => {
            const nodeId = AzureNodeId.parse(
                'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Web/sites/site1'
            );
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isResourceGroupNodeId()).to.be.true;
        });

        it('should return the subscription for a subscription-scoped resource (no resource group)', () => {
            const nodeId = AzureNodeId.parse(
                'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/providers/Microsoft.Authorization/policyDefinitions/p1'
            );
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isSubscriptionNodeId()).to.be.true;
        });

        it('should return the generic resource for a virtual resource', () => {
            const nodeId = AzureNodeId.parse(
                'azr://u@portal.azure.com/tenants/t1/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.ContainerRegistry/registries/myReg#/repository/myrepo'
            );
            const parent = nodeId.parentNodeId();
            expect(parent).to.not.be.undefined;
            expect(parent!.isGenericResourceNodeId()).to.be.true;
        });
    });
});
