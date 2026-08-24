/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import { terminateProcessTree } from '../../src/base/terminateProcessTree';

/** A stand-in child that reports the given exit code on the next tick. */
function fakeChild(exitCode: number | null, error?: Error): ChildProcess {
    const emitter = new EventEmitter();
    setImmediate(() => {
        if (error) {
            emitter.emit('error', error);
        } else {
            emitter.emit('close', exitCode);
        }
    });
    return emitter as unknown as ChildProcess;
}

describe('terminateProcessTree (unit)', () => {
    describe('windows', () => {
        it('should kill the whole tree, because a signal cannot reach the descendants', async () => {
            const spawn = mock.fn(() => fakeChild(0));

            await terminateProcessTree(4321, { platform: 'win32', spawn });

            expect(spawn.mock.callCount()).to.equal(1);
            const [command, args] = spawn.mock.calls[0].arguments as unknown as [string, string[]];
            expect(command).to.equal('taskkill');
            // /T is the load-bearing flag: swa start runs its emulator, the Functions host
            // and the dev server as children, and none of them are reachable without it.
            expect(args).to.include('/T');
            expect(args).to.include('4321');
        });

        it('should treat an already-exited process as success', async () => {
            const spawn = mock.fn(() => fakeChild(128));

            await terminateProcessTree(4321, { platform: 'win32', spawn });
        });

        it('should surface any other taskkill failure', async () => {
            const spawn = mock.fn(() => fakeChild(1));

            let caught: unknown;
            try {
                await terminateProcessTree(4321, { platform: 'win32', spawn });
            } catch (error) {
                caught = error;
            }
            expect(caught).to.be.instanceOf(Error);
        });

        it('should surface a taskkill that could not be launched', async () => {
            const spawn = mock.fn(() => fakeChild(null, new Error('ENOENT')));

            let caught: unknown;
            try {
                await terminateProcessTree(4321, { platform: 'win32', spawn });
            } catch (error) {
                caught = error;
            }
            expect((caught as Error).message).to.equal('ENOENT');
        });
    });

    describe('posix', () => {
        it('should signal the process rather than force-killing its tree', async () => {
            // A plain SIGTERM lets the process shut its own children down, which is what
            // the SWA CLI's runner does; taskkill /F would skip that cleanup.
            const kill = mock.method(process, 'kill', () => true);
            const spawn = mock.fn(() => fakeChild(0));

            await terminateProcessTree(4321, { platform: 'darwin', spawn });

            expect(spawn.mock.callCount()).to.equal(0);
            expect(kill.mock.calls[0].arguments[0]).to.equal(4321);
            mock.restoreAll();
        });

        it('should treat an already-exited process as success', async () => {
            mock.method(process, 'kill', () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); });

            await terminateProcessTree(4321, { platform: 'darwin' });
            mock.restoreAll();
        });

        it('should surface any other signal failure', async () => {
            mock.method(process, 'kill', () => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); });

            let caught: unknown;
            try {
                await terminateProcessTree(4321, { platform: 'darwin' });
            } catch (error) {
                caught = error;
            }
            expect((caught as NodeJS.ErrnoException).code).to.equal('EPERM');
            mock.restoreAll();
        });
    });
});
