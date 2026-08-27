/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerProducts } from '../../src/products/registerProducts';
import { ProductRegistrar } from '../../src/registration/ProductRegistrar';
import type { ProviderEntry } from '../../src/services';
import { AzureResourceDataProvider } from '../../src/tree/resources/AzureResourceDataProvider';
import { GenericAzureViewProvider } from '../../src/tree/resources/GenericAzureViewProvider';
import { SettingsDataProvider } from '../../src/tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../../src/tree/resources/settings/SettingsViewProvider';

/** Unwrap the class from a bare entry or an aliased `[primaryId, Class]` tuple. */
function classOf(entry: ProviderEntry<unknown>): unknown {
    return Array.isArray(entry) ? entry[1] : entry;
}

// Dispatch stops at the first provider whose `canHandle` matches, so the two
// ends of the list are load-bearing however many products exist in between:
// the settings providers claim virtual nodes hanging off a resource that a
// product provider also claims, and the generic providers claim every Azure
// resource. Both tests assert relative position, so adding a product in the
// middle needs no edit here -- only putting one on the wrong side of a bookend
// fails, which is exactly the mistake that would otherwise surface as a
// silently mis-rendered tree.
describe('registerProducts (unit)', () => {
    it('dispatches to the settings providers before any product provider', () => {
        const registrar = new ProductRegistrar();

        registerProducts(registrar);

        expect(classOf(registrar.getResourceDataProviders()[0])).to.equal(SettingsDataProvider);
        expect(classOf(registrar.getResourceViewProviders()[0])).to.equal(SettingsViewProvider);
    });

    it('dispatches to the generic Azure providers only after every product provider', () => {
        const registrar = new ProductRegistrar();

        registerProducts(registrar);

        expect(registrar.getResourceDataProviders().map(classOf).at(-1)).to.equal(AzureResourceDataProvider);
        expect(registrar.getResourceViewProviders().map(classOf).at(-1)).to.equal(GenericAzureViewProvider);
    });
});
