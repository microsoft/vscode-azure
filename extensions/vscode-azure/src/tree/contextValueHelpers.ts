/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource } from '@microsoft/vscode-azure-azutils';
import { BrowseWebsite } from '../commands/tree/BrowseWebsite';
import { OpenInPortal } from '../commands/tree/OpenInPortal';
import { getWebsiteUrl } from './resources/websiteUrl';

/**
 * Combines context values into a single string by sorting and then joining with `;`.
 */
export function combineContextValues(...contextValues: string[]): string {
    return contextValues.sort().join(';');
}

/**
 * Builds the context value for an Azure resource tree item.
 *
 * Centralizes the context values every resource node shares so product view
 * providers only supply their own additions.
 *
 * The Browse Website context value is driven purely by the presence of a
 * website URL attached during enrichment, so rendering stays synchronous and
 * performs no I/O. A node rendered before its enrichment completes simply
 * lacks the context value; the data layer fires a change event when
 * enrichment lands, which re-renders the node with it.
 *
 * @param additional - Product-specific context values for this node.
 */
export function resourceContextValue(resource: GenericResource, ...additional: string[]): string {
    const contextValues = [OpenInPortal.ContextValue, ...additional];

    if (getWebsiteUrl(resource)) {
        contextValues.push(BrowseWebsite.ContextValue);
    }

    return combineContextValues(...contextValues);
}
