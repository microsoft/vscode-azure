/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import type { ServiceIdentifier } from 'inversify';

/** Identifier for the ordered collection of product-contributed endpoint providers. */
export const IResourceEndpointProviders: ServiceIdentifier<ResourceEndpointProvider> = Symbol.for('IResourceEndpointProviders');

/**
 * Resolves a browser endpoint for one family of Azure resources.
 *
 * Providers must keep {@linkcode ResourceEndpointProvider.canHandle canHandle}
 * synchronous because tree view rendering uses it to decide whether to expose
 * the Browse Website command.
 */
export interface ResourceEndpointProvider {
    /** Return whether this provider owns endpoint resolution for the resource. */
    canHandle(resource: GenericResource): boolean;

    /** Query the product API for the resource's current endpoint, if deployed. */
    getEndpoint(resource: GenericResource): Promise<string | undefined>;
}
