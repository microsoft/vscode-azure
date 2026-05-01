/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VsCodeExtensionCredential } from '@microsoft/vscode-azure-azutils';
import { IOutputChannel, IVsCode, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import * as forge from 'node-forge';
import { generateKeyPair as cryptoGenerateKeyPair, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { promisify } from 'node:util';

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

/** The only API version we support. */
const apiVersion = '2023-07-12-preview';

/**
 * An HTTPS server that implements the azd external auth protocol.
 *
 * AZD connects to this server via the `AZD_AUTH_ENDPOINT`,
 * `AZD_AUTH_KEY`, and `AZD_AUTH_CERT` environment variables. The
 * server uses {@linkcode VsCodeExtensionCredential} to acquire tokens
 * from the VS Code authentication API.
 *
 * @remarks
 * The protocol is defined by the azd CLI's `RemoteCredential`:
 *
 * - `POST /token?api-version=2023-07-12-preview`
 * - `Authorization: Bearer {AZD_AUTH_KEY}`
 * - Body: `{ "scopes": [...], "tenantId": "..." }`
 * - Response: `{ "status": "success", "token": "...", "expiresOn": "..." }`
 *   or `{ "status": "error", "code": "...", "message": "..." }`
 *
 * A self-signed TLS certificate is generated using `node-forge` so that
 * communication between azd and this server is encrypted. The cert is
 * passed to azd as base64-encoded DER via `AZD_AUTH_CERT`.
 */
interface ServerState {
    readonly server: Server;
    readonly port: number;
    readonly key: string;
    readonly certBase64Der: string;
}

@injectable()
export class AzdAuthServer implements IAzdAuthServer, Disposable {
    private serverPromise: Promise<ServerState> | undefined;

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
    ) { }

    public async getEnv(): Promise<Readonly<Record<string, string>>> {
        const { port, key, certBase64Der } = await this.ensureStarted();

        return {
            /* eslint-disable @typescript-eslint/naming-convention -- azd env var names */
            AZD_AUTH_ENDPOINT: `https://127.0.0.1:${port}`,
            AZD_AUTH_KEY: key,
            AZD_AUTH_CERT: certBase64Der,
            /* eslint-enable @typescript-eslint/naming-convention */
        };
    }

    public dispose(): void {
        if (this.serverPromise) {
            void this.serverPromise.then(({ server }) => server.close());
        }
    }

    private ensureStarted(): Promise<ServerState> {
        this.serverPromise ??= this.start();
        return this.serverPromise;
    }

    private async start(): Promise<ServerState> {
        const key = randomUUID();
        const { certPem, keyPem, certDerBase64 } = await generateSelfSignedCert();

        const credential = new VsCodeExtensionCredential({
            authentication: this.code.authentication,
            output: this.output,
            code: this.code,
        });

        const server = createServer(
            { cert: certPem, key: keyPem },
            (req, res) => { void this.handleRequest(req, res, key, credential); },
        );

        const port = await listen(server);
        this.output.debug(`[azdAuth] server listening on port ${port}`);

        return { server, port, key, certBase64Der: certDerBase64 };
    }

    private async handleRequest(
        req: IncomingMessage,
        res: ServerResponse,
        expectedKey: string,
        credential: VsCodeExtensionCredential,
    ): Promise<void> {
        try {
            // Only POST /token is supported
            if (req.method !== 'POST') {
                sendError(res, 405, 'method_not_allowed', this.code.l10n.t('Method not allowed'));
                return;
            }

            const url = new URL(req.url ?? '/', `https://127.0.0.1`);
            if (url.pathname !== '/token') {
                sendError(res, 404, 'not_found', this.code.l10n.t('Not found'));
                return;
            }

            if (url.searchParams.get('api-version') !== apiVersion) {
                sendError(res, 400, 'bad_request', this.code.l10n.t('Unsupported api-version. Expected {0}', apiVersion));
                return;
            }

            // Validate bearer token
            const authHeader = req.headers.authorization ?? '';
            if (authHeader !== `Bearer ${expectedKey}`) {
                sendError(res, 401, 'unauthorized', this.code.l10n.t('Invalid or missing authorization key'));
                return;
            }

            // Parse request body
            let body: string;
            try {
                body = await readBody(req);
            } catch {
                sendError(res, 413, 'bad_request', this.code.l10n.t('Request body too large'));
                return;
            }

            let parsed: { scopes?: string[]; tenantId?: string };
            try {
                parsed = JSON.parse(body) as { scopes?: string[]; tenantId?: string };
            } catch {
                sendError(res, 400, 'bad_request', this.code.l10n.t('Invalid JSON body'));
                return;
            }

            const scopes = parsed.scopes;
            if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
                sendError(res, 400, 'bad_request', this.code.l10n.t('Missing or empty scopes'));
                return;
            }

            // Acquire token via VS Code
            this.output.debug(`[azdAuth] token request scopes=${JSON.stringify(scopes)} tenant=${parsed.tenantId ?? '<default>'}`);

            const token = await credential.getToken(scopes, {
                tenantId: parsed.tenantId,
            });

            if (!token) {
                sendTokenError(res, 'NotSignedInError', this.code.l10n.t('No VS Code authentication session available. Please sign in.'));
                return;
            }

            const expiresOn = new Date(token.expiresOnTimestamp).toISOString();

            this.output.debug(`[azdAuth] token acquired scopes=${JSON.stringify(scopes)} tenant=${parsed.tenantId ?? '<default>'} expiresOn=${expiresOn}`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'success',
                token: token.token,
                expiresOn,
            }));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.output.warn(this.code.l10n.t('[azdAuth] token request failed: {0}', message));
            sendTokenError(res, 'GetTokenError', this.code.l10n.t('Token request failed: {0}', message));
        }
    }
}

