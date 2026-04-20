/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment } from '@azure/ms-rest-azure-env';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import { VsCodeExtensionCredential } from '../../auth/VsCodeExtensionCredential';

function createCredential(options?: { tenantId?: string; environment?: Environment }) {
    const { vscode: code } = createMockVsCode();
    const getSession = code.authentication.getSession as Mock<typeof code.authentication.getSession>;
    const credential = new VsCodeExtensionCredential({ authentication: code.authentication, ...options });
    return { credential, getSession };
}

describe('VsCodeExtensionCredential (unit)', () => {
    describe('getToken', () => {
        it('should use the "microsoft" provider for the default (public) cloud', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('https://management.azure.com/.default');

            expect(getSession.mock.callCount()).to.equal(1);
            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft');
        });

        it('should use the "microsoft-sovereign-cloud" provider for non-default environments', async () => {
            const { credential, getSession } = createCredential({ environment: Environment.ChinaCloud });
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('https://management.chinacloudapi.cn/.default');

            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft-sovereign-cloud');
        });

        it('should use "microsoft" provider when environment is explicitly Azure public cloud', async () => {
            const { credential, getSession } = createCredential({ environment: Environment.AzureCloud });
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('scope1');

            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft');
        });

        it('should pass scopes as an array (single scope)', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('scope1');

            const scopes = getSession.mock.calls[0].arguments[1] as string[];
            expect(scopes).to.deep.equal(['scope1']);
        });

        it('should pass scopes as an array (multiple scopes)', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken(['scope1', 'scope2']);

            const scopes = getSession.mock.calls[0].arguments[1] as string[];
            expect(scopes).to.deep.equal(['scope1', 'scope2']);
        });

        it('should add VSCODE_TENANT scope when tenantId is set in options', async () => {
            const { credential, getSession } = createCredential({ tenantId: 'my-tenant' });
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('scope1');

            const scopes = getSession.mock.calls[0].arguments[1] as string[];
            expect(scopes).to.include('VSCODE_TENANT:my-tenant');
        });

        it('should add VSCODE_TENANT scope from GetTokenOptions.tenantId over constructor tenantId', async () => {
            const { credential, getSession } = createCredential({ tenantId: 'default-tenant' });
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('scope1', { tenantId: 'override-tenant' });

            const scopes = getSession.mock.calls[0].arguments[1] as string[];
            expect(scopes).to.include('VSCODE_TENANT:override-tenant');
        });

        it('should return null if getSession returns undefined', async () => {
            const { credential } = createCredential();
            // Default mock returns undefined

            const result = await credential.getToken('scope1');

            expect(result).to.be.null;
        });

        it('should return an AccessToken when session is available', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'my-token-value' } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.token).to.equal('my-token-value');
            expect(result!.tokenType).to.equal('Bearer');
            expect(result!.expiresOnTimestamp).to.equal(0);
        });

        it('should extract expiresOnTimestamp from idToken exp claim', async () => {
            const { credential, getSession } = createCredential();
            const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const idToken = `header.${payload}.signature`;
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
        });

        it('should set refreshAfterTimestamp to 2/3 of remaining lifetime', async () => {
            const { credential, getSession } = createCredential();
            const now = Date.now();
            const exp = Math.floor(now / 1000) + 3600;
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const idToken = `header.${payload}.signature`;
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            const remaining = exp * 1000 - now;
            const expectedRefresh = now + Math.floor(remaining * 2 / 3);
            expect(result!.refreshAfterTimestamp).to.be.closeTo(expectedRefresh, 1000);
        });

        it('should fall back to 0 when idToken is undefined', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should fall back to 0 when idToken is malformed', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken: 'not-a-jwt' } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should fall back to 0 when idToken payload has no exp claim', async () => {
            const { credential, getSession } = createCredential();
            const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64');
            const idToken = `header.${payload}.signature`;
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should handle an already-expired token by setting refreshAfterTimestamp to expiresOnTimestamp', async () => {
            const { credential, getSession } = createCredential();
            const exp = Math.floor(Date.now() / 1000) - 60; // expired 1 minute ago
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const idToken = `header.${payload}.signature`;
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
            expect(result!.refreshAfterTimestamp).to.equal(exp * 1000);
        });

        it('should decode base64url-encoded idToken payloads', async () => {
            const { credential, getSession } = createCredential();
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const json = JSON.stringify({ exp });
            // Encode using base64url: replace + with -, / with _, strip padding
            const payload = Buffer.from(json).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const idToken = `header.${payload}.signature`;
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok', idToken } as never));

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
        });

        it('should not add tenant scope when no tenantId is provided anywhere', async () => {
            const { credential, getSession } = createCredential();
            getSession.mock.mockImplementation(() => Promise.resolve({ accessToken: 'tok' } as never));

            await credential.getToken('scope1');

            const scopes = getSession.mock.calls[0].arguments[1] as string[];
            const hasTenantScope = scopes.some(s => s.startsWith('VSCODE_TENANT:'));
            expect(hasTenantScope).to.be.false;
        });
    });
});
