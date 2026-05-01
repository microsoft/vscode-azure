/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { afterEach, describe, it } from 'mocha';
import { request as httpsRequest } from 'node:https';
import { mock } from 'node:test';
import { AzdAuthServer } from '../../azd/AzdAuthServer';

interface TokenResponse {
    status: string;
    token?: string;
    expiresOn?: string;
    code?: string;
    message?: string;
}

/**
 * Converts a base64-encoded DER cert (as produced by `AZD_AUTH_CERT`)
 * back to PEM format so Node.js TLS can use it as a trusted CA.
 */
function certToPem(base64Der: string): string {
    const wrapped = base64Der.replace(/(.{64})/g, '$1\n').trimEnd();
    return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
}

function post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    certBase64Der: string,
): Promise<{ statusCode: number; body: TokenResponse }> {
    const json = JSON.stringify(body);
    const parsed = new URL(url);

    return new Promise((resolve, reject) => {
        const req = httpsRequest({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(json),
                ...headers,
            },
            ca: certToPem(certBase64Der),
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
        req.write(json);
        req.end();
    });
}

interface MockSession {
    accessToken: string;
    id: string;
    scopes: string[];
    account: { id: string; label: string };
}

describe('AzdAuthServer (unit)', () => {
    const servers: AzdAuthServer[] = [];

    function createAuthServer(sessionResult?: MockSession) {
        const mockResult = createMockVsCode();

        const getSession = mockResult.authentication.getSession as unknown as ReturnType<typeof mock.fn>;
        getSession.mock.mockImplementation(() => {
            if (!sessionResult) {
                return Promise.resolve(undefined);
            }
            return Promise.resolve({ ...sessionResult, idToken: undefined });
        });

        const output = new MockOutputChannel('test');
        const server = new AzdAuthServer(mockResult.vscode, output);
        servers.push(server);
        return { server, mockResult };
    }

    afterEach(() => {
        for (const s of servers) {
            s.dispose();
        }
        servers.length = 0;
    });

    describe('getEnv', () => {
        it('should return env vars with endpoint, key, and cert', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            expect(env.AZD_AUTH_ENDPOINT).to.match(/^https:\/\/127\.0\.0\.1:\d+$/);
            expect(env.AZD_AUTH_KEY).to.be.a('string').with.length.greaterThan(0);
            expect(env.AZD_AUTH_CERT).to.be.a('string').with.length.greaterThan(0);
        });

        it('should return the same env vars on subsequent calls', async () => {
            const { server } = createAuthServer();
            const env1 = await server.getEnv();
            const env2 = await server.getEnv();

            expect(env1.AZD_AUTH_ENDPOINT).to.equal(env2.AZD_AUTH_ENDPOINT);
            expect(env1.AZD_AUTH_KEY).to.equal(env2.AZD_AUTH_KEY);
            expect(env1.AZD_AUTH_CERT).to.equal(env2.AZD_AUTH_CERT);
        });
    });

    describe('token endpoint', () => {
        it('should return a token on valid request', async () => {
            const { server } = createAuthServer({
                accessToken: 'test-access-token',
                id: 'session-1',
                scopes: ['https://management.azure.com/.default'],
                account: { id: 'user-1', label: 'test@example.com' },
            });
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(200);
            expect(result.body.status).to.equal('success');
            expect(result.body.token).to.equal('test-access-token');
            expect(result.body.expiresOn).to.be.a('string');
        });

        it('should return NotSignedInError when no session is available', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(200);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('NotSignedInError');
        });

        it('should reject requests with wrong key', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: 'Bearer wrong-key' },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(401);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('unauthorized');
        });

        it('should reject requests with wrong api-version', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=1999-01-01`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject requests with missing scopes', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { tenantId: 'some-tenant' },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(400);
            expect(result.body.status).to.equal('error');
            expect(result.body.code).to.equal('bad_request');
        });

        it('should reject requests to wrong path', async () => {
            const { server } = createAuthServer();
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/other?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'] },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(404);
        });

        it('should pass tenantId to the credential', async () => {
            const { server, mockResult } = createAuthServer({
                accessToken: 'tenant-token',
                id: 'session-2',
                scopes: ['https://management.azure.com/.default'],
                account: { id: 'user-1', label: 'test@example.com' },
            });
            const env = await server.getEnv();

            const result = await post(
                `${env.AZD_AUTH_ENDPOINT}/token?api-version=2023-07-12-preview`,
                { scopes: ['https://management.azure.com/.default'], tenantId: 'my-tenant' },
                { Authorization: `Bearer ${env.AZD_AUTH_KEY}` },
                env.AZD_AUTH_CERT,
            );

            expect(result.statusCode).to.equal(200);
            expect(result.body.status).to.equal('success');
            expect(result.body.token).to.equal('tenant-token');

            const getSession = mockResult.authentication.getSession as unknown as ReturnType<typeof mock.fn>;
            const callArgs = getSession.mock.calls[0].arguments as [string, string[]];
            const scopes = callArgs[1];
            expect(scopes).to.include('VSCODE_TENANT:my-tenant');
        });
    });
});
