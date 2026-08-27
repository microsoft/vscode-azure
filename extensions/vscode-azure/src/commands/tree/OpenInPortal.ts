/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';

/** Resolves the Azure Portal URL represented by the selected tree node key. */
function getUrl(...args: unknown[]): string | undefined {
    const [key] = args;
    return typeof key === 'string' ? AzureNodeId.parse(key).toPortalUrl() : undefined;
}

/**
 * Builds a resolver for a portal page *beneath* a resource's own page, such as
 * a resource's console or logs blade.
 *
 * @param blade - Path appended to the resource's portal URL (for example
 *   `/console` or `console`).
 */
function bladeUrl(blade: string): (...args: unknown[]) => string | undefined {
    const normalizedBlade = blade.startsWith('/') ? blade : `/${blade}`;
    return (...args: unknown[]) => {
        const url = getUrl(...args);
        return url ? `${url}${normalizedBlade}` : undefined;
    };
}

/** Declarative metadata for the open-in-portal URL command. */
export const OpenInPortal = {
    ContextValue: 'openInPortal',
    getUrl,
    bladeUrl,
} as const;
