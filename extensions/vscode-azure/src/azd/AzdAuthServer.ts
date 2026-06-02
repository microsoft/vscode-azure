/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VsCodeExtensionCredential } from '@microsoft/vscode-azure-azutils';
import { IOutputChannel, IpcHttpServer, IVsCode, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
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
    getEnv(): Promise<AzdAuthEnv>;
}

/**
 * The environment variables AZD reads to discover and authenticate against
 * an external auth server. Returned from {@linkcode IAzdAuthServer.getEnv}.
 */
export interface AzdAuthEnv extends Record<string, string> {
    /* eslint-disable @typescript-eslint/naming-convention -- azd env var names */
    /**
     * Transport URL of the local auth server. Uses a `unix://` scheme
     * on POSIX or `npipe://` on Windows.
     */
    readonly AZD_AUTH_ENDPOINT: string;
    /** Shared secret azd must send as `Authorization: Bearer <key>`. */
    readonly AZD_AUTH_KEY: string;
    /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * The JSON body returned by the AZD external auth `POST /token` endpoint.
 * Matches the wire format consumed by azd's `RemoteCredential`.
 */
export type TokenResponse = TokenSuccessResponse | TokenErrorResponse;

/** Success variant of {@linkcode TokenResponse}. */
export interface TokenSuccessResponse {
    readonly status: 'success';
    readonly token: string;
    /** ISO-8601 expiration timestamp. */
    readonly expiresOn: string;
}

/** Error variant of {@linkcode TokenResponse}. */
export interface TokenErrorResponse {
    readonly status: 'error';
    readonly code: string;
    readonly message: string;
}

/** The api-version query string value required on `/token` requests. */
export const AzdAuthApiVersion = '2023-07-12-preview';

interface ServerState {
    readonly server: IpcHttpServer;
    readonly key: string;
}

/**
 * An HTTP server that implements the azd external auth protocol.
 *
 * AZD connects to this server via the `AZD_AUTH_ENDPOINT` and
 * `AZD_AUTH_KEY` environment variables. The endpoint is a
 * platform-local-only transport (Unix Domain Socket on POSIX, Named
 * Pipe on Windows) so the bytes never leave the machine and TLS is
 * unnecessary. {@linkcode VsCodeExtensionCredential} acquires tokens
 * from the VS Code authentication API on behalf of azd.
 *
 * @remarks
 * The protocol is defined by the azd CLI's `RemoteCredential`:
 *
 * - `POST /token?api-version={@linkcode AzdAuthApiVersion}`
 * - `Authorization: Bearer {AZD_AUTH_KEY}`
 * - Body: `{ "scopes": [...], "tenantId": "..." }`
 * - Response: `{ "status": "success", "token": "...", "expiresOn": "..." }`
 *   or `{ "status": "error", "code": "...", "message": "..." }`
 */
@injectable()
export class AzdAuthServer implements IAzdAuthServer, Disposable {
    private serverPromise: Promise<ServerState> | undefined;
    private disposed = false;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    public async getEnv(): Promise<AzdAuthEnv> {
        if (this.disposed) {
            throw new Error('AzdAuthServer has been disposed');
        }

        const { server, key } = await this.ensureStarted();

        return {
            /* eslint-disable @typescript-eslint/naming-convention -- azd env var names */
            AZD_AUTH_ENDPOINT: socketPathToUrl(server.socketPath),
            AZD_AUTH_KEY: key,
            /* eslint-enable @typescript-eslint/naming-convention */
        };
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;

        const promise = this.serverPromise;
        this.serverPromise = undefined;
        if (promise) {
            promise.then(
                ({ server }) => { server.dispose(); },
                () => { /* start() failed; nothing to dispose */ },
            );
        }
    }

    private ensureStarted(): Promise<ServerState> {
        this.serverPromise ??= this.start();
        return this.serverPromise;
    }

    private async start(): Promise<ServerState> {
        const key = randomUUID();

        const credential = new VsCodeExtensionCredential({
            authentication: this.code.authentication,
            output: this.output,
            code: this.code,
        });

        const server = await IpcHttpServer.create(
            (req, res) => { void this.handleRequest(req, res, key, credential); },
        );

        this.output.debug(`[auth] AZD auth server listening at ${socketPathToUrl(server.socketPath)}`);

        return { server, key };
    }

    private async handleRequest(
        req: IncomingMessage,
        res: ServerResponse,
        expectedKey: string,
        credential: VsCodeExtensionCredential,
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
                sendErrorJson(res, 'NotSignedInError', this.code.l10n.t('No VS Code authentication session available. Please sign in.'));
                return;
            }

            const expiresOn = new Date(token.expiresOnTimestamp).toISOString();
            this.output.debug(`[auth] AZD auth server token acquired, scopes=${JSON.stringify(scopes)} tenant=${tenantId ?? '<default>'} expiresOn=${expiresOn}`);

            sendSuccessJson(res, token.token, expiresOn);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.output.warn(this.code.l10n.t('[auth] AZD auth server token request failed: {0}', message));
            sendErrorJson(res, 'GetTokenError', this.code.l10n.t('Token request failed: {0}', message));
        }
    }
}

function sendErrorJson(res: ServerResponse, code: string, message: string): void {
    sendJson(res, { status: 'error', code, message });
}

function sendSuccessJson(res: ServerResponse, token: string, expiresOn: string): void {
    sendJson(res, { status: 'success', token, expiresOn });
}

function sendJson(res: ServerResponse, body: TokenResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/**
 * Formats an OS-level socket path (Unix Domain Socket path on POSIX,
 * `\\.\pipe\<name>` on Windows) as the `unix://` / `npipe://` URL
 * exposed via {@linkcode AzdAuthEnv.AZD_AUTH_ENDPOINT}.
 */
function socketPathToUrl(socketPath: string): string {
    if (process.platform === 'win32') {
        // \\.\pipe\<name> -> npipe://./pipe/<name>
        return `npipe://${socketPath.replace(/^\\\\/, '').replace(/\\/g, '/')}`;
    }
    return `unix://${socketPath}`;
}
