/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ServiceIdentifier } from 'inversify';
import type { IActionContext } from './IActionContext';
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
        const context: IActionContext = {
            telemetry: {
                properties: {},
                measurements: {},
            },
        };

        try {
            const startTime = Date.now();
            const result = await callback(context);
            const duration = Date.now() - startTime;

            context.telemetry.properties.result = 'Succeeded';
            context.telemetry.measurements.duration = (duration / 1000);

            return result;
        } catch {
            // TODO error/cancellation handling plus telemetry
            context.telemetry.properties.result = 'Failed';
            return undefined;
        } finally {
            this.telemetryReporter.sendTelemetryErrorEvent(telemetryId, context.telemetry.properties, context.telemetry.measurements);
        }
    }
}
