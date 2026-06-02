/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Disposable } from '../vscode/Disposable';

/** Options for {@linkcode IpcHttpServer.create}. */
export interface IpcHttpServerOptions {
    /**
     * The directory under which a randomly-named subfolder is created
     * to hold the socket file. Defaults to {@linkcode tmpdir}.
     *
     * Ignored on Windows, where named pipes are not file-backed and
     * the pipe name is generated from a random UUID instead.
     */
    readonly baseDir?: string;

    /**
     * Idle timeout (in milliseconds) applied to each incoming request
     * via {@linkcode Server.requestTimeout}. A client that fails to
     * finish sending a request within this window gets a 408 response
     * and the connection is closed. Set to `0` to disable.
     *
     * Defaults to `30_000` (30 seconds). Bounds-checking only; not
     * intended as a defense against malicious clients on the local
     * machine.
     */
    readonly requestTimeoutMs?: number;
}

/**
 * An HTTP server bound to a platform-local-only transport: a Unix
 * Domain Socket on POSIX, a Named Pipe on Windows.
 *
 * Because the transport is local-only, this server is **not**
 * reachable from other machines and does not require TLS to protect
 * the bytes on the wire. Callers should still apply their own
 * application-layer authentication (e.g. a bearer token) to defend
 * against other processes on the same machine.
 *
 * Use {@linkcode IpcHttpServer.create} to start a new server.
 * Disposing it closes the HTTP server and, on Unix, removes the
 * containing directory.
 */
export class IpcHttpServer implements Disposable {
    private constructor(
        private readonly server: Server,
        /**
         * The raw OS-level path passed to `server.listen`. On Unix
         * this is the absolute filesystem path of the socket; on
         * Windows it is the named pipe path (e.g. `\\.\pipe\<uuid>`).
         *
         * Suitable for use as Node's `socketPath` option
         * (e.g. `http.request({ socketPath, ... })`). Higher-level
         * URL formats such as `unix://` or `npipe://` are
         * caller-defined and must be derived from this value.
         */
        public readonly socketPath: string,
        private readonly cleanupDir: string | undefined,
    ) { }

    /**
     * Start a new HTTP server bound to a local-only transport.
     *
     * On Unix, creates a new subdirectory (with a random name) under
     * {@linkcode IpcHttpServerOptions.baseDir} and places the socket
     * file inside. The directory is chmod-ed so only the current user
     * can access it.
     *
     * On Windows, generates a named pipe with a random UUID. No
     * filesystem state is created.
     *
     * @param requestListener - The standard Node {@linkcode RequestListener}
     *   handler invoked for each incoming HTTP request.
     * @returns An {@linkcode IpcHttpServer} ready to accept connections.
     */
    public static create(requestListener: RequestListener, options?: IpcHttpServerOptions): Promise<IpcHttpServer> {
        let socketPath: string;
        let cleanupDir: string | undefined;

        if (process.platform === 'win32') {
            socketPath = `\\\\.\\pipe\\${randomUUID()}`;
        } else {
            const baseDir = options?.baseDir ?? tmpdir();
            // `mkdtempSync` creates the directory with mode 0o700 on POSIX,
            // restricting it to the current user. (Mode 0o700, not 0o600,
            // because the owner still needs the execute/traverse bit to bind
            // a socket file inside the directory.)
            const dir = mkdtempSync(join(baseDir, 'sock-'));
            cleanupDir = dir;
            socketPath = join(dir, 's.sock');
        }

        const server = createServer(requestListener);
        server.requestTimeout = options?.requestTimeoutMs ?? 30_000;

        return new Promise<IpcHttpServer>((resolve, reject) => {
            const onError = (err: Error) => {
                if (cleanupDir) {
                    try { rmSync(cleanupDir, { recursive: true, force: true }); } catch { /* ignore */ }
                }
                reject(err);
            };
            server.once('error', onError);
            server.listen(socketPath, () => {
                server.off('error', onError);
                resolve(new IpcHttpServer(server, socketPath, cleanupDir));
            });
        });
    }

    /**
     * Close the underlying HTTP server and, on Unix, remove the
     * containing directory once the listener is fully released.
     *
     * Safe to call multiple times. Cleanup is asynchronous: the
     * filesystem removal happens after Node finishes closing the
     * server's listening socket so that the unlink can never race
     * the socket fd.
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;

        const cleanupDir = this.cleanupDir;
        const cleanup = (): void => {
            if (cleanupDir) {
                try {
                    rmSync(cleanupDir, { recursive: true, force: true });
                } catch { /* ignore */ }
            }
        };

        try {
            this.server.close((_err) => { cleanup(); });
        } catch {
            // `server.close()` can throw synchronously (e.g. ERR_SERVER_NOT_RUNNING).
            // Run cleanup anyway so the temp directory doesn't leak.
            cleanup();
        }
    }

    private disposed = false;
}

