/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICredentialFactory, type TokenCredential } from '@microsoft/vscode-azure-azutils';
import { IOutputChannel, IVsCode, stringifyError, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';

export const IAzdAuthServer: ServiceIdentifier<IAzdAuthServer> = Symbol.for('IAzdAuthServer');

export interface IAzdAuthServer {
    /**
     * Returns the environment variables that should be set on a terminal
     * so azd delegates authentication to this server.
     *
     * Starts the server on first call; subsequent calls reuse the same
     * server instance.
     */
    getEnv(): Promise<Readonly<Record<string, string>>>;
}

/** The api-version query string value required on `/token` requests. */
export const AzdAuthApiVersion = '2023-07-12-preview';

interface StartedState {
    readonly socketPath: string;
    readonly key: string;
}

/**
 * An HTTP server that implements the azd external auth protocol.
 *
 * AZD connects to this server via the `AZD_AUTH_ENDPOINT` and
 * `AZD_AUTH_KEY` environment variables. The endpoint is a
 * platform-local-only transport (Unix Domain Socket on POSIX, Named
 * Pipe on Windows) so the bytes never leave the machine and TLS is
 * unnecessary. The injected {@linkcode ICredentialFactory} acquires
 * tokens. By default this produces a `VsCodeExtensionCredential`
 * backed by the VS Code authentication API, while tests can supply a
 * factory backed by another {@linkcode TokenCredential}.
 *
 * @remarks
 * The protocol is defined by the azd CLI's `RemoteCredential`
 * (see [external-authentication.md](https://github.com/Azure/azure-dev/blob/main/cli/azd/docs/external-authentication.md)).
 * `RemoteCredential` only decodes the response body when the HTTP
 * status is 200; non-200 responses surface as a generic transport
 * error with the body ignored. Protocol-level rejections therefore
 * return a bare status code with no body, and only the 200 path
 * emits the documented JSON envelope.
 */
@injectable()
export class AzdAuthServer implements IAzdAuthServer, Disposable {
    private startPromise: Promise<StartedState> | undefined;
    private disposed = false;
    /**
     * Set once {@linkcode createServer} returns, before {@linkcode listen}
     * is awaited, so {@linkcode dispose} can tear down even a partially
     * started server. Calling {@linkcode Server.close} on a server that
     * never listened still fires the callback, so the cleanup runs either
     * way.
     */
    private server: Server | undefined;
    /**
     * Temp directory holding the UDS file on POSIX, to be removed on
     * {@linkcode dispose}. `undefined` on Windows (named pipes have no
     * filesystem state) and before {@linkcode createSocketPath} resolves.
     */
    private cleanupDir: string | undefined;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(ICredentialFactory) private readonly credentialFactory: ICredentialFactory,
    ) { }

    public async getEnv(): Promise<Readonly<Record<string, string>>> {
        const { socketPath, key } = await this.ensureStarted();

        return {
            /* eslint-disable @typescript-eslint/naming-convention -- azd env var names */
            AZD_AUTH_ENDPOINT: socketPathToUrl(socketPath),
            AZD_AUTH_KEY: key,
            /* eslint-enable @typescript-eslint/naming-convention */
        };
    }

    public dispose(): void {
        this.disposed = true;

        if (this.startPromise) {
            // Startup may still be allocating the socket path. Close the server
            // once startup settles so disposal cannot leak a late-starting server.
            this.startPromise.then(
                () => { this.closeServer(); },
                () => { this.closeServer(); },
            );
        } else {
            this.closeServer();
        }
    }

    private ensureStarted(): Promise<StartedState> {
        if (this.disposed) {
            throw new Error(this.code.l10n.t('The AZD authentication server has been disposed.'));
        }

        this.startPromise ??= this.start();
        return this.startPromise;
    }

    private async start(): Promise<StartedState> {
        const key = randomUUID();

        const credential = this.credentialFactory();

        const { socketPath, cleanupDir } = await createSocketPath();
        this.cleanupDir = cleanupDir;

        const server = createServer((req, res) => {
            void this.handleRequest(req, res, key, credential);
        });
        this.server = server;

        // Without a permanent handler, an error emitted after listen() succeeds
        // would have no listeners and crash the extension host.
        server.on('error', (err) => {
            this.output.warn(this.code.l10n.t('[auth] AZD auth server error: {0}', stringifyError(err)));
        });

        try {
            await listen(server, socketPath);
            if (process.platform !== 'win32') {
                await chmod(socketPath, 0o600);
            }
        } catch (err) {
            this.closeServer();
            throw err;
        }

        this.output.debug(`[auth] AZD auth server listening at ${socketPathToUrl(socketPath)}`);

        return { socketPath, key };
    }

    private closeServer(): void {
        const server = this.server;
        if (!server) {
            return;
        }

        this.server = undefined;
        // Clean up only after the listening socket closes so its file
        // descriptor cannot race removal of the containing directory.
        server.close(() => {
            const cleanupDir = this.cleanupDir;
            this.cleanupDir = undefined;
            this.removeCleanupDir(cleanupDir);
        });
    }

    private removeCleanupDir(dir: string | undefined): void {
        if (dir) {
            void rm(dir, { recursive: true, force: true }).catch(() => {
                this.output.warn(this.code.l10n.t('[auth] Failed to clean up the AZD authentication server socket directory.'));
            });
        }
    }

    private async handleRequest(
        req: IncomingMessage,
        res: ServerResponse,
        expectedKey: string,
        credential: TokenCredential,
    ): Promise<void> {
        try {
            // Only POST /token is supported. Protocol-level rejections return a
            // bare HTTP status with no body, because azd's `RemoteCredential`
            // only parses the body when the response status is 200.
            if (req.method !== 'POST') {
                res.writeHead(405).end();
                return;
            }

            const url = new URL(req.url ?? '/', 'http://localhost');
            if (url.pathname !== '/token') {
                res.writeHead(404).end();
                return;
            }

            if (url.searchParams.get('api-version') !== AzdAuthApiVersion) {
                res.writeHead(400).end();
                return;
            }

            // Validate bearer token
            const authHeader = req.headers.authorization ?? '';
            if (authHeader !== `Bearer ${expectedKey}`) {
                res.writeHead(401).end();
                return;
            }

            // Parse and validate request body
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(await text(req)) as Record<string, unknown>;
            } catch {
                res.writeHead(400).end();
                return;
            }

            const scopes = parsed.scopes;
            if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(s => typeof s !== 'string' || s.length === 0)) {
                res.writeHead(400).end();
                return;
            }

            const tenantId = parsed.tenantId;
            if (tenantId !== undefined && typeof tenantId !== 'string') {
                res.writeHead(400).end();
                return;
            }

            // Acquire token via VS Code
            this.output.debug(`[auth] AZD auth server token request, scopes=${JSON.stringify(scopes)} tenant=${tenantId ?? '<default>'}`);

            const token = await credential.getToken(scopes as string[], { tenantId });

            if (!token) {
                sendJson(res, 200, { status: 'error', code: 'NotSignedInError', message: this.code.l10n.t('No VS Code authentication session available. Please sign in.') });
                return;
            }

            const expiresOn = new Date(token.expiresOnTimestamp).toISOString();
            this.output.debug(`[auth] AZD auth server token acquired, scopes=${JSON.stringify(scopes)} tenant=${tenantId ?? '<default>'} expiresOn=${expiresOn}`);

            sendJson(res, 200, { status: 'success', token: token.token, expiresOn });
        } catch (e) {
            const message = stringifyError(e);
            this.output.warn(this.code.l10n.t('[auth] AZD auth server token request failed: {0}', message));
            sendJson(res, 200, { status: 'error', code: 'GetTokenError', message: this.code.l10n.t('Token request failed: {0}', message) });
        }
    }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/** Waits for {@linkcode server} to be listening on {@linkcode socketPath}. */
