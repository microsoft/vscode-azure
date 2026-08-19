/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import {
    staticWebAppsGitHubScopes,
    StaticWebAppsGitHubService,
} from '../../src/services/StaticWebAppsGitHubService';

describe('StaticWebAppsGitHubService (unit)', () => {
    it('should not request authentication during construction', () => {
        const { ctx, mock } = createMockCodeContext();
        new StaticWebAppsGitHubService(ctx.code, ctx.extensionContext);
        expect(mock.authentication.getSession.mock.callCount()).to.equal(0);
    });

    it('should report existing authentication without prompting', async () => {
        const { ctx, mock } = createMockCodeContext();
        const service = new StaticWebAppsGitHubService(ctx.code, ctx.extensionContext);

        expect(await service.hasAuthentication()).to.be.false;
        const call = mock.authentication.getSession.mock.calls[0];
        expect(call.arguments[0]).to.equal('github');
        expect(call.arguments[1]).to.deep.equal(staticWebAppsGitHubScopes);
        expect(call.arguments[2]).to.deep.equal({ createIfNone: false });
    });

    it('should preserve the Codespaces fake-scope workaround', async () => {
        const { ctx, mock } = createMockCodeContext();
        const account = { id: 'account', label: 'Account' };
        mock.authentication.getSession.mock.mockImplementation(((
            _provider: string,
            scopes: readonly string[],
        ): Promise<vscode.AuthenticationSession> => Promise.resolve({
            id: 'session',
            account,
            scopes,
            accessToken: scopes.includes('x-SwaScope') ? 'github-token' : 'ghu_codespaces-token',
        })) as never);
        const service = new StaticWebAppsGitHubService(ctx.code, ctx.extensionContext);

        expect(await service.hasAuthentication()).to.be.true;
        expect(mock.authentication.getSession.mock.callCount()).to.equal(2);
        expect(mock.authentication.getSession.mock.calls[1].arguments[1]).to.deep.equal([
            ...staticWebAppsGitHubScopes,
            'x-SwaScope',
        ]);
        expect(mock.authentication.getSession.mock.calls[1].arguments[2]).to.deep.equal({ createIfNone: false });
    });

    it('should parse supported HTTPS and SSH repository URLs', () => {
        const { ctx } = createMockCodeContext();
        const service = new StaticWebAppsGitHubService(ctx.code, ctx.extensionContext);

        expect(service.parseRepositoryUrl('https://github.com/octo-org/octo-repo.git')).to.deep.equal({
            owner: 'octo-org',
            repo: 'octo-repo',
        });
        expect(service.parseRepositoryUrl('git@github.com:octo-org/octo-repo.git')).to.deep.equal({
            owner: 'octo-org',
            repo: 'octo-repo',
        });
        expect(service.parseRepositoryUrl('https://example.com/octo-org/octo-repo')).to.be.undefined;
        expect(service.parseRepositoryUrl(undefined)).to.be.undefined;
    });
});
