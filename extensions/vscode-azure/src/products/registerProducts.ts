/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { registerAcr } from './registerAcr';
import { registerContainerApps } from './registerContainerApps';
import { registerFunctions } from './registerFunctions';
import { registerGenericAzure } from './registerGenericAzure';
import { registerSettings } from './registerSettings';
import { registerStaticWebApps } from './registerStaticWebApps';

/** Apply each product's single registration entry point in dispatch order. */
export function registerProducts(registrar: ProductRegistrar): void {
    // First: claims only the settings virtual nodes, never a resource, so it must win dispatch over
    // any product provider that claims the resource those nodes hang off.
    registerSettings(registrar);
    registerStaticWebApps(registrar);
    registerAcr(registrar);
    registerContainerApps(registrar);
    registerFunctions(registrar);
    registerGenericAzure(registrar);
}
