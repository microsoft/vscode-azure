/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type { DefaultTelemetryMeasurements, DefaultTelemetryProperties, IActionContext } from './IActionContext';
import type { ITelemetryReporter } from './ITelemetryReporter';

export const IActionExecutor: ServiceIdentifier<IActionExecutor> = Symbol.for('IActionExecutor');
export interface IActionExecutor {
    callWithTelemetryAndErrorHandling<T>(
        telemetryId: string,
        callback: ActionCallback<T>
    ): Promise<T | undefined>;
}

export type ActionCallback<T> = (context: IActionContext, ...args: unknown[]) => T | Promise<T>;

export class ActionExecutor implements IActionExecutor {
    public constructor(
        private readonly telemetryReporter: ITelemetryReporter
    ) { }

    public async callWithTelemetryAndErrorHandling<T>(
        telemetryId: string,
        callback: ActionCallback<T>
    ): Promise<T | undefined> {
        const properties: Writable<DefaultTelemetryProperties> & Record<string, string> = {};
        const measurements: Writable<DefaultTelemetryMeasurements> & Record<string, number> = {};

        const context: IActionContext = {
            telemetry: {
                properties,
                measurements,
            },
            errorHandling: {},
        };

        try {
            const startTime = Date.now();

            const result = await callback(context);

            properties.result = 'Succeeded';
            measurements.duration = (Date.now() - startTime) / 1000;

            return result;
        } catch (error) {
            // TODO error/cancellation handling plus telemetry
            properties.result = 'Failed';

            if (context.errorHandling.rethrow) {
                throw error;
            } else {
                return undefined;
            }
        } finally {
            this.telemetryReporter.sendTelemetryErrorEvent(telemetryId, properties, measurements);
        }
    }
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };
