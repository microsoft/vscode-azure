/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn as defaultSpawn } from '@azure/core-process';
import type { SpawnFn } from './IProcessExecutor';

/** Options for {@linkcode terminateProcessTree}, for tests to substitute the platform. */
export interface TerminateProcessTreeOptions {
    /** Subprocess factory, so a test can observe the command without running it. */
    readonly spawn?: SpawnFn;
    /** Platform to terminate for. Defaults to the host's. */
    readonly platform?: NodeJS.Platform;
}

/**
 * Terminates a process the extension did not spawn, along with anything it spawned.
 *
 * Resolves when the process is gone, and treats a process that had already exited as
 * success. Use this for a process id handed over by another component -- one the extension
 * owns should be stopped through its own {@linkcode IProcessExecutor} abort signal instead.
 *
 * @remarks
 * The two platforms need different mechanisms, and not only in spelling.
 *
 * On POSIX the process gets a plain `SIGTERM`, which lets a well-behaved parent shut its own
 * children down; that is deliberate, because a runner such as `concurrently` cleans up its
 * whole tree on `SIGTERM` and a forced kill would skip that.
 *
 * Windows has no such option. It cannot deliver a catchable signal at all -- Node's
 * `process.kill` terminates unconditionally, so no handler ever runs and every descendant is
 * orphaned. `taskkill /T` walking the tree is the only way to reach them.
 */
export async function terminateProcessTree(processId: number, options?: TerminateProcessTreeOptions): Promise<void> {
    if ((options?.platform ?? process.platform) !== 'win32') {
        try {
            process.kill(processId);
        } catch (error) {
            if (!isProcessMissing(error)) {
                throw error;
            }
        }
        return;
    }

    const spawn = options?.spawn ?? defaultSpawn;
    const child = spawn('taskkill', ['/PID', String(processId), '/T', '/F'], { stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', code => {
            // 128 is taskkill's 'no such process', which is the same benign race as ESRCH.
            if (code === 0 || code === TaskKillProcessNotFound) {
                resolve();
            } else {
                reject(new Error(`Could not terminate process ${processId}: taskkill exited with code ${code}.`));
            }
        });
    });
}

const TaskKillProcessNotFound = 128;

function isProcessMissing(error: unknown): boolean {
    return !!error
        && typeof error === 'object'
        && 'code' in error
        && error.code === 'ESRCH';
}
