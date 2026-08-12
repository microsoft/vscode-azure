/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { getResourceGroupArmId, getResourceGroupName, getSubscriptionArmId, parseAzureResourceId } from '../../src/utils/azureResourceId';

describe('azureResourceId (unit)', () => {
    describe('parseAzureResourceId', () => {
        it('should parse a subscription-only ID', () => {
            const result = parseAzureResourceId('/subscriptions/abc-123');
            expect(result.subscriptionId).to.equal('abc-123');
            expect(result.resourceGroup).to.be.undefined;
            expect(result.provider).to.be.undefined;
            expect(result.resourceType).to.be.undefined;
            expect(result.resourceName).to.be.undefined;
            expect(result.resourceId).to.equal('/subscriptions/abc-123');
        });

        it('should parse a resource group ID', () => {
            const result = parseAzureResourceId('/subscriptions/abc-123/resourceGroups/myRg');
            expect(result.subscriptionId).to.equal('abc-123');
            expect(result.resourceGroup).to.equal('myRg');
            expect(result.provider).to.be.undefined;
            expect(result.resourceType).to.be.undefined;
            expect(result.resourceName).to.be.undefined;
        });

        it('should parse a resource-group-scoped resource', () => {
            const id = '/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.Web/sites/mySite';
            const result = parseAzureResourceId(id);
            expect(result.subscriptionId).to.equal('abc');
            expect(result.resourceGroup).to.equal('myRg');
            expect(result.provider).to.equal('Microsoft.Web');
            expect(result.resourceType).to.equal('sites');
            expect(result.resourceName).to.equal('mySite');
            expect(result.resourceId).to.equal(id);
        });

        it('should parse a subscription-scoped resource (no resource group)', () => {
            const id = '/subscriptions/abc/providers/Microsoft.Authorization/policyDefinitions/myPolicy';
            const result = parseAzureResourceId(id);
            expect(result.subscriptionId).to.equal('abc');
            expect(result.resourceGroup).to.be.undefined;
            expect(result.provider).to.equal('Microsoft.Authorization');
            expect(result.resourceType).to.equal('policyDefinitions');
            expect(result.resourceName).to.equal('myPolicy');
        });

        it('should parse a nested (child) resource', () => {
            const id = '/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.ContainerRegistry/registries/myReg/replications/myRepl';
            const result = parseAzureResourceId(id);
            expect(result.subscriptionId).to.equal('abc');
            expect(result.resourceGroup).to.equal('myRg');
            expect(result.provider).to.equal('Microsoft.ContainerRegistry');
            expect(result.resourceType).to.equal('registries/replications');
            expect(result.resourceName).to.equal('myRepl');
        });

        it('should be case-insensitive for segment keywords', () => {
            const id = '/Subscriptions/sub1/ResourceGroups/rg1/Providers/Microsoft.Web/sites/site1';
            const result = parseAzureResourceId(id);
            expect(result.subscriptionId).to.equal('sub1');
            expect(result.resourceGroup).to.equal('rg1');
            expect(result.provider).to.equal('Microsoft.Web');
            expect(result.resourceType).to.equal('sites');
            expect(result.resourceName).to.equal('site1');
        });

        it('should throw for an invalid ID (no /subscriptions/ prefix)', () => {
            expect(() => parseAzureResourceId('/tenants/abc')).to.throw('Invalid ARM resource ID');
        });

        it('should throw for an empty string', () => {
            expect(() => parseAzureResourceId('')).to.throw('Invalid ARM resource ID');
        });

        it('should throw when the resource group name is missing', () => {
            expect(() => parseAzureResourceId('/subscriptions/abc/resourceGroups')).to.throw('missing resource group name');
        });

        it('should throw when the provider namespace is missing', () => {
            expect(() => parseAzureResourceId('/subscriptions/abc/resourceGroups/myRg/providers')).to.throw('missing provider namespace');
        });

        it('should throw when the provider has no type/name pair', () => {
            expect(() => parseAzureResourceId('/subscriptions/abc/providers/Microsoft.Web')).to.throw('expected provider type/name pairs');
        });

        it('should throw when the provider type has no name', () => {
            expect(() => parseAzureResourceId('/subscriptions/abc/providers/Microsoft.Web/sites')).to.throw('expected provider type/name pairs');
        });

        it('should throw for a dangling child type without a child name', () => {
            const id = '/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.ContainerRegistry/registries/myReg/replications';
            expect(() => parseAzureResourceId(id)).to.throw('expected provider type/name pairs');
        });

        it('should handle a trailing slash', () => {
            const result = parseAzureResourceId('/subscriptions/abc-123/');
            expect(result.subscriptionId).to.equal('abc-123');
            expect(result.resourceGroup).to.be.undefined;
        });
    });

    describe('getSubscriptionArmId', () => {
        it('should extract the subscription ARM ID from a full resource ID', () => {
            const id = '/subscriptions/abc/resourceGroups/rg1/providers/Microsoft.Web/sites/site1';
            expect(getSubscriptionArmId(id)).to.equal('/subscriptions/abc');
        });

        it('should return the same string for a subscription-only ID', () => {
            expect(getSubscriptionArmId('/subscriptions/xyz')).to.equal('/subscriptions/xyz');
        });
    });

    describe('getResourceGroupArmId', () => {
        it('should extract the resource group ARM ID', () => {
            const id = '/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.Web/sites/site1';
            expect(getResourceGroupArmId(id)).to.equal('/subscriptions/abc/resourceGroups/myRg');
        });

        it('should throw when there is no resource group segment', () => {
            expect(() => getResourceGroupArmId('/subscriptions/abc')).to.throw('does not contain a resource group');
        });

        it('should throw for a subscription-scoped resource without resource group', () => {
            const id = '/subscriptions/abc/providers/Microsoft.Authorization/policyDefinitions/p1';
            expect(() => getResourceGroupArmId(id)).to.throw('does not contain a resource group');
        });
    });

    describe('getResourceGroupName', () => {
        it('should extract the resource group name from a full resource ID', () => {
            const id = '/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.Web/sites/site1';
            expect(getResourceGroupName(id)).to.equal('myRg');
        });

        it('should throw a consistent error when there is no resource group segment', () => {
            const id = '/subscriptions/abc/providers/Microsoft.Authorization/policyDefinitions/p1';
            expect(() => getResourceGroupName(id)).to.throw(`ARM resource ID does not contain a resource group: ${id}`);
        });
    });
});
