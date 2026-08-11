/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { registerAcr } from './registerAcr';
import { registerFunctions } from './registerFunctions';
import { registerGenericAzure } from './registerGenericAzure';
import { registerSettings } from './registerSettings';

/** Apply each product's single registration entry point in dispatch order. */
export function registerProducts(registrar: ProductRegistrar): void {
    registerAcr(registrar);
    registerFunctions(registrar);
    // Claims only the settings virtual nodes, so it must precede any provider that claims the
    // owning resource.
    registerSettings(registrar);
    registerGenericAzure(registrar);
}
