/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- Tiny dependency
import { AzureLogger, getLogLevel, setLogLevel, type AzureLogLevel } from '@azure/logger';
import { Disposable, type IOutputChannel } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** Tracks the currently-installed override so repeated setup calls are idempotent. */
let activeSink: ((...args: unknown[]) => void) | undefined;

/**
 * Route `@azure/logger` output (used by every Azure SDK) into the extension's
 * {@linkcode IOutputChannel} and keep its verbosity in sync with the channel's
 * current {@linkcode vscode.LogOutputChannel.logLevel logLevel}.
 *
 * `@azure/logger` only documents a single redirection hook --
 * {@linkcode AzureLogger.log} -- together with {@linkcode setLogLevel} for
 * severity filtering. The per-severity children on the `AzureLogger`
 * interface (`verbose`/`info`/`warning`/`error`) are only returned from the
 * `@hidden` `createClientLogger` helper used internally by each SDK; they are
 * not part of the value exported as `AzureLogger`, and severity is not
 * surfaced to the root override as a separate argument.
 *
 * However, the runtime that backs `@azure/logger`
 * (`@typespec/ts-http-runtime`'s internal logger context) builds each
 * per-severity child with the `debug` package's `extend()`, whose wrapper
 * prepends the fully-qualified namespace (e.g.
 * `azure:core-rest-pipeline:warning`) to the first argument before
 * delegating to the root `log`. We take advantage of that by parsing the
 * leading `azure:...:<level> ` token off the first arg so we can route each
 * message to the matching {@linkcode IOutputChannel} method
 * (`error`/`warn`/`info`/`debug`) and preserve the namespace as a readable
 * prefix. Messages that don't match the expected shape (e.g. direct
 * `AzureLogger.log(...)` calls, or a future format change) fall back to
 * {@linkcode IOutputChannel.debug} with a generic `[azure-sdk]` prefix.
 *
 * The `@azure/logger` level is also kept in sync with the channel's
 * {@linkcode vscode.LogOutputChannel.logLevel logLevel} via
 * {@linkcode setLogLevel}, called once up front and re-applied whenever the
 * channel emits
 * {@linkcode vscode.LogOutputChannel.onDidChangeLogLevel onDidChangeLogLevel},
 * so messages are filtered at the source and don't even reach our sink when
 * they're below the user's configured verbosity.
 *
 * Calling this function while a previous setup is still active is a no-op
 * that returns a non-functional {@linkcode Disposable}, so the first
 * setup's state is not clobbered (which would leave the override unrecoverable
 * via that setup's `dispose()`).
 *
 * @returns A {@linkcode Disposable} that restores the previous
 *   `AzureLogger.log` sink and `@azure/logger` level captured at setup
 *   time, and tears down the `onDidChangeLogLevel` subscription. Call
 *   this during extension deactivation (or register it with `pushDisposable`)
 *   so global state is not left mutated between activations or test runs.
 */
export function setUpAzureSdkLogging(output: IOutputChannel): Disposable {
    if (activeSink !== undefined) {
        // Another active setup already owns `AzureLogger.log`; don't stack
        // overrides or we'd capture our own sink as "previous."
        return Disposable.None;
    }

    const previousLog = AzureLogger.log;
    const previousLevel = getLogLevel();

    const applyLevel = () => { setLogLevel(toAzureLogLevel(output.logLevel)); };
    applyLevel();

    const sink = (...args: unknown[]) => {
        // The runtime prepends `<namespace>:<level> ` to the first arg for
        // every per-client logger (see `createClientLogger` -> `extend(level)`
        // in `@typespec/ts-http-runtime`'s debug wrapper). Parse that back out
        // so we can route to the matching `IOutputChannel` severity method
        // while keeping `util.format` placeholders intact in the template.
        const [first, ...rest] = args;
        if (typeof first === 'string') {
            const parsed = namespacePrefix.exec(first);
            if (parsed) {
                const [, namespace, level, message] = parsed;
                output[azureLevelToChannelMethod[level as AzureLogLevel]](`[${namespace}] ${message}`, ...rest);
                return;
            }
            // Unknown shape (direct AzureLogger.log call, or the runtime
            // changed its format): fall back to a generic debug-level sink.
            output.debug(`[azure-sdk] ${first}`, ...rest);
        } else {
            output.debug('[azure-sdk]', ...args);
        }
    };
    AzureLogger.log = sink;
    activeSink = sink;

    const levelSubscription = output.onDidChangeLogLevel(applyLevel);

    return {
        dispose: () => {
            // Always tear down our own subscription / internal tracking, even
            // if someone else replaced `AzureLogger.log` after setup -- otherwise
            // we'd leak the level listener and permanently block future setups.
            levelSubscription.dispose();
            activeSink = undefined;
            if (AzureLogger.log === sink) {
                AzureLogger.log = previousLog;
                setLogLevel(previousLevel);
            }
            // If something else replaced our sink after setup, leave its
            // replacement and level in place.
        },
    };
}

/**
 * Map a {@linkcode vscode.LogLevel} to the corresponding `@azure/logger`
 * {@linkcode AzureLogLevel}. Returns `undefined` when logging is disabled
 * (i.e. `LogLevel.Off`), which is the value that silences `@azure/logger`
 * entirely via {@linkcode setLogLevel}.
 *
 * Trace and Debug both map to `'verbose'` because `@azure/logger` does not
 * distinguish between them. Unknown/future levels fall back to `'error'`
 * (the least-verbose value) so we never accidentally enable more output
 * than the user asked for.
 */
function toAzureLogLevel(level: vscode.LogLevel): AzureLogLevel | undefined {
    return level in vsCodeLogLevelToAzureLevel ? vsCodeLogLevelToAzureLevel[level] : 'error';
}

/** Map each {@linkcode vscode.LogLevel} numeric value to its `@azure/logger` equivalent. */
const vsCodeLogLevelToAzureLevel = {
    0: undefined, // Off
    1: 'verbose', // Trace
    2: 'verbose', // Debug
    3: 'info',    // Info
    4: 'warning', // Warning
    5: 'error',   // Error
} as const satisfies Record<vscode.LogLevel, AzureLogLevel | undefined>;

/**
 * Matches the `<namespace>:<level> <message>` prefix that the runtime's
 * `debug`-style wrapper prepends to every message emitted via a per-client
 * logger. Capture groups: (1) namespace (e.g. `azure:core-rest-pipeline`),
 * (2) level (one of the four {@linkcode AzureLogLevel} values), (3) the
 * remainder of the original message (which may still contain `util.format`
 * placeholders that will be substituted by the output channel).
 */
const namespacePrefix = /^(azure(?::[^:\s]+)*?):(verbose|info|warning|error) ([\s\S]*)$/;

/** Route each `@azure/logger` severity to the matching {@linkcode IOutputChannel} method. */
const azureLevelToChannelMethod = {
    verbose: 'debug',
    info: 'info',
    warning: 'warn',
    error: 'error',
} as const satisfies Record<AzureLogLevel, 'debug' | 'info' | 'warn' | 'error'>;
