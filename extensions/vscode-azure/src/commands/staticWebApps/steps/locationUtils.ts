/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azure-utils';

/** How a resolved location compares to the Static Web Apps default. */
type StaticWebAppLocationClassification = 'empty' | 'default' | 'nonDefault';

/**
 * Records how a resolved location compares to the Static Web Apps default,
 * without recording the path itself.
 */
export function addLocationTelemetry(
    context: IActionContext,
    key: 'appLocation' | 'apiLocation' | 'outputLocation',
    value: string | undefined,
    defaultValue: string,
): void {
    if (value === undefined) {
        return;
    }

    let classification: StaticWebAppLocationClassification;
    if (value.length === 0) {
        classification = 'empty';
    } else if (value === defaultValue) {
        classification = 'default';
    } else {
        classification = 'nonDefault';
    }
    context.telemetry.properties[key] = classification;
}

/**
 * Build directories that hold a framework's server output rather than files
 * that can be served as-is.
 *
 * The Static Web Apps CLI reports one output location per framework, so a
 * server-rendered project and its static-export variant both resolve to the
 * server build. Uploading that as static content produces a broken site, so it
 * is treated the same as having no deployable output.
 */
const serverBuildLocations: readonly string[] = ['.next'];

/** Whether current azd can deploy the selected output as a distinct artifact directory. */
export function canAzdDeployStaticWebApp(outputLocation: string): boolean {
    const normalized = outputLocation.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0
        && normalized !== '/'
        && normalized !== '.'
        && !serverBuildLocations.includes(normalized.toLowerCase());
}
