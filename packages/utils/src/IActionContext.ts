/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';

export const IActionContext: ServiceIdentifier<IActionContext> = Symbol.for('IActionContext');
export interface IActionContext {
    readonly telemetry: {
        readonly properties: Record<string, string> & DefaultTelemetryProperties;
        readonly measurements: Record<string, number> & DefaultTelemetryMeasurements;
    };

    readonly errorHandling: {
        suppressDisplay?: boolean;
        suppressReportIssue?: boolean;
        rethrow?: boolean;
    }
}

export interface DefaultTelemetryProperties {
    // TODO All these need to match existing property names
    readonly result?: 'Succeeded' | 'Failed' | 'Canceled'; // Provisionally readonly? If we want to allow callers to set this, have to take away readonly
    isActivationEvent?: 'true' | 'false';
    readonly error?: string;
    readonly errorMessage?: string;
    readonly stack?: string;
}

export interface DefaultTelemetryMeasurements {
    // TODO All these need to match existing property names
    readonly duration?: number;
}
