/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import treeKill from 'tree-kill';

/**
 * Callback-based process-tree killer compatible with {@linkcode treeKill}.
 * Exposed so callers can inject a deterministic implementation in tests.
 */
export type KillProcessTreeFn = (
    processId: number,
    signal: string | undefined,
    callback: (error?: Error) => void,
) => void;

/**
 * Terminates a process and its descendants.
 *
 * A process that exited before termination is considered successfully stopped.
 */
export function killProcessTree(processId: number, killFn: KillProcessTreeFn = treeKill): Promise<void> {
    if (hasExited(processId)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        killFn(processId, undefined, error => {
            if (!error || isProcessMissing(error)) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

function isProcessMissing(error: Error): boolean {
    return 'code' in error && error.code === 'ESRCH';
}

function hasExited(processId: number): boolean {
    try {
        process.kill(processId, 0);
        return false;
    } catch (error) {
        return error !== null
            && typeof error === 'object'
            && 'code' in error
            && error.code === 'ESRCH';
    }
}
