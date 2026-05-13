/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { ServiceIdentifier } from 'inversify';

export const IActionContext: ServiceIdentifier<IActionContext> = Symbol.for('IActionContext');

/**
 * Per-invocation context shared by an action (command, wizard step,
 * tree callback, etc.). Provides telemetry buckets and error-handling
 * flags that live for the duration of the action.
 *
 * Created by {@linkcode createActionContext} and flowed through
 * {@linkcode IActionExecutor.callWithTelemetryAndErrorHandling}.
 */
export interface IActionContext {
    /** Telemetry data collected during the action. */
    readonly telemetry: {
        /** Telemetry event name (typically the command id). */
        readonly id: string;
        readonly properties: TelemetryProperties;
        readonly measurements: TelemetryMeasurements;
        /**
         * If set, suppresses sending of the telemetry event -- either
         * always, or only when the action succeeded.
         */
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

    /**
     * Controls what the executor does with uncaught errors from the
     * action callback.
     */
    readonly errorHandling: {
        /**
         * Controls suppression of error UI shown to the user.
         *
         * - `'display'` -- suppress the error toast entirely.
         * - `'reportIssue'` -- show the toast but omit the "Report Issue" button.
         * - `undefined` (default) -- show the full error toast with the "Report Issue" button.
         */
        suppress?: 'display' | 'reportIssue';
        /** If `true`, the executor re-throws the error after recording telemetry. */
        rethrow?: boolean;
    }
}

/**
 * Create a fresh {@linkcode IActionContext} with the given telemetry
 * event id. A random correlation id is generated if one is not supplied.
 */
export function createActionContext(telemetryId: string, correlationId?: string): IActionContext {
    return {
        telemetry: {
            id: telemetryId,
            properties: {
                'x-ms-correlation-request-id': correlationId ?? randomUUID(),
            },
            measurements: {},
        },
        errorHandling: {},
    };
}

/**
 * String-valued telemetry properties sent with an action event.
 * Arbitrary keys are allowed; a few well-known ones are declared for
 * autocomplete and consistency across the codebase.
 */
export interface TelemetryProperties extends Record<string, string | undefined> {
    readonly result?: 'Succeeded' | 'Failed' | 'Canceled';
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Keeping existing property name
    readonly 'x-ms-correlation-request-id': string;
    isActivationEvent?: 'true' | 'false';
    readonly error?: string;
    readonly errorMessage?: string;
    readonly stack?: string;

    /** Which tree instance this event originated from */
    tree?: string;
    /** The provider class name that handled this operation */
    provider?: string;
    /** The domain-specific node type (e.g. `'subscription'`, `'acrRegistry'`). Set by providers. */
    nodeType?: string;
}

/**
 * Well-known writable telemetry property names. Used by {@linkcode IActionExecutor.setTelProp}
 * to provide autocomplete for common keys while still allowing arbitrary strings.
 *
 * The `| (string & {})` hack causes intellisense to suggest the known keys but not restrict
 * callers to them.
 */
export type KnownTelemetryProperty = 'tree' | 'provider' | 'nodeType' | (string & {});

/**
 * Numeric telemetry measurements sent with an action event.
 * Arbitrary keys are allowed; `duration` is populated automatically
 * by {@linkcode IActionExecutor.callWithTelemetryAndErrorHandling}.
 */
export interface TelemetryMeasurements extends Record<string, number | undefined> {
    readonly duration?: number;
}
