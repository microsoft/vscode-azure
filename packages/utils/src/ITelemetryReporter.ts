/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TelemetryReporter } from '@vscode/extension-telemetry';
import type { ServiceIdentifier } from 'inversify';
import type { IExtensionContext } from './IExtensionContext';

export const ITelemetryReporter: ServiceIdentifier<ITelemetryReporter> = Symbol.for('ITelemetryReporter');
export interface ITelemetryReporter {
    sendTelemetryErrorEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>): void;
}

export function createTelemetryReporter(context: IExtensionContext): ITelemetryReporter {
    const debugTelemetry = process.env.DEBUGTELEMETRY?.toLowerCase() ?? process.env.VSCODE_RUNNING_TESTS?.toLowerCase();

    if (!debugTelemetry || debugTelemetry === '0' || debugTelemetry === 'false') {
        const aiKey = (context.extension.packageJSON as { aiKey?: string }).aiKey;

        if (!aiKey) {
            throw new Error('AI key is required for telemetry reporter');
        }

        // TODO extension ID that's part of event name?
        // TODO replacement options to scrub PII?
        const reporter = new TelemetryReporter(aiKey);
        context.subscriptions.push(reporter);

        return reporter;
    } else if (debugTelemetry === 'v' || debugTelemetry === 'verbose') {
        return new DebugTelemetryReporter();
    } else {
        return new NullTelemetryReporter();
    }
}

class NullTelemetryReporter implements ITelemetryReporter {
    public sendTelemetryErrorEvent(): void {
        // noop
    }
}

class DebugTelemetryReporter implements ITelemetryReporter {
    public sendTelemetryErrorEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>): void {
        console.log(`DEBUGTELEMETRY: "${eventName}"\nProperties: ${JSON.stringify(properties)}\nMeasurements: ${JSON.stringify(measurements)}`);
    }
}
