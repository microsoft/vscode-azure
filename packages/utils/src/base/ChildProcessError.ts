/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Error thrown when a child process exits with a non-zero code or is
 * terminated by a signal.
 *
 * @remarks
 * The `message` is typically enriched with the process's captured `stderr`.
 * For failures where the process never started (e.g. `ENOENT`), the original
 * spawn error is surfaced instead of this type so callers can inspect its
 * `code` (see the process executor's error mapping).
 */
export class ChildProcessError extends Error {
    /**
     * @param message - Human-readable failure message (often the captured stderr).
     * @param code - The numeric exit code, or `null` when terminated by a signal.
     * @param signal - The terminating signal, or `null` when the process exited normally.
     */
    public constructor(
        message: string,
        public readonly code: number | null,
        public readonly signal: NodeJS.Signals | null,
    ) {
        super(message);
        this.name = 'ChildProcessError';
    }
}

/**
 * Type guard that returns `true` when `err` is a {@linkcode ChildProcessError}.
 *
 * @remarks
 * Uses a name-brand check in addition to `instanceof` so errors that cross
 * module realms are still recognized.
 */
export function isChildProcessError(err: unknown): err is ChildProcessError {
    return err instanceof ChildProcessError
        || (err instanceof Error && err.name === 'ChildProcessError');
}
