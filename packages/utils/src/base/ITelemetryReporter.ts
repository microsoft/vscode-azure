/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TelemetryReporter } from '@vscode/extension-telemetry';
import type { ServiceIdentifier } from 'inversify';
import type { IExtensionContext } from '../vscode/IVsCode';

export const ITelemetryReporter: ServiceIdentifier<ITelemetryReporter> = Symbol.for('ITelemetryReporter');
export type ITelemetryReporter = Pick<TelemetryReporter, 'sendTelemetryErrorEvent' | 'dispose'>; // Subset of what we actually use

export function createTelemetryReporter(
    context: Readonly<IExtensionContext>,
    reporterCtor: new (connectionString: string) => ITelemetryReporter,
): ITelemetryReporter {
    /* c8 ignore next 2 */
    const debugTelemetry = process.env.DEBUGTELEMETRY?.toLowerCase() ?? process.env.VSCODE_RUNNING_TESTS?.toLowerCase();
    if (!debugTelemetry || debugTelemetry === '0' || debugTelemetry === 'false') {
        const aiKey = (context.extension.packageJSON as { aiKey?: string }).aiKey;

        if (!aiKey) {
            throw new Error('AI key is required for telemetry reporter');
        }

        // TODO extension ID that's part of event name?
        // TODO replacement options to scrub PII?
        return new reporterCtor(aiKey);
        /* c8 ignore next 5 */
    } else if (debugTelemetry === 'v' || debugTelemetry === 'verbose') {
        return new DebugTelemetryReporter(context.extension.id);
    } else {
        return new NullTelemetryReporter();
    }
}

/* c8 ignore start */
export class NullTelemetryReporter implements ITelemetryReporter {
    public sendTelemetryErrorEvent(): void {
        // noop
    }

    public dispose(): Promise<void> {
        return Promise.resolve();
    }
}

class DebugTelemetryReporter implements ITelemetryReporter {
    public constructor(private readonly extensionId: string) { }

    public sendTelemetryErrorEvent(eventName: string, properties?: Record<string, string>, measurements?: Record<string, number>): void {
        console.log(`DEBUGTEL: ${this.extensionId}/${eventName}`);
        console.log(`  Props : ${this.formatPropsOrMeasurements(properties)}`);
        console.log(`  Msmts : ${this.formatPropsOrMeasurements(measurements)}`);
    }

    public dispose(): Promise<void> {
        return Promise.resolve();
    }

    private formatPropsOrMeasurements(propsOrMsmt?: Record<string, string> | Record<string, number>): string {
        return Object.entries(propsOrMsmt ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(' | ');
    }
}
/* c8 ignore stop */