function sendError(res: ServerResponse, statusCode: number, code: string, message: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', code, message }));
}

/** Sends an error response with HTTP 200, matching the azd token response protocol. */
function sendTokenError(res: ServerResponse, code: string, message: string): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', code, message }));
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const maxSize = 64 * 1024; // 64 KB limit

        req.on('data', (chunk: Buffer) => {
            if (settled) {
                return;
            }
            size += chunk.length;
            if (size > maxSize) {
                settled = true;
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (!settled) {
                settled = true;
                resolve(Buffer.concat(chunks).toString('utf8'));
            }
        });
        req.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        });
    });
}

function listen(server: Server): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                resolve(addr.port);
            } else {
                reject(new Error('Failed to get server address'));
            }
        });
        server.on('error', reject);
    });
}

/**
 * Generates a self-signed X.509 certificate and RSA key pair.
 * The certificate is valid for 1 year and bound to `127.0.0.1`.
 *
 * RSA key generation uses Node's built-in `crypto.generateKeyPair`
 * to avoid blocking the extension host thread. The resulting keys are
 * converted to `node-forge` format for certificate construction.
 *
 * @returns PEM-encoded cert and key (for the Node.js HTTPS server),
 *   plus the base64-encoded DER cert (for `AZD_AUTH_CERT`).
 */
async function generateSelfSignedCert(): Promise<{ certPem: string; keyPem: string; certDerBase64: string }> {
    const { publicKey: publicKeyPem, privateKey: privateKeyPem } = await promisify(cryptoGenerateKeyPair)('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    const cert = forge.pki.createCertificate();

    cert.publicKey = publicKey;
    // Ensure the high bit is clear so the serial is a positive ASN.1 integer
    const serialBytes = randomBytes(16);
    serialBytes[0] &= 0x7f;
    cert.serialNumber = serialBytes.toString('hex');

    const now = new Date();
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
        { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] },
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
    ]);

    cert.sign(privateKey, forge.md.sha256.create());

    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(privateKey);

    // DER encoding: convert the ASN.1 cert to DER bytes, then base64
    const certAsn1 = forge.pki.certificateToAsn1(cert);
    const certDer = forge.asn1.toDer(certAsn1);
    const certDerBase64 = forge.util.encode64(certDer.getBytes());

    return { certPem, keyPem, certDerBase64 };
}
