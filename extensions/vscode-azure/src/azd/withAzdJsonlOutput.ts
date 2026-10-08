/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, delay, isFileNotFoundError, toAbortSignal, type IVsCode } from '@microsoft/vscode-azure-utils';
import type * as vscode from 'vscode';

/** Callbacks for consuming an append-only azd JSONL file during a task. */
export interface AzdJsonlOutputOptions {
    readonly code: IVsCode;
    readonly file: vscode.Uri;
    readonly intervalMs: number;
    /** Stops polling and requests cancellation of the task. */
    readonly cancellation?: vscode.CancellationToken | AbortSignal;
    /** Entries are delivered once, in file order. Asynchronous handlers are awaited. */
    readonly onEntry: (entry: unknown) => void | Promise<void>;
    /** Reports recoverable failures without file contents. Must not throw. */
    readonly onError: (kind: 'read' | 'parse' | 'handle') => void;
}

/**
 * Polls an append-only JSONL file for the lifetime of {@linkcode task}.
 *
 * Only newline-terminated entries are consumed; partial lines remain for the
 * next read. A missing file is expected before azd starts writing, or on azd
 * versions without file output. Other read, parse, and handler failures are
 * reported through {@linkcode AzdJsonlOutputOptions.onError}.
 *
 * Stops and awaits polling before a final read, on both success and failure.
 * The task's return value or error is preserved; output failures are best-effort.
 * The task must honor the supplied signal and settle when cancelled. Cancellation
 * throws the signal's abort reason after the task settles and output is drained.
 * Default abort errors are recognized by {@linkcode CancellationError.test}.
 * An already-cancelled source prevents the task and polling from starting.
 */
export async function withAzdJsonlOutput<T>(options: AzdJsonlOutputOptions, task: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const bridge = toAbortSignal(options.cancellation);
    try {
        bridge.signal?.throwIfAborted();
        let offset = 0;
        const readEntries = async (): Promise<void> => {
            let content: Uint8Array;
            try {
                content = await options.code.workspace.fs.readFile(options.file);
            } catch (error) {
                if (!isFileNotFoundError(error)) {
                    options.onError('read');
                }
                return;
            }

            const lastNewline = content.lastIndexOf(10);
            if (lastNewline < offset) {
                return;
            }
            const lines = new TextDecoder().decode(content.slice(offset, lastNewline + 1)).split('\n');
            offset = lastNewline + 1;
            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }
                let entry: unknown;
                try {
                    entry = JSON.parse(line) as unknown;
                } catch {
                    options.onError('parse');
                    continue;
                }
                try {
                    await options.onEntry(entry);
                } catch {
                    options.onError('handle');
                }
            }
        };

        const abort = new AbortController();
        const cancelPolling = () => { abort.abort(); };
        bridge.signal?.addEventListener('abort', cancelPolling, { once: true });
        const polling = (async (): Promise<void> => {
            while (!abort.signal.aborted) {
                await readEntries();
                try {
                    await delay(options.intervalMs, abort.signal);
                } catch (error) {
                    if (!CancellationError.test(error)) {
                        throw error;
                    }
                }
            }
        })();

        try {
            const result = await task(bridge.signal);
            bridge.signal?.throwIfAborted();
            return result;
        } catch (error) {
            bridge.signal?.throwIfAborted();
            throw error;
        } finally {
            abort.abort();
            try {
                await polling;
                await readEntries();
            } finally {
                bridge.signal?.removeEventListener('abort', cancelPolling);
            }
        }
    } finally {
        bridge.disposable.dispose();
    }
}
