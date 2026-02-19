/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import { createActionContext, type IActionContext, type TelemetryMeasurements, type TelemetryProperties } from './IActionContext';
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
        const context = createActionContext(telemetryId);

        // Grab writable references for later
        const properties = context.telemetry.properties as Writable<TelemetryProperties>;
        const measurements = context.telemetry.measurements as Writable<TelemetryMeasurements>;

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

/**
 * Simple helper type that just takes the `readonly` off all the properties in an object.
 * Used to allow us to have a clean public interface for {@link IActionContext} while still being able to set properties internally in {@link ActionExecutor}.
 */
type Writable<T> = { -readonly [K in keyof T]: T[K] };
