/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type * as vscode from 'vscode';
import { VsCodeExtensionCredential } from '../../auth/VsCodeExtensionCredential';

interface CreateCredentialOptions {
    readonly tenantId?: string;
    readonly cloud?: 'public' | 'china';
    readonly sessionOptions?: vscode.AuthenticationGetSessionOptions;
    /**
     * The session `getSession` should resolve to. Defaults to a minimal session
     * with an access token. Pass `null` to simulate no available session.
     */
    readonly session?: Record<string, unknown> | null;
}

function createCredential(options?: CreateCredentialOptions) {
    const mock = createMockVsCode();
    if (options?.cloud === 'china') {
        mock.settings.set('microsoft-sovereign-cloud.environment', 'ChinaCloud');
    }
    const credential = new VsCodeExtensionCredential({ code: mock.vscode, tenantId: options?.tenantId, sessionOptions: options?.sessionOptions });

    const getSession = mock.authentication.getSession;
    const session = options?.session === undefined ? { accessToken: 'tok' } : options.session;
    if (session !== null) {
        getSession.mock.mockImplementation(() => Promise.resolve(session as never));
    }

    return { credential, getSession, mock };
}

/**
 * Build a fake JWT `idToken` (`header.payload.signature`) whose payload encodes
 * the given claims. Set `base64url` to exercise base64url (rather than base64)
 * payload decoding.
 */
