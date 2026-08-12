/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDefaultCredentialFactory } from '@microsoft/vscode-azure-azutils';
import { makeCredential } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { request as httpsRequest } from 'node:https';
import { mock } from 'node:test';
import { AzdAuthServer, certDerToPem } from '../../src/azd/AzdAuthServer';

interface TokenResponse {
    status: string;
    token?: string;
    expiresOn?: string;
    code?: string;
    message?: string;
}

function postJson(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    certBase64Der: string,
): Promise<{ statusCode: number; body: TokenResponse }> {
    return sendRequest('POST', url, JSON.stringify(body), headers, certBase64Der);
}

function postRaw(
    url: string,
    rawBody: string,
    headers: Record<string, string>,
    certBase64Der: string,
): Promise<{ statusCode: number; body: TokenResponse }> {
    return sendRequest('POST', url, rawBody, headers, certBase64Der);
}

function sendRequest(
    method: string,
    url: string,
    rawBody: string,
    headers: Record<string, string>,
    certBase64Der: string,
): Promise<{ statusCode: number; body: TokenResponse }> {
    const parsed = new URL(url);

    return new Promise((resolve, reject) => {
        const req = httpsRequest({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(rawBody),
                ...headers,
            },
            ca: certDerToPem(certBase64Der),
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => { chunks.push(c); });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode ?? 0,
                    body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as TokenResponse,
                });
            });
        });
        req.on('error', reject);
        req.write(rawBody);
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

        it('should return env vars with endpoint, key, and cert', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);
            const env = await server.getEnv();

            expect(env.AZD_AUTH_ENDPOINT).to.match(/^https:\/\/127\.0\.0\.1:\d+$/);
            expect(env.AZD_AUTH_KEY).to.be.a('string').with.length.greaterThan(0);
            expect(env.AZD_AUTH_CERT).to.be.a('string').with.length.greaterThan(0);
        });

        it('should return the same env vars on subsequent calls', async () => {
            const { vscode: code } = createMockVsCode();
            const server = new AzdAuthServer(code, new MockOutputChannel('test'), createDefaultCredentialFactory(code));
            servers.push(server);
            const env1 = await server.getEnv();
            const env2 = await server.getEnv();

            expect(env1.AZD_AUTH_ENDPOINT).to.equal(env2.AZD_AUTH_ENDPOINT);
            expect(env1.AZD_AUTH_KEY).to.equal(env2.AZD_AUTH_KEY);
            expect(env1.AZD_AUTH_CERT).to.equal(env2.AZD_AUTH_CERT);
        });
    });

    describe('token endpoint', () => {
        // All token endpoint tests share a single server instance to avoid
        // repeatedly generating certs and keys.
        let server: AzdAuthServer;
        let env: Readonly<Record<string, string>>;
        let getToken: ReturnType<typeof mock.fn>;

        /** Shorthand for a valid POST to `/token` with the shared server's key. */
        function tokenPost(body: unknown) {
            return postJson(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                body,
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
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
            expect(result.body.status).to.equal('success');
            expect(result.body.token).to.equal('test-access-token');
            expect(result.body.expiresOn).to.be.a('string');
        });

        it('should return NotSignedInError when no session is available', async () => {
            getToken.mock.mockImplementation(() => Promise.resolve(null));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('NotSignedInError');
        });

        it('should reject requests with wrong key', async () => {
            const result = await postJson(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: 'Bearer wrong-key' },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(401);
            expect(result.body.code).to.equal('unauthorized');
        });

        it('should reject requests with wrong api-version', async () => {
            const result = await postJson(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=1999-01-01`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject requests with missing scopes', async () => {
            const result = await tokenPost({ tenantId: 'some-tenant' });

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject requests to wrong path', async () => {
            const result = await postJson(
                `${env.AZD_AUTH_ENDPOINT}/other?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
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
            expect(result.body.token).to.equal('tenant-token');

            const callArgs = getToken.mock.calls[0].arguments as [string[], { tenantId?: string }];
            expect(callArgs[0]).to.deep.equal(['https://management.azure.com/.default']);
            expect(callArgs[1]).to.deep.equal({ tenantId: 'my-tenant' });
        });

        it('should reject non-POST requests', async () => {
            const result = await sendRequest(
                'GET',
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                '',
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(405);
            expect(result.body.code).to.equal('method_not_allowed');
        });

        it('should reject empty scopes array', async () => {
            const result = await tokenPost({ scopes: [] });

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject non-string values in scopes array', async () => {
            const result = await tokenPost({ scopes: [123, 'valid'] });

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject empty strings in scopes array', async () => {
            const result = await tokenPost({ scopes: [''] });

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject non-string tenantId', async () => {
            const result = await tokenPost({
                scopes: ['https://management.azure.com/.default'],
                tenantId: 123,
            });

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject invalid JSON body', async () => {
            const result = await postRaw(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                'not json{{{',
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body.code).to.equal('bad_request');
        });

        it('should return GetTokenError when credential throws', async () => {
            getToken.mock.mockImplementation(() => Promise.reject(new Error('auth provider exploded')));

            const result = await tokenPost({ scopes: ['https://management.azure.com/.default'] });

            expect(result.statusCode).to.equal(200);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('GetTokenError');
        });
    });
});
