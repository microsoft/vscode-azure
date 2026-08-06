/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { registerAcr } from './acr/registerAcr';
import { registerFunctions } from './functions/registerFunctions';

/** Apply each product's single registration entry point in dispatch order. */
export function registerProducts(registrar: ProductRegistrar): void {
    registerAcr(registrar);
    registerFunctions(registrar);
}