function listen(server: Server, socketPath: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<undefined>();

    // Use .once so this temporary listener doesn't fire on later runtime errors;
    // the caller installs a permanent 'error' listener before calling listen().
    const onError = (err: Error): void => { reject(err); };
    server.once('error', onError);
    server.listen(socketPath, () => {
        server.off('error', onError);
        resolve(undefined);
    });

    return promise;
}

/**
 * Allocates a fresh OS-level socket path for the auth server. On POSIX,
 * creates a per-server temp directory (mode 0o700 via `mkdtemp`) so the
 * UDS file lives in a user-private location and `cleanupDir` can later
 * be removed wholesale. On Windows, returns a randomly-named Named Pipe
 * with no filesystem state.
 */
async function createSocketPath(): Promise<{ socketPath: string; cleanupDir: string | undefined }> {
    if (process.platform === 'win32') {
        return { socketPath: `\\\\.\\pipe\\${randomUUID()}`, cleanupDir: undefined };
    }
    // `mkdtemp` creates the directory with mode 0o700 on POSIX, restricting
    // it to the current user. (Mode 0o700, not 0o600, because the owner
    // still needs the execute/traverse bit to bind a socket file inside.)
    const dir = await mkdtemp(join(tmpdir(), 'azd-auth-'));
    return { socketPath: join(dir, 's.sock'), cleanupDir: dir };
}

/**
 * Formats an OS-level socket path (Unix Domain Socket path on POSIX,
 * `\\.\pipe\<name>` on Windows) as the `unix://` / `npipe://` URL
 * exposed via `AZD_AUTH_ENDPOINT`.
 */
function socketPathToUrl(socketPath: string): string {
    if (process.platform === 'win32') {
        // \\.\pipe\<name> -> npipe://./pipe/<name>
        return `npipe://${socketPath.replace(/^\\\\/, '').replace(/\\/g, '/')}`;
    }
    return `unix://${socketPath}`;
}
