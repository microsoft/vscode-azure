/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { BrowseWebsite } from '../../commands/tree/BrowseWebsite';
import { OpenInPortal } from '../../commands/tree/OpenInPortal';
import type { IResourceEndpointResolver } from '../../endpoints/ResourceEndpointResolver';
import { combineContextValues } from '../combineContextValues';

/**
 * Builds the context value for an Azure resource tree item.
 *
 * Centralizes the context values every resource node shares so product view
 * providers only supply their own additions.
 *
 * Runs during tree rendering, so it must stay synchronous and allocation-cheap:
 * {@linkcode IResourceEndpointResolver.canHandle canHandle} only inspects the
 * resource type and never performs I/O.
 *
 * @param additional - Product-specific context values for this node.
 */
export function resourceContextValue(
    endpointResolver: IResourceEndpointResolver,
    resource: GenericResource,
    ...additional: string[]
): string {
    const contextValues = [OpenInPortal.ContextValue, ...additional];

    if (endpointResolver.canHandle(resource)) {
        contextValues.push(BrowseWebsite.ContextValue);
    }

    return combineContextValues(...contextValues);
}
