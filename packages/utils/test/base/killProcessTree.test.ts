/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { killProcessTree } from '../../src/base/killProcessTree';

describe('killProcessTree (integration)', () => {
    it('terminates a parent process and its child', async function () {
        this.timeout(10_000);
        let parent: ChildProcess | undefined;
        let childProcessId: number | undefined;

        try {
            parent = spawn(process.execPath, [
                '-e',
                [
                    "const { spawn } = require('node:child_process');",
                    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);",
                    'console.log(child.pid);',
                    'setInterval(() => {}, 1000);',
                ].join(' '),
            ], { stdio: ['ignore', 'pipe', 'inherit'] });

            const lines = createInterface({ input: parent.stdout! });
            const [line] = await once(lines, 'line') as [string];
            childProcessId = Number(line);

            const closed = once(parent, 'close');
            await killProcessTree(parent.pid!);
            await closed;

            expect(isProcessRunning(parent.pid!)).to.equal(false);
            expect(isProcessRunning(childProcessId)).to.equal(false);
        } finally {
            if (parent?.pid && isProcessRunning(parent.pid)) {
                await killProcessTree(parent.pid);
            }
            if (childProcessId) {
                await killProcessTree(childProcessId);
            }
        }
    });
});

function isProcessRunning(processId: number): boolean {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
            return false;
        }
        throw error;
    }
}
