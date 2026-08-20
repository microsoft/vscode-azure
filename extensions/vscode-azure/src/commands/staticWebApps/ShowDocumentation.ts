/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { staticWebAppsDocumentationUrl, staticWebAppsFunctionsDocumentationUrl } from './staticWebAppLinks';

/**
 * Declarative metadata for the Static Web Apps product documentation command.
 *
 * These are plain URL commands, so they are registered as `OpenUrl` with the URL
 * supplied as a prefix argument rather than as command classes of their own,
 * which is what gives them the extension's shared scheme checking and telemetry.
 * What remains here is the part registration cannot express: the context value
 * the view provider stamps on the node that offers the command.
 */
export const ShowStaticWebAppsDocumentation = {
    Url: staticWebAppsDocumentationUrl,
} as const;

/** Declarative metadata for the Functions API documentation command. */
export const ShowFunctionsDocumentation = {
    /** Context value for the no-functions help node. */
    ContextValue: 'showStaticWebAppFunctionsDocumentation',
    Url: staticWebAppsFunctionsDocumentationUrl,
} as const;
