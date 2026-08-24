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

/** Declarative metadata for the open-in-portal URL command. */
export const OpenInPortal = {
    ContextValue: 'openInPortal',
    getUrl,
} as const;
