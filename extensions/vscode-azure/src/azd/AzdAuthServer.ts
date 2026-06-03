/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VsCodeExtensionCredential } from '@microsoft/vscode-azure-azutils';
import { IOutputChannel, IVsCode, type Disposable } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { generateKeyPair as cryptoGenerateKeyPair, sign as cryptoSign, randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import { text } from 'node:stream/consumers';
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
 * A self-signed TLS certificate is generated using Node's built-in
 * `node:crypto` module so that communication between azd and this
 * server is encrypted. The cert is passed to azd as base64-encoded
 * DER via `AZD_AUTH_CERT`.
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
        this.output.debug(`[auth] AZD auth server listening on port ${port}`);

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
                sendJson(res, 405, { status: 'error', code: 'method_not_allowed', message: this.code.l10n.t('Method not allowed') });
                return;
            }

            const url = new URL(req.url ?? '/', 'https://127.0.0.1');
            if (url.pathname !== '/token') {
                sendJson(res, 404, { status: 'error', code: 'not_found', message: this.code.l10n.t('Not found') });
                return;
            }

            if (url.searchParams.get('api-version') !== apiVersion) {
                sendJson(res, 400, { status: 'error', code: 'bad_request', message: this.code.l10n.t('Unsupported api-version. Expected {0}', apiVersion) });
                return;
            }

            // Validate bearer token
            const authHeader = req.headers.authorization ?? '';
            if (authHeader !== `Bearer ${expectedKey}`) {
                sendJson(res, 401, { status: 'error', code: 'unauthorized', message: this.code.l10n.t('Invalid or missing authorization key') });
                return;
            }

            // Parse and validate request body
            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(await text(req)) as Record<string, unknown>;
            } catch {
                sendJson(res, 400, { status: 'error', code: 'bad_request', message: this.code.l10n.t('Invalid JSON body') });
                return;
            }

            const scopes = parsed.scopes;
            if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(s => typeof s !== 'string' || s.length === 0)) {
                sendJson(res, 400, { status: 'error', code: 'bad_request', message: this.code.l10n.t('Missing or empty scopes') });
                return;
            }

            const tenantId = parsed.tenantId;
            if (tenantId !== undefined && typeof tenantId !== 'string') {
                sendJson(res, 400, { status: 'error', code: 'bad_request', message: this.code.l10n.t('Invalid tenant ID') });
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
            const message = e instanceof Error ? e.message : String(e);
            this.output.warn(this.code.l10n.t('[auth] AZD auth server token request failed: {0}', message));
            sendJson(res, 200, { status: 'error', code: 'GetTokenError', message: this.code.l10n.t('Token request failed: {0}', message) });
        }
    }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function listen(server: Server): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
            resolve(addr.port);
        } else {
            reject(new Error('Failed to get server address'));
        }
    });

    return promise;
}

/**
 * Generates a self-signed X.509 certificate and RSA key pair using
 * only Node's built-in `node:crypto` module (no external dependencies).
 *
 * The certificate is valid for 1 year and bound to `127.0.0.1`.
 * RSA key generation uses Node's `crypto.generateKeyPair` to avoid
 * blocking the extension host thread. The X.509 structure is built
 * as raw DER/ASN.1 and signed with `crypto.sign`.
 *
 * @returns PEM-encoded cert and key (for the Node.js HTTPS server),
 *   plus the base64-encoded DER cert (for `AZD_AUTH_CERT`).
 */
