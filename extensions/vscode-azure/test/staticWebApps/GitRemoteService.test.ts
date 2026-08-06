/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { StaticWebAppsGitHubService } from '../../src/services/StaticWebAppsGitHubService';
import { GitRemoteService } from '../../src/staticWebApps/GitRemoteService';

interface MockRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly HEAD?: { readonly name?: string; readonly upstream?: { readonly remote?: string; readonly name?: string } };
        readonly remotes: readonly { readonly fetchUrl?: string; readonly pushUrl?: string }[];
    };
}

function createService(repositories: readonly MockRepository[], options?: { readonly noExtension?: boolean; readonly inactive?: boolean }) {
    const exports = { getAPI: () => ({ repositories }) };
    const gitExtension = {
        isActive: !options?.inactive,
        exports,
        activate: mock.fn(() => Promise.resolve(exports)),
    };
    const getExtension = mock.fn((id: string) => (options?.noExtension || id !== 'vscode.git' ? undefined : gitExtension));
    const { vscode: code } = createMockVsCode({ extensions: { getExtension } as never });
    const github = new StaticWebAppsGitHubService(code, {} as never);
    return { service: new GitRemoteService(code, github), gitExtension };
}

function repo(rootPath: string, remoteUrl: string | undefined, options?: { readonly branch?: string; readonly pushed?: boolean }): MockRepository {
    return {
        rootUri: MockUri.file(rootPath),
        state: {
            HEAD: { name: options?.branch ?? 'main', upstream: options?.pushed ? { remote: 'origin', name: options.branch ?? 'main' } : undefined },
            remotes: remoteUrl ? [{ fetchUrl: remoteUrl }] : [],
        },
    };
}

describe('GitRemoteService (unit)', () => {
    it('should return undefined when the vscode.git extension is not installed', async () => {
        const { service } = createService([], { noExtension: true });
        expect(await service.getRemoteInfo(MockUri.file('/workspace'))).to.be.undefined;
    });

    it('should activate the git extension when it is not yet active', async () => {
        const { service, gitExtension } = createService(
            [repo('/workspace', 'https://github.com/octo-org/octo-repo.git', { pushed: true })],
            { inactive: true },
        );
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(gitExtension.activate.mock.callCount()).to.equal(1);
        expect(info?.provider).to.equal('github');
    });

    it('should return undefined when no repository root contains the folder', async () => {
        const { service } = createService([repo('/other', 'https://github.com/octo-org/octo-repo.git')]);
        expect(await service.getRemoteInfo(MockUri.file('/workspace'))).to.be.undefined;
    });

    it('should return undefined when the matching repository has no remotes', async () => {
        const { service } = createService([repo('/workspace', undefined)]);
        expect(await service.getRemoteInfo(MockUri.file('/workspace'))).to.be.undefined;
    });

    it('should classify a github.com HTTPS remote', async () => {
        const { service } = createService([repo('/workspace', 'https://github.com/octo-org/octo-repo.git', { pushed: true, branch: 'feature' })]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('github');
        expect(info?.branch).to.equal('feature');
        expect(info?.hasUpstream).to.be.true;
    });

    it('should classify a github.com SSH remote', async () => {
        const { service } = createService([repo('/workspace', 'git@github.com:octo-org/octo-repo.git')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('github');
    });

    it('should classify a dev.azure.com HTTPS remote', async () => {
        const { service } = createService([repo('/workspace', 'https://dev.azure.com/contoso/project/_git/repo')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('azdo');
    });

    it('should classify a *.visualstudio.com HTTPS remote', async () => {
        const { service } = createService([repo('/workspace', 'https://contoso.visualstudio.com/project/_git/repo')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('azdo');
    });

    it('should classify an ssh.dev.azure.com SSH remote', async () => {
        const { service } = createService([repo('/workspace', 'git@ssh.dev.azure.com:v3/contoso/project/repo')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('azdo');
    });

    it('should classify a vs-ssh.visualstudio.com SSH remote', async () => {
        const { service } = createService([repo('/workspace', 'contoso@vs-ssh.visualstudio.com:v3/contoso/project/repo')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('azdo');
    });

    it('should classify an unrecognized remote as unsupported', async () => {
        const { service } = createService([repo('/workspace', 'https://gitlab.com/octo-org/octo-repo.git')]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.provider).to.equal('unsupported');
    });

    it('should report hasUpstream false when the current branch has not been pushed', async () => {
        const { service } = createService([repo('/workspace', 'https://github.com/octo-org/octo-repo.git', { pushed: false })]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace'));
        expect(info?.hasUpstream).to.be.false;
    });

    it('should match a repository whose root is an ancestor of the given folder', async () => {
        const { service } = createService([repo('/workspace', 'https://github.com/octo-org/octo-repo.git', { pushed: true })]);
        const info = await service.getRemoteInfo(MockUri.file('/workspace/infra'));
        expect(info?.provider).to.equal('github');
    });
});
