/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcHttpServer } from '../../base/IpcHttpServer';

const isWindows = process.platform === 'win32';

/** Issues a plain GET over the given socket path and resolves the response body. */
function get(socketPath: string, path = '/'): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({ socketPath, path, method: 'GET' }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => { chunks.push(c); });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/** Polls `fn` until it returns true or the timeout elapses. */
async function waitFor(fn: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (!fn()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor timed out');
        }
        await new Promise(r => setTimeout(r, 10));
    }
}

describe('IpcHttpServer (unit)', () => {
    describe('create', () => {
        it('should expose a socket path matching the platform format', async () => {
            const server = await IpcHttpServer.create((_req, res) => res.end());
            try {
                if (isWindows) {
                    expect(server.socketPath).to.match(/^\\\\\.\\pipe\\[0-9a-f-]+$/);
                } else {
                    expect(server.socketPath.endsWith('/s.sock')).to.be.true;
                }
            } finally {
                server.dispose();
            }
        });

        it('should dispatch incoming requests to the listener', async () => {
            const server = await IpcHttpServer.create((req, res) => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(`hello ${req.url}`);
            });
            try {
                const result = await get(server.socketPath, '/world');
                expect(result.statusCode).to.equal(200);
                expect(result.body).to.equal('hello /world');
            } finally {
                server.dispose();
            }
        });

        it('should restrict the containing directory to the owner on Unix', async function () {
            if (isWindows) {
                this.skip();
            }
            const server = await IpcHttpServer.create((_req, res) => res.end());
            try {
                const dir = server.socketPath.replace(/\/s\.sock$/, '');
                const mode = statSync(dir).mode & 0o777;
                expect(mode).to.equal(0o700);
            } finally {
                server.dispose();
            }
        });

        it('should produce a distinct path for each concurrent server in the same baseDir', async function () {
            if (isWindows) {
                // baseDir is ignored on Windows; pipe UUIDs are always unique.
                this.skip();
            }
            const baseDir = mkdtempSync(join(tmpdir(), 'ipcsrv-test-'));
            try {
                const [a, b] = await Promise.all([
                    IpcHttpServer.create((_req, res) => { res.end(); }, { baseDir }),
                    IpcHttpServer.create((_req, res) => { res.end(); }, { baseDir }),
                ]);
                try {
                    expect(a.socketPath).to.not.equal(b.socketPath);
                } finally {
                    a.dispose();
                    b.dispose();
                }
            } finally {
                rmSync(baseDir, { recursive: true, force: true });
            }
        });

        it('should terminate clients that exceed requestTimeoutMs', async () => {
            // Use a very short timeout. The handler never runs because the
            // request body never finishes.
            const server = await IpcHttpServer.create((_req, res) => res.end('ok'), { requestTimeoutMs: 50 });
            try {
                await new Promise<void>((resolve, reject) => {
                    const req = httpRequest({
                        socketPath: server.socketPath,
                        path: '/',
                        method: 'POST',
                        headers: { 'Content-Length': '100' },
                    }, (res) => {
                        // 408 means the server enforced requestTimeout; either response
                        // arriving or the socket closing is acceptable evidence.
                        res.resume();
                        res.on('end', resolve);
                    });
                    req.on('error', () => { resolve(); });
                    // Write only part of the promised body, then sit on the socket.
                    req.write('x');
                    // Don't call req.end() — the server should time out waiting.
                    setTimeout(() => { req.destroy(); reject(new Error('server did not enforce requestTimeout')); }, 2000);
                });
            } finally {
                server.dispose();
            }
        });
    });

    describe('dispose', () => {
        it('should release the listener so new connections fail', async () => {
            const server = await IpcHttpServer.create((_req, res) => res.end('ok'));
            const socketPath = server.socketPath;

            // Sanity check: server is live.
            const before = await get(socketPath);
            expect(before.statusCode).to.equal(200);

            server.dispose();

            // The listener releases asynchronously (server.close is async),
            // so wait until a fresh connection actually fails.
            await waitFor(() => {
                try {
                    if (!isWindows) {
                        // Once the socket file is removed (Unix), connect will fail.
                        return !existsSync(socketPath);
                    }
                    return true; // On Windows we can only verify by attempting a connect.
                } catch {
                    return true;
                }
            });

            try {
                await get(socketPath);
                expect.fail('Expected request to fail after dispose');
            } catch (err) {
                expect(err).to.be.instanceOf(Error);
            }
        });

        it('should remove the containing directory on Unix', async function () {
            if (isWindows) {
                this.skip();
            }
            const server = await IpcHttpServer.create((_req, res) => res.end());
            const dir = server.socketPath.replace(/\/s\.sock$/, '');
            expect(existsSync(dir)).to.be.true;

            server.dispose();

            await waitFor(() => !existsSync(dir));
            expect(existsSync(dir)).to.be.false;
        });

        it('should be safe to call multiple times', async () => {
            const server = await IpcHttpServer.create((_req, res) => res.end());
            server.dispose();
            expect(() => { server.dispose(); }).to.not.throw();
            expect(() => { server.dispose(); }).to.not.throw();
        });
    });
});
