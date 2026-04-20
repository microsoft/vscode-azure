/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncLocalStorage } from 'async_hooks';
import type { ServiceIdentifier } from 'inversify';
import type { AsWritable } from '../types/AsWritable';
import { CancellationError } from '../vscode/CancellationError';
import type { IOutputChannel } from '../vscode/IOutputChannel';
import { createActionContext, type IActionContext, type KnownTelemetryProperty, type TelemetryMeasurements, type TelemetryProperties } from './IActionContext';
import type { ITelemetryReporter } from './ITelemetryReporter';

export const IActionExecutor: ServiceIdentifier<IActionExecutor> = Symbol.for('IActionExecutor');

/**
 * Runs action callbacks inside a per-invocation {@linkcode IActionContext},
 * reporting telemetry and handling errors uniformly.
 *
 * The context is stored in an `AsyncLocalStorage` so that code deep in
 * the call stack can access it via {@linkcode currentContext} without
 * having to thread the context through every call.
 */
export interface IActionExecutor {
    /** The {@linkcode IActionContext} for the currently executing action, or `undefined` if none. */
    readonly currentContext: IActionContext | undefined;
    /** Set a telemetry property on the current context, if one exists. No-op otherwise. */
    setTelProp(name: KnownTelemetryProperty, value: string): void;
    /** Set a telemetry measurement on the current context, if one exists. No-op otherwise. */
    setTelMeasure(name: string, value: number): void;
    /**
     * Run `callback` inside a new {@linkcode IActionContext}, report
     * telemetry, and handle errors.
     *
     * Returns the callback's result on success, or `undefined` if the
     * callback threw (and `context.errorHandling.rethrow` was not set).
     *
     * @throws Rethrows the callback's error when `context.errorHandling.rethrow` is `true`.
     */
    callWithTelemetryAndErrorHandling<T>(
        telemetryId: string,
        callback: ActionCallback<T>
    ): Promise<T | undefined>;
}

/**
 * Callback signature accepted by
 * {@linkcode IActionExecutor.callWithTelemetryAndErrorHandling} and
 * command registrations. Receives the fresh {@linkcode IActionContext}
 * and any additional command arguments.
 */
export type ActionCallback<T> = (context: IActionContext, ...args: unknown[]) => T | Promise<T>;

/** Default {@linkcode IActionExecutor} implementation backed by `AsyncLocalStorage`. */
export class ActionExecutor implements IActionExecutor {
    private readonly storage = new AsyncLocalStorage<IActionContext>();

    public constructor(
        private readonly telemetryReporter: ITelemetryReporter,
        private readonly output?: IOutputChannel,
    ) { }

    /** @inheritdoc */
    public get currentContext(): IActionContext | undefined {
        return this.storage.getStore();
    }

    /** @inheritdoc */
    public setTelProp(name: KnownTelemetryProperty, value: string): void {
        const context = this.currentContext;
        if (context) {
            context.telemetry.properties[name] = value;
        }
    }

    /** @inheritdoc */
    public setTelMeasure(name: string, value: number): void {
        const context = this.currentContext;
        if (context) {
            context.telemetry.measurements[name] = value;
        }
    }

    /** @inheritdoc */
    public async callWithTelemetryAndErrorHandling<T>(
        telemetryId: string,
        callback: ActionCallback<T>
    ): Promise<T | undefined> {
        const context = createActionContext(telemetryId);

        // Grab writable references for later
        const properties = context.telemetry.properties as AsWritable<TelemetryProperties>;
        const measurements = context.telemetry.measurements as AsWritable<TelemetryMeasurements>;

        const startTime = Date.now();

        return this.storage.run(context, async () => {
            try {
                this.output?.debug(`[cmd] ${telemetryId} start`);
                const result = await callback(context);
                this.output?.debug(`[cmd] ${telemetryId} done`);

                properties.result = 'Succeeded';
                return result;
            } catch (error) {
                // TODO: toast error message + report issue button
                if (CancellationError.test(error)) {
                    properties.result = 'Canceled'; // TODO: Verify spelling is the same as existing
                    // TODO: cancel step
                } else {
                    // TODO: error/cancellation handling plus telemetry
                    properties.result = 'Failed';
                    const loggedError = error instanceof Error ? error : new Error(String(error));
                    this.output?.error(loggedError, `[cmd] ${telemetryId} failed`);
                }

                if (context.errorHandling.rethrow) {
                    throw error;
                } else {
                    return undefined;
                }
            } finally {
                measurements.duration = (Date.now() - startTime) / 1000;

                // Remap isUserEvent to the legacy isActivationEvent property
                if (context.telemetry.isUserEvent === false && properties.isActivationEvent === undefined) {
                    properties.isActivationEvent = 'true';
                }

                if (context.telemetry.suppress !== 'always' &&
                    !(context.telemetry.suppress === 'onSuccess' && properties.result === 'Succeeded')
                ) {
                    this.telemetryReporter.sendTelemetryErrorEvent(telemetryId, properties, measurements);
                }
            }
        });
    }
}
