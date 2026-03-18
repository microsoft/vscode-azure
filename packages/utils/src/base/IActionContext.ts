/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { ServiceIdentifier } from 'inversify';

export const IActionContext: ServiceIdentifier<IActionContext> = Symbol.for('IActionContext'); // TODO: do we need a service identifier for this?
export interface IActionContext {
    readonly telemetry: {
        readonly id: string;
        readonly properties: TelemetryProperties;
        readonly measurements: TelemetryMeasurements;
        suppress?: 'always' | 'onSuccess';
        /**
         * Set to `false` to indicate this event was not directly initiated by
         * the user (e.g. background enrichment, polling, VS Code tree callbacks).
         *
         * When `false`, `ActionExecutor` sets the legacy
         * `telemetry.properties.isActivationEvent` to `'true'` before sending
         * telemetry, unless the caller explicitly set that property themselves.
         *
         * When `undefined` or `true`, `telemetry.properties.isActivationEvent`
         * is left untouched
         */
        isUserEvent?: boolean;
    };

    readonly errorHandling: {
        suppressDisplay?: boolean;
        suppressReportIssue?: boolean;
        rethrow?: boolean;
    }
}

export function createActionContext(telemetryId: string, correlationId?: string): IActionContext {
    return {
        telemetry: {
            id: telemetryId,
            properties: {
                correlationId: correlationId ?? randomUUID(),
            },
            measurements: {},
        },
        errorHandling: {},
    };
}

export interface TelemetryProperties extends Record<string, string | undefined> {
    // TODO: All these need to match existing property names
    readonly result?: 'Succeeded' | 'Failed' | 'Canceled'; // TODO: Provisionally readonly? If we want to allow callers to set this, have to take away readonly
    readonly correlationId: string; // TODO: I think existing property name is 'x-ms-correlation-request-id', same as the header name
    isActivationEvent?: 'true' | 'false';
    readonly error?: string;
    readonly errorMessage?: string;
    readonly stack?: string;
}

export interface TelemetryMeasurements extends Record<string, number | undefined> {
    // TODO: All these need to match existing property names
    readonly duration?: number;
}
