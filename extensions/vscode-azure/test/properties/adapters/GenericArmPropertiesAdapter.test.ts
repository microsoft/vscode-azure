/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeGenericResource, makeResourceGroup, makeSubscription, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { GenericArmPropertiesAdapter } from '../../../src/properties/adapters/GenericArmPropertiesAdapter';

describe('GenericArmPropertiesAdapter (unit)', () => {
    it('serves resources and resource groups, which ARM reads the same way', () => {
        const adapter = new GenericArmPropertiesAdapter();

        expect(adapter.canHandle(makeGenericResource())).to.be.true;
        expect(adapter.canHandle(makeResourceGroup())).to.be.true;
    });

    it('leaves nodes without an ARM resource id to a product adapter', () => {
        const adapter = new GenericArmPropertiesAdapter();

        expect(adapter.canHandle(makeSubscription())).to.be.false;
        expect(adapter.canHandle(makeVirtualResource())).to.be.false;
    });

    it('returns the resolved ARM node without the metadata this repo attaches', async () => {
        const armPayload = {
            id: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Web/sites/app1',
            name: 'app1',
            type: 'Microsoft.Web/sites',
            location: 'westus',
            properties: { provisioningState: 'Succeeded' },
        };
        const resource = makeGenericResource(armPayload);
        const adapter = new GenericArmPropertiesAdapter();

        // The subscription carries the signed-in account's identity, so it must not reach a
        // document the user may hand to someone else.
        expect(await adapter.read(resource)).to.deep.equal(armPayload);
    });

    it('removes grouping metadata from a resolved resource group', async () => {
        const resourceGroup = makeResourceGroup({
            properties: { provisioningState: 'Succeeded' },
        });
        const adapter = new GenericArmPropertiesAdapter();

        expect(await adapter.read(resourceGroup)).to.deep.equal({
            id: resourceGroup.id,
            name: resourceGroup.name,
            type: resourceGroup.type,
            location: resourceGroup.location,
            properties: resourceGroup.properties,
        });
    });
});