function makeIdToken(claims: Record<string, unknown>, base64url = false): string {
    let payload = Buffer.from(JSON.stringify(claims)).toString('base64');
    if (base64url) {
        payload = payload.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return `header.${payload}.signature`;
}

/** Read the scopes argument passed to the most recent `getSession` call. */
function lastScopes(getSession: ReturnType<typeof createCredential>['getSession']): string[] {
    return getSession.mock.calls[0].arguments[1] as string[];
}

/** Read the session-options argument passed to the most recent `getSession` call. */
function lastSessionOptions(getSession: ReturnType<typeof createCredential>['getSession']): vscode.AuthenticationGetSessionOptions {
    return getSession.mock.calls[0].arguments[2]!;
}

describe('VsCodeExtensionCredential (unit)', () => {
    describe('getToken', () => {
        it('should use the "microsoft" provider for the default (public) cloud', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken('https://management.azure.com/.default');

            expect(getSession.mock.callCount()).to.equal(1);
            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft');
        });

        it('should use the "microsoft-sovereign-cloud" provider for non-default environments', async () => {
            const { credential, getSession } = createCredential({ cloud: 'china' });

            await credential.getToken('https://management.chinacloudapi.cn/.default');

            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft-sovereign-cloud');
        });

        it('should use "microsoft" provider when no sovereign cloud is configured', async () => {
            const { credential, getSession } = createCredential({ cloud: 'public' });

            await credential.getToken('scope1');

            expect(getSession.mock.calls[0].arguments[0]).to.equal('microsoft');
        });

        it('should pass scopes as an array (single scope)', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken('scope1');

            expect(lastScopes(getSession)).to.deep.equal(['scope1/.default']);
        });

        it('should pass scopes as an array (multiple scopes)', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken(['scope1', 'scope2']);

            expect(lastScopes(getSession)).to.deep.equal(['scope1/.default', 'scope2/.default']);
        });

        it('should add VSCODE_TENANT scope when tenantId is set in options', async () => {
            const { credential, getSession } = createCredential({ tenantId: 'my-tenant' });

            await credential.getToken('scope1');

            expect(lastScopes(getSession)).to.include('VSCODE_TENANT:my-tenant');
        });

        it('should add VSCODE_TENANT scope from GetTokenOptions.tenantId over constructor tenantId', async () => {
            const { credential, getSession } = createCredential({ tenantId: 'default-tenant' });

            await credential.getToken('scope1', { tenantId: 'override-tenant' });

            expect(lastScopes(getSession)).to.include('VSCODE_TENANT:override-tenant');
        });

        it('should return null if getSession returns undefined', async () => {
            const { credential } = createCredential({ session: null });

            const result = await credential.getToken('scope1');

            expect(result).to.be.null;
        });

        it('should default to createIfNone when no session options are provided', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken('scope1');

            expect(lastSessionOptions(getSession).createIfNone).to.equal(true);
        });

        it('should not set createIfNone when the caller requests silent acquisition', async () => {
            const { credential, getSession } = createCredential({ sessionOptions: { silent: true } });

            await credential.getToken('scope1');

            const sessionOptions = lastSessionOptions(getSession);
            expect(sessionOptions.silent).to.equal(true);
            expect(sessionOptions.createIfNone).to.equal(undefined);
        });

        it('should let an explicit createIfNone:false override the default', async () => {
            const { credential, getSession } = createCredential({ sessionOptions: { createIfNone: false } });

            await credential.getToken('scope1');

            expect(lastSessionOptions(getSession).createIfNone).to.equal(false);
        });

        it('should return an AccessToken when session is available', async () => {
            const { credential } = createCredential({ session: { accessToken: 'my-token-value' } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.token).to.equal('my-token-value');
            expect(result!.tokenType).to.equal('Bearer');
            expect(result!.expiresOnTimestamp).to.equal(0);
        });

        it('should extract expiresOnTimestamp from idToken exp claim', async () => {
            const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: makeIdToken({ exp }) } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
        });

        it('should set refreshAfterTimestamp to 2/3 of remaining lifetime', async () => {
            const now = Date.now();
            const exp = Math.floor(now / 1000) + 3600;
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: makeIdToken({ exp }) } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            const remaining = exp * 1000 - now;
            const expectedRefresh = now + Math.floor(remaining * 2 / 3);
            expect(result!.refreshAfterTimestamp).to.be.closeTo(expectedRefresh, 1000);
        });

        it('should fall back to 0 when idToken is undefined', async () => {
            const { credential } = createCredential();

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should fall back to 0 when idToken is malformed', async () => {
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: 'not-a-jwt' } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should fall back to 0 when idToken payload has no exp claim', async () => {
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: makeIdToken({ sub: 'user' }) } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(0);
            expect(result!.refreshAfterTimestamp).to.equal(0);
        });

        it('should handle an already-expired token by setting refreshAfterTimestamp to expiresOnTimestamp', async () => {
            const exp = Math.floor(Date.now() / 1000) - 60; // expired 1 minute ago
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: makeIdToken({ exp }) } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
            expect(result!.refreshAfterTimestamp).to.equal(exp * 1000);
        });

        it('should decode base64url-encoded idToken payloads', async () => {
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const { credential } = createCredential({ session: { accessToken: 'tok', idToken: makeIdToken({ exp }, true) } });

            const result = await credential.getToken('scope1');

            expect(result).to.not.be.null;
            expect(result!.expiresOnTimestamp).to.equal(exp * 1000);
        });

        it('should not add tenant scope when no tenantId is provided anywhere', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken('scope1');

            const hasTenantScope = lastScopes(getSession).some(s => s.startsWith('VSCODE_TENANT:'));
            expect(hasTenantScope).to.be.false;
        });

        it('should forward CAE/MFA claims as a WWW-Authenticate challenge with fallback scopes', async () => {
            const { credential, getSession } = createCredential();
            const claims = '{"access_token":{"nbf":{"essential":true,"value":"1234567890"}}}';

            await credential.getToken('scope1', { claims });

            const challenge = getSession.mock.calls[0].arguments[1] as vscode.AuthenticationWwwAuthenticateRequest;
            expect(challenge).to.not.be.an('array');
            const encoded = Buffer.from(claims, 'utf8').toString('base64');
            expect(challenge.wwwAuthenticate).to.equal(`Bearer error="insufficient_claims", claims="${encoded}"`);
            expect(challenge.fallbackScopes).to.deep.equal(['scope1/.default']);
        });

        it('should pass a plain scopes array (not a challenge) when no claims are provided', async () => {
            const { credential, getSession } = createCredential();

            await credential.getToken('scope1');

            expect(getSession.mock.calls[0].arguments[1]).to.be.an('array');
        });

        it('should read the cloud configuration only once across repeated getToken calls', async () => {
            const { credential, mock } = createCredential();

            const before = mock.workspace.getConfiguration.mock.callCount();
            await credential.getToken('scope1');
            await credential.getToken('scope2');
            await credential.getToken('scope3');
            const after = mock.workspace.getConfiguration.mock.callCount();

            // The configured cloud is resolved once and cached for the credential's lifetime.
            expect(after - before).to.equal(1);
        });
    });
});
