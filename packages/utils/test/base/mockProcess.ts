/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { mock, type Mock } from 'node:test';
import { ProcessExecutor, type SpawnFn } from '../../src/base/IProcessExecutor';
import type { IVsCode } from '../../src/vscode/IVsCode';

/** Creates a subprocess fixture with asynchronous stdio/exit events; keepAlive processes close on cancellation. */
export function createMockSpawn(options?: {
    readonly stdout?: string;
    readonly stdoutChunks?: readonly string[];
    readonly stderr?: string;
    readonly stderrLines?: readonly string[];
    readonly exitCode?: number | null;
    readonly signalName?: NodeJS.Signals | null;
    readonly spawnError?: Error;
    readonly emitError?: Error;
    readonly keepAlive?: boolean;
    /** Synthetic PIDs for fixtures with an injected, non-system process-tree terminator. */
    readonly pid?: number;
}): Mock<SpawnFn> {
    const { stdout = '', stderr = '', stderrLines, exitCode = 0, signalName = null, spawnError, emitError, keepAlive } = options ?? {};
    let nextPid = options?.pid;
    return mock.fn<SpawnFn>((_executable, _args, spawnOptions): ChildProcess => {
        if (spawnError) { throw spawnError; }
        const child = new ChildProcess();
        Object.defineProperties(child, {
            pid: { value: nextPid === undefined ? undefined : nextPid++ },
            stdout: { value: Readable.from(options?.stdoutChunks ?? (stdout ? [stdout] : [])) },
            stderr: { value: Readable.from(stderrLines ? stderrLines.map(line => `${line}\n`) : stderr ? [stderr] : []) },
        });
        if (keepAlive) {
            spawnOptions?.signal?.addEventListener('abort', () => { child.emit('close', 0, null); }, { once: true });
        } else {
            setImmediate(() => {
                if (emitError) { child.emit('error', emitError); }
                else { child.emit('close', exitCode, signalName); }
            });
        }

        return child;
    });
}

/** Couples synthetic subprocess IDs with a mock tree terminator, so no fixture ID reaches a system kill operation. */
export function createMockProcessExecutor(code: IVsCode, options?: Parameters<typeof createMockSpawn>[0]) {
    const spawn = createMockSpawn({ ...options, pid: 1 });
    const terminateTree = mock.fn((pid: number) => {
        const child = spawn.mock.calls.map(call => call.result).find(candidate => candidate?.pid === pid);
        if (!child) { return Promise.reject(new Error('The process fixture does not own this PID.')); }
        child.emit('close', 0, null);
        return Promise.resolve();
    });
    const resolve = mock.fn((command: string) => code.Uri.file(`/tools/${command}`).fsPath);
    return { executor: new ProcessExecutor(code, spawn, resolve, terminateTree), spawn, terminateTree, resolve };
}
