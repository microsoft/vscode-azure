/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import type { GenericResource } from '../src/models/GenericResource';
import { makeGenericResource } from './mockAzure';

interface ProductResource extends GenericResource {
    readonly productProperty: string;
}

describe('mockAzure (unit)', () => {
    describe('makeGenericResource', () => {
        it('preserves product-specific resource fields', () => {
            const resource = makeGenericResource<ProductResource>({
                name: 'product-resource',
                productProperty: 'product-value',
            });

            expect(resource.name).to.equal('product-resource');
            expect(resource.productProperty).to.equal('product-value');
            expect(resource.subscription.subscriptionId).to.equal('test-sub');
        });

        it('requires product-specific resource fields', () => {
            // @ts-expect-error -- Required product-specific fields cannot be omitted.
            makeGenericResource<ProductResource>();
        });
    });
});