async function generateSelfSignedCert(): Promise<{ certPem: string; keyPem: string; certDerBase64: string }> {
    const keyResult = await promisify(cryptoGenerateKeyPair)('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const publicKeyDer = keyResult.publicKey;

    // Ensure the high bit is clear so the serial is a positive ASN.1 integer
    const serialBytes = randomBytes(16);
    serialBytes[0] &= 0x7f;

    const now = new Date();
    const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const issuerAndSubject = derSequence([
        // SET { SEQUENCE { OID commonName, UTF8String "127.0.0.1" } }
        derSet([derSequence([derOid([2, 5, 4, 3]), derUtf8String('127.0.0.1')])]),
    ]);

    // Node.js's OpenSSL requires cA:true and keyCertSign to accept a
    // self-signed cert as a trusted CA (used by the test client's `ca` option).
    // Go's TLS (used by azd) does not, so we only set these during tests.
    const isTest = process.env.VSCODE_RUNNING_TESTS === '1';

    const extensions = derSequence([
        // subjectAltName: IP 127.0.0.1
        derSequence([derOid([2, 5, 29, 17]), derOctetString(derSequence([
            derContextTag(7, Buffer.from([127, 0, 0, 1])),
        ]))]),
        // basicConstraints: cA = isTest
        derSequence([derOid([2, 5, 29, 19]), derBoolean(true), derOctetString(derSequence(
            isTest ? [derBoolean(true)] : [],
        ))]),
        // keyUsage: digitalSignature | keyEncipherment | (keyCertSign if test)
        derSequence([derOid([2, 5, 29, 15]), derBoolean(true), derOctetString(
            derBitString(Buffer.from([isTest ? 0xa4 : 0xa0]), isTest ? 2 : 5),
        )]),
        // extKeyUsage: serverAuth
        derSequence([derOid([2, 5, 29, 37]), derOctetString(derSequence([
            derOid([1, 3, 6, 1, 5, 5, 7, 3, 1]),
        ]))]),
    ]);

    const tbsCertificate = derSequence([
        // version: v3 (explicit tag [0])
        derExplicitTag(0, derInteger(2)),
        // serial number
        derInteger(serialBytes),
        // signature algorithm: sha256WithRSAEncryption
        derSequence([derOid([1, 2, 840, 113549, 1, 1, 11]), derNull()]),
        // issuer
        issuerAndSubject,
        // validity
        derSequence([derUtcTime(now), derUtcTime(notAfter)]),
        // subject
        issuerAndSubject,
        // subjectPublicKeyInfo (raw from Node's SPKI export)
        publicKeyDer,
        // extensions (explicit tag [3])
        derExplicitTag(3, extensions),
    ]);

    // Sign the TBS certificate
    const signature = cryptoSign('sha256', tbsCertificate, keyResult.privateKey);

    // Construct the full certificate
    const certDer = derSequence([
        tbsCertificate,
        // signature algorithm
        derSequence([derOid([1, 2, 840, 113549, 1, 1, 11]), derNull()]),
        // signature value (BIT STRING with 0 unused bits)
        derBitString(signature, 0),
    ]);

    const certDerBase64 = certDer.toString('base64');
    const certPem = certDerToPem(certDerBase64);
    const keyPem = keyResult.privateKey;

    return { certPem, keyPem, certDerBase64 };
}

/**
 * Converts a base64-encoded DER certificate to PEM format.
 *
 * @internal Exported only for tests -- not part of the public API.
 */
export function certDerToPem(base64Der: string): string {
    const wrapped = base64Der.match(/.{1,64}/g)!.join('\n'); // eslint-disable-line @typescript-eslint/no-non-null-assertion -- base64 is never empty
    return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
}

// ---------------------------------------------------------------------------
// Minimal DER / ASN.1 encoding helpers
// ---------------------------------------------------------------------------

/** Encode a DER tag + length + value. */
function derTlv(tag: number, value: Buffer): Buffer {
    const length = value.length;
    let header: Buffer;
    if (length < 0x80) {
        header = Buffer.from([tag, length]);
    } else if (length < 0x100) {
        header = Buffer.from([tag, 0x81, length]);
    } else if (length < 0x10000) {
        header = Buffer.from([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
    } else {
        header = Buffer.from([tag, 0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    }
    return Buffer.concat([header, value]);
}

function derSequence(items: Buffer[]): Buffer {
    return derTlv(0x30, Buffer.concat(items));
}

function derSet(items: Buffer[]): Buffer {
    return derTlv(0x31, Buffer.concat(items));
}

function derInteger(value: number | Buffer): Buffer {
    if (typeof value === 'number') {
        if (value < 0x80) {
            return derTlv(0x02, Buffer.from([value]));
        }
        const bytes: number[] = [];
        let v = value;
        while (v > 0) {
            bytes.unshift(v & 0xff);
            v >>= 8;
        }
        if (bytes[0] & 0x80) {
            bytes.unshift(0);
        }
        return derTlv(0x02, Buffer.from(bytes));
    }
    // Buffer: canonicalize per DER rules.
    // 1. Strip unnecessary leading 0x00 bytes (a leading 0x00 is only legal
    //    when the next byte has its high bit set, to keep the value positive).
    // 2. If the high bit of the remaining first byte is set, prepend 0x00
    //    so the value is interpreted as positive.
    let buf = value;
    while (buf.length > 1 && buf[0] === 0 && (buf[1] & 0x80) === 0) {
        buf = buf.subarray(1);
    }
    if (buf[0] & 0x80) {
        buf = Buffer.concat([Buffer.from([0]), buf]);
    }
    return derTlv(0x02, buf);
}

function derBitString(data: Buffer, unusedBits: number): Buffer {
    return derTlv(0x03, Buffer.concat([Buffer.from([unusedBits]), data]));
}

function derOctetString(data: Buffer): Buffer {
    return derTlv(0x04, data);
}

function derNull(): Buffer {
    return Buffer.from([0x05, 0x00]);
}

function derBoolean(value: boolean): Buffer {
    return derTlv(0x01, Buffer.from([value ? 0xff : 0x00]));
}

function derOid(components: number[]): Buffer {
    const bytes: number[] = [40 * components[0] + components[1]];
    for (let i = 2; i < components.length; i++) {
        let c = components[i];
        if (c < 128) {
            bytes.push(c);
        } else {
            const encoded: number[] = [];
            encoded.push(c & 0x7f);
            c >>= 7;
            while (c > 0) {
                encoded.push((c & 0x7f) | 0x80);
                c >>= 7;
            }
            bytes.push(...encoded.reverse());
        }
    }
    return derTlv(0x06, Buffer.from(bytes));
}

function derUtf8String(value: string): Buffer {
    return derTlv(0x0c, Buffer.from(value, 'utf8'));
}

function derUtcTime(date: Date): Buffer {
    const s = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
    return derTlv(0x17, Buffer.from(s, 'ascii'));
}

function derExplicitTag(tagNumber: number, value: Buffer): Buffer {
    return derTlv(0xa0 | tagNumber, value);
}

function derContextTag(tagNumber: number, value: Buffer): Buffer {
    return derTlv(0x80 | tagNumber, value);
}
