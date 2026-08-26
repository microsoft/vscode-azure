/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceClientProvider, type GenericResource } from '@microsoft/vscode-azure-azutils';
import { makeGenericResource, makeResourceGroup, makeSubscription, makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { Container } from 'inversify';
import { mock, type Mock } from 'node:test';
import { GenericArmPropertiesAdapter } from '../../../src/properties/adapters/GenericArmPropertiesAdapter';

describe('GenericArmPropertiesAdapter (unit)', () => {
    it('serves resources and resource groups, which ARM reads the same way', () => {
        const { adapter } = createAdapter();

        expect(adapter.canHandle(makeGenericResource())).to.be.true;
        expect(adapter.canHandle(makeResourceGroup())).to.be.true;
    });

    it('leaves nodes without an ARM resource id to a product adapter', () => {
        const { adapter } = createAdapter();

        expect(adapter.canHandle(makeSubscription())).to.be.false;
        expect(adapter.canHandle(makeVirtualResource())).to.be.false;
    });

    it('reads by ARM id, passing the type so the API version can be resolved', async () => {
        const resource = makeGenericResource();
        const { adapter, getById } = createAdapter();

        await adapter.read(resource);

        expect(getById.mock.calls[0].arguments).to.deep.equal([resource.id, resource.type]);
    });

    it('returns what ARM sent without the metadata this repo attaches', async () => {
        const resource = makeGenericResource();
        const armPayload = {
            id: resource.id,
            name: resource.name,
            type: resource.type,
            location: resource.location,
            properties: { provisioningState: 'Succeeded' },
        };
        const { adapter } = createAdapter({
            getById: mock.fn((_id: string, _type: string) => Promise.resolve({
                ...armPayload,
                subscription: resource.subscription,
                logicalType: resource.logicalType,
            } as GenericResource)),
        });

        // The subscription carries the signed-in account's identity, so it must not reach a
        // document the user may hand to someone else.
        expect(await adapter.read(resource)).to.deep.equal(armPayload);
    });

    it('declares redaction, since some providers return credentials from a plain GET', () => {
        const { adapter } = createAdapter();

        expect(adapter.redact).to.equal(true);
    });
});

interface AdapterOptions {
    readonly getById?: Mock<(resourceId: string, resourceType: string) => Promise<GenericResource>>;
}

interface AdapterSetup {
    readonly adapter: GenericArmPropertiesAdapter;
    readonly getById: Mock<(resourceId: string, resourceType: string) => Promise<GenericResource>>;
}

function createAdapter(options: AdapterOptions = {}): AdapterSetup {
    const getById = options.getById
        ?? mock.fn((_resourceId: string, _resourceType: string) => Promise.resolve(makeGenericResource()));

    const container = new Container();
    container.bind(IResourceClientProvider).toConstantValue(() => ({
        resources: { getById },
    }) as unknown as ReturnType<IResourceClientProvider>);
    container.bind(GenericArmPropertiesAdapter).toSelf();

    return { adapter: container.get(GenericArmPropertiesAdapter), getById };
}
