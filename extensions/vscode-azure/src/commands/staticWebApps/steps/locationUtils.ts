/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IActionContext } from '@microsoft/vscode-azure-utils';
import { parseDocument } from 'yaml';

/** Telemetry taxonomy retained from the source location prompts. */
export type StaticWebAppLocationClassification = 'empty' | 'default' | 'setting' | 'nonDefault';

/**
 * Adds source-compatible classification and setting-match telemetry without
 * recording the user-entered path itself.
 */
export function addLocationTelemetry(
    context: IActionContext,
    key: 'appLocation' | 'apiLocation' | 'outputLocation',
    value: string | undefined,
    defaultValue: string,
    valueFromSetting?: string,
): void {
    context.telemetry.properties[`${key}HasSetting`] = String(!!valueFromSetting);
    context.telemetry.properties[`${key}MatchesSetting`] = String(defaultValue === valueFromSetting);
    if (value === undefined) {
        return;
    }

    let classification: StaticWebAppLocationClassification;
    if (value.length === 0) {
        classification = 'empty';
    } else if (value === defaultValue) {
        classification = 'default';
    } else if (value === valueFromSetting) {
        classification = 'setting';
    } else {
        classification = 'nonDefault';
    }
    context.telemetry.properties[key] = classification;
}

/**
 * Verifies that a path round-trips when embedded as the quoted scalar used by
 * Static Web Apps workflow YAML.
 */
export function isYamlSafeLocation(value: string, key: 'app_location' | 'api_location' | 'output_location'): boolean {
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 10 || code === 13) {
            return false;
        }
    }
    const document = parseDocument(`${key}: "${value}"`);
    return document.errors.length === 0 && document.get(key) === value;
}

/** Whether current azd can deploy the selected output as a distinct artifact directory. */
export function canAzdDeployStaticWebApp(outputLocation: string): boolean {
    const normalized = outputLocation.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.length > 0 && normalized !== '/' && normalized !== '.';
}
