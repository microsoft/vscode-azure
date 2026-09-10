/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDefaultCredentialFactory } from '@microsoft/vscode-azure-azutils';
import { makeCredential } from '@microsoft/vscode-azure-azutils/testing';
import { Disposable } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockOutputChannel, waitFor } from '@microsoft/vscode-azure-utils/testing';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { dirname } from 'node:path';
import { mock } from 'node:test';
import { AzdAuthApiVersion, AzdAuthServer } from '../../src/azd/AzdAuthServer';

interface TokenResponse {
    status: string;
    token?: string;
    expiresOn?: string;
    code?: string;
    message?: string;
}

function requireResponseBody(result: { body: TokenResponse | undefined }): TokenResponse {
    if (!result.body) {
        throw new Error('Expected a response body');
    }

    return result.body;
}

function postJson(
    endpoint: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    agent?: Agent,
): Promise<{ statusCode: number; body: TokenResponse | undefined }> {
    return sendRequest('POST', endpoint, path, JSON.stringify(body), headers, agent);
}

function postRaw(
    endpoint: string,
    path: string,
    rawBody: string,
    headers: Record<string, string>,
): Promise<{ statusCode: number; body: TokenResponse | undefined }> {
    return sendRequest('POST', endpoint, path, rawBody, headers);
}

function sendRequest(
    method: string,
    endpoint: string,
    path: string,
    rawBody: string,
    headers: Record<string, string>,
    agent?: Agent,
): Promise<{ statusCode: number; body: TokenResponse | undefined }> {
    // Inverse of the `unix://` / `npipe://` URLs returned by
    // `AzdAuthServer.getEnv()`, back to the OS-level socket path that
    // Node's `http.request({ socketPath })` accepts.
    let socketPath: string;
    if (endpoint.startsWith('unix://')) {
        socketPath = endpoint.slice('unix://'.length);
    } else if (endpoint.startsWith('npipe://')) {
        // npipe://./pipe/<name> -> \\.\pipe\<name>
        socketPath = `\\\\${endpoint.slice('npipe://'.length).replace(/\//g, '\\')}`;
    } else {
        throw new Error(`Unsupported endpoint scheme: ${endpoint}`);
    }

    return new Promise((resolve, reject) => {
        const req = httpRequest({
            socketPath,
            path,
            method,
            agent,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(rawBody),
                ...headers,
            },
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => { chunks.push(c); });
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve({
                    statusCode: res.statusCode ?? 0,
                    body: raw.length > 0 ? JSON.parse(raw) as TokenResponse : undefined,
                });
            });
        });
        req.on('error', reject);
        if (rawBody.length > 0) {
            req.write(rawBody);
        }
        req.end();
    });
}

