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
 * severity filtering (see the package README). The per-severity children on
 * the `AzureLogger` interface (`verbose`/`info`/`warning`/`error`) are only
 * returned from the `@hidden` `createClientLogger` helper used internally by
 * each SDK; they are not part of the value exported as `AzureLogger`.
 * Consequently the root override is the only supported global sink, and the
 * per-call severity is not surfaced to that override as a separate argument.
 * All SDK messages are therefore forwarded through
 * {@linkcode IOutputChannel.debug} with an `[azure-sdk]` prefix; filtering by
 * severity is delegated to the output channel's own log level and to
 * {@linkcode setLogLevel}, which is called once up front and re-applied
 * whenever the channel emits
 * {@linkcode vscode.LogOutputChannel.onDidChangeLogLevel onDidChangeLogLevel}.
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

    const sink = (...args: unknown[]) => { output.debug('[azure-sdk]', ...args); };
    AzureLogger.log = sink;
    activeSink = sink;

    const levelSubscription = output.onDidChangeLogLevel(applyLevel);

    return {
        dispose: () => {
            if (activeSink !== sink) {
                // Something else replaced our sink after setup; leave it alone.
                return;
            }
            AzureLogger.log = previousLog;
            setLogLevel(previousLevel);
            levelSubscription.dispose();
            activeSink = undefined;
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
 * distinguish between them.
 *
 * Numeric values come from {@linkcode vscode.LogLevel} (`Off = 0`, `Trace = 1`,
 * `Debug = 2`, `Info = 3`, `Warning = 4`, `Error = 5`) and are compared as
 * numbers so this module has no runtime dependency on the `vscode` namespace.
 */
function toAzureLogLevel(level: vscode.LogLevel): AzureLogLevel | undefined {
    const n = level as number;
    if (n <= 0) { return undefined; } // Off or below
    if (n <= 2) { return 'verbose'; } // Trace, Debug
    if (n === 3) { return 'info'; }
    if (n === 4) { return 'warning'; }
    return 'error'; // 5+
}
