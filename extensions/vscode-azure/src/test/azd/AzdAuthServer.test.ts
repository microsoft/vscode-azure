/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { after, afterEach, before, describe, it } from 'mocha';
import { request as httpRequest } from 'node:http';
import { mock } from 'node:test';
import { AzdAuthApiVersion, type AzdAuthEnv, AzdAuthServer, type TokenErrorResponse, type TokenResponse, type TokenSuccessResponse } from '../../azd/AzdAuthServer';

/** Asserts and narrows {@linkcode TokenResponse} to its success variant. */
function assertSuccess(body: TokenResponse | undefined): asserts body is TokenSuccessResponse {
    expect(body, 'expected a response body').to.not.be.undefined;
    expect(body!.status).to.equal('success');
}

/** Asserts and narrows {@linkcode TokenResponse} to its error variant. */
function assertError(body: TokenResponse | undefined): asserts body is TokenErrorResponse {
    expect(body, 'expected a response body').to.not.be.undefined;
    expect(body!.status).to.equal('error');
}

function postJson(
    endpoint: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
): Promise<{ statusCode: number; body: TokenResponse | undefined }> {
    return sendRequest('POST', endpoint, path, JSON.stringify(body), headers);
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
            for (const s of servers) {
                s.dispose();
            }
            servers.length = 0;
        });

        it('should return env vars with endpoint and key', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'));
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
            const server = new AzdAuthServer(code, new MockOutputChannel('test'));
            servers.push(server);
            const env1 = await server.getEnv();
            const env2 = await server.getEnv();

            expect(env1.AZD_AUTH_ENDPOINT).to.equal(env2.AZD_AUTH_ENDPOINT);
            expect(env1.AZD_AUTH_KEY).to.equal(env2.AZD_AUTH_KEY);
        });

        it('should throw if called after dispose', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'));
            await server.getEnv();
            server.dispose();

            let caught: unknown;
            try {
                await server.getEnv();
            } catch (e) {
                caught = e;
            }
            expect(caught).to.be.instanceOf(Error);
            expect((caught as Error).message).to.match(/disposed/i);
        });
    });

    describe('token endpoint', () => {
        // All token endpoint tests share a single server instance.
        let server: AzdAuthServer;
        let env: AzdAuthEnv;
        let getSession: ReturnType<typeof mock.fn>;

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
            const mockResult = createMockVsCode();
            getSession = mockResult.authentication.getSession as unknown as ReturnType<typeof mock.fn>;

            server = new AzdAuthServer(mockResult.vscode, new MockOutputChannel('test'));
            env = await server.getEnv();
        });

        after(() => {
            server.dispose();
        });

        afterEach(() => {
            getSession.mock.resetCalls();
            getSession.mock.restore();
        });

        it('should return a token on valid request', async () => {
            getSession.mock.mockImplementation(() => Promise.resolve({
                accessToken: 'test-access-token',
                id: 'session-1',
                scopes: ['https://management.azure.com/.default'],
                account: { id: 'user-1', label: 'test@example.com' },
            }));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            assertSuccess(result.body);
            expect(result.body.token).to.equal('test-access-token');
            expect(result.body.expiresOn).to.be.a('string');
        });

        it('should return NotSignedInError when no session is available', async () => {
            getSession.mock.mockImplementation(() => Promise.resolve(undefined));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            assertError(result.body);
            expect(result.body.code).to.equal('NotSignedInError');
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
            getSession.mock.mockImplementation(() => Promise.resolve({
                accessToken: 'tenant-token',
                id: 'session-2',
                scopes: ['https://management.azure.com/.default'],
                account: { id: 'user-1', label: 'test@example.com' },
            }));

            const result = await tokenPost({
                scopes: ['https://management.azure.com/.default'],
                tenantId: 'my-tenant',
            });

            expect(result.statusCode).to.equal(200);
            assertSuccess(result.body);
            expect(result.body.token).to.equal('tenant-token');

            const callArgs = getSession.mock.calls[0].arguments as [string, string[]];
            expect(callArgs[1]).to.include('VSCODE_TENANT:my-tenant');
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
            getSession.mock.mockImplementation(() => Promise.reject(new Error('auth provider exploded')));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            assertError(result.body);
            expect(result.body.code).to.equal('GetTokenError');
        });
    });
});