describe('AzdAuthServer (unit)', () => {
    describe('getEnv', () => {
        const servers: AzdAuthServer[] = [];

        afterEach(() => {
            Disposable.disposeAll(servers);
            servers.length = 0;
        });

        it('should return env vars with endpoint and key', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);
            const env = await server.getEnv();

            const expectedSchemePattern = process.platform === 'win32'
                ? /^npipe:\/\/\.\/pipe\/[0-9a-f-]+$/
                : /^unix:\/\/\/.+\/s\.sock$/;
            expect(env.AZD_AUTH_ENDPOINT).to.match(expectedSchemePattern);
            expect(env.AZD_AUTH_KEY).to.be.a('string').with.length.greaterThan(0);
        });

        it('should return the same env vars on subsequent calls', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);
            const env1 = await server.getEnv();
            const env2 = await server.getEnv();

            expect(env1.AZD_AUTH_ENDPOINT).to.equal(env2.AZD_AUTH_ENDPOINT);
            expect(env1.AZD_AUTH_KEY).to.equal(env2.AZD_AUTH_KEY);
        });

        it('should restrict the Unix socket to the current user', async function () {
            if (process.platform === 'win32') {
                this.skip();
            }

            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);
            const env = await server.getEnv();
            const socketPath = env.AZD_AUTH_ENDPOINT.slice('unix://'.length);

            const socketStat = await stat(socketPath);
            expect(socketStat.mode & 0o777).to.equal(0o600);
        });

        it('should clear an inherited certificate that would contradict the socket endpoint', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);

            const env = await server.getEnv();

            // azd requires an https endpoint whenever a certificate is set, so a
            // stale value inherited from the host environment would hard-fail.
            expect(env.AZD_AUTH_CERT).to.equal('');
        });

        it('should retry after a failed start rather than caching the failure', async () => {
            const { vscode: code } = createMockVsCode();
            let attempts = 0;
            const factory = mock.fn(() => {
                attempts++;
                if (attempts === 1) {
                    throw new Error('credential factory unavailable');
                }

                return makeCredential();
            });
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), factory);
            servers.push(server);

            await expect(server.getEnv()).to.be.rejectedWith('credential factory unavailable');

            const env = await server.getEnv();
            expect(env.AZD_AUTH_ENDPOINT).to.be.a('string').with.length.greaterThan(0);
        });
    });

    describe('dispose', () => {
        it('should reject requests that arrive after disposal', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), () => makeCredential());
            const env = await server.getEnv();
            const agent = new Agent({ keepAlive: true });

            try {
                server.dispose();

                await expect(postJson(
                    env.AZD_AUTH_ENDPOINT,
                    `/token?api-version=${AzdAuthApiVersion}`,
                    { scopes: ['https://management.azure.com/.default'] },
                    { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                    agent,
                )).to.be.rejected;
            } finally {
                agent.destroy();
            }
        });

        it('should remove the socket directory even while a client holds a connection open', async function () {
            if (process.platform === 'win32') {
                this.skip();
            }

            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), () => makeCredential());
            const env = await server.getEnv();
            const socketDir = dirname(env.AZD_AUTH_ENDPOINT.slice('unix://'.length));
            // A keep-alive agent holds the connection after the response, which
            // is what azd's HTTP client does.
            const agent = new Agent({ keepAlive: true });

            try {
                const result = await postJson(
                    env.AZD_AUTH_ENDPOINT,
                    `/token?api-version=${AzdAuthApiVersion}`,
                    { scopes: ['https://management.azure.com/.default'] },
                    { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                    agent,
                );
                expect(result.statusCode).to.equal(200);

                server.dispose();

                await waitFor(() => !existsSync(socketDir), 'the socket directory to be removed');
            } finally {
                agent.destroy();
            }
        });

        it('should reject getEnv after disposal', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), () => makeCredential());
            await server.getEnv();

            server.dispose();

            await expect(server.getEnv()).to.be.rejectedWith(/disposed/);
        });
    });

    describe('token endpoint', () => {
        // All token endpoint tests share a single server instance.
        let server: AzdAuthServer;
        let env: Readonly<Record<string, string>>;
        let getToken: ReturnType<typeof mock.fn>;

        /** Shorthand for a valid POST to `/token` with the shared server's key. */
        function tokenPost(body: unknown) {
            return postJson(
                env.AZD_AUTH_ENDPOINT,
                `/token?api-version=${AzdAuthApiVersion}`,
                body,
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
            );
        }

        before(async () => {
            const { vscode: code } = createMockVsCode();
            const credential = makeCredential();
            // eslint-disable-next-line @typescript-eslint/unbound-method -- mock.fn is a standalone function with no `this` binding
            getToken = credential.getToken as unknown as ReturnType<typeof mock.fn>;

            server = new AzdAuthServer(code, new MockOutputChannel('test'), () => credential);
            env = await server.getEnv();
        });

        after(() => {
            server.dispose();
        });

        afterEach(() => {
            getToken.mock.resetCalls();
            getToken.mock.restore();
        });

        it('should return a token on valid request', async () => {
            getToken.mock.mockImplementation(() => Promise.resolve({
                token: 'test-access-token',
                expiresOnTimestamp: Date.now() + 3600000,
            }));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            const body = requireResponseBody(result);
            expect(body.status).to.equal('success');
            expect(body.token).to.equal('test-access-token');
            expect(body.expiresOn).to.be.a('string');
        });

        it('should return NotSignedInError when no session is available', async () => {
            getToken.mock.mockImplementation(() => Promise.resolve(null));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            const body = requireResponseBody(result);
            expect(body.status).to.equal('error');
            expect(body.code).to.equal('NotSignedInError');
        });

        it('should reject requests with wrong key', async () => {
            const result = await postJson(
                env.AZD_AUTH_ENDPOINT,
                `/token?api-version=${AzdAuthApiVersion}`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: 'Bearer wrong-key' },
            );

            expect(result.statusCode).to.equal(401);
            expect(result.body).to.be.undefined;
        });

        it('should reject requests with wrong api-version', async () => {
            const result = await postJson(
                env.AZD_AUTH_ENDPOINT,
                '/token?api-version=1999-01-01',
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject requests with missing scopes', async () => {
            const result = await tokenPost({ tenantId: 'some-tenant' });

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject requests to wrong path', async () => {
            const result = await postJson(
                env.AZD_AUTH_ENDPOINT,
                `/other?api-version=${AzdAuthApiVersion}`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
            );

            expect(result.statusCode).to.equal(404);
        });

        it('should pass tenantId to the credential', async () => {
            getToken.mock.mockImplementation(() => Promise.resolve({
                token: 'tenant-token',
                expiresOnTimestamp: Date.now() + 3600000,
            }));

            const result = await tokenPost({
                scopes: ['https://management.azure.com/.default'],
                tenantId: 'my-tenant',
            });

            expect(result.statusCode).to.equal(200);
            const body = requireResponseBody(result);
            expect(body.status).to.equal('success');
            expect(body.token).to.equal('tenant-token');

            const callArgs = getToken.mock.calls[0].arguments as [string[], { tenantId?: string }];
            expect(callArgs[0]).to.deep.equal(['https://management.azure.com/.default']);
            expect(callArgs[1]).to.deep.equal({ tenantId: 'my-tenant' });
        });

        it('should reject non-POST requests', async () => {
            const result = await sendRequest(
                'GET',
                env.AZD_AUTH_ENDPOINT,
                `/token?api-version=${AzdAuthApiVersion}`,
                '',
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
            );

            expect(result.statusCode).to.equal(405);
            expect(result.body).to.be.undefined;
        });

        it('should reject empty scopes array', async () => {
            const result = await tokenPost({ scopes: [] });

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject non-string values in scopes array', async () => {
            const result = await tokenPost({ scopes: [123, 'valid'] });

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject empty strings in scopes array', async () => {
            const result = await tokenPost({ scopes: [''] });

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject non-string tenantId', async () => {
            const result = await tokenPost({
                scopes: ['https://management.azure.com/.default'],
                tenantId: 123,
            });

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should reject invalid JSON body', async () => {
            const result = await postRaw(
                env.AZD_AUTH_ENDPOINT,
                `/token?api-version=${AzdAuthApiVersion}`,
                'not json{{{',
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body).to.be.undefined;
        });

        it('should return GetTokenError when credential throws', async () => {
            getToken.mock.mockImplementation(() => Promise.reject(new Error('auth provider exploded')));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            const body = requireResponseBody(result);
            expect(body.status).to.equal('error');
            expect(body.code).to.equal('GetTokenError');
        });
    });
});
