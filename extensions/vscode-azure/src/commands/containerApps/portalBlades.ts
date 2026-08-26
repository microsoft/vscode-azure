/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OpenInPortal } from '../tree/OpenInPortal';

/**
 * Opens the container app's console blade, where the portal offers an
 * interactive shell into a running replica.
 *
 * Registered as a prefix argument to the shared {@linkcode OpenUrl} command, so
 * it inherits that command's telemetry, error handling, and scheme check
 * instead of being a product-specific navigation command.
 */
export const OpenContainerAppConsole = {
    ContextValue: 'openContainerAppConsole',
    getUrl: OpenInPortal.bladeUrl('/console'),
} as const;

/**
 * Opens the container app's logs blade, which is the portal's query experience
 * over the app's Log Analytics workspace.
 *
 * This is the historical-query counterpart to live log streaming.
 */
export const OpenContainerAppLogs = {
    ContextValue: 'openContainerAppLogs',
    getUrl: OpenInPortal.bladeUrl('/logs'),
} as const;
