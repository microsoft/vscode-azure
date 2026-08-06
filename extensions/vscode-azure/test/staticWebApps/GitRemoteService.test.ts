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

interface MockRemote {
    readonly name?: string;
    readonly fetchUrl?: string;
    readonly pushUrl?: string;
}

interface MockRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly HEAD?: { readonly name?: string; readonly upstream?: { readonly remote?: string; readonly name?: string } };
        readonly remotes: readonly MockRemote[];
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

/** Single-remote repo, named `origin` and tracked by HEAD when `pushed` is true (the common case). */
function repo(rootPath: string, remoteUrl: string | undefined, options?: { readonly branch?: string; readonly pushed?: boolean }): MockRepository {
    return multiRemoteRepo(rootPath, remoteUrl ? [{ name: 'origin', fetchUrl: remoteUrl }] : [], {
        ...options,
        trackedRemoteName: options?.pushed ? 'origin' : undefined,
    });
}

/** Multi-remote repo with explicit control over which named remote (if any) HEAD tracks. */
function multiRemoteRepo(
    rootPath: string,
    remotes: readonly MockRemote[],
    options?: { readonly branch?: string; readonly trackedRemoteName?: string },
): MockRepository {
    return {
        rootUri: MockUri.file(rootPath),
        state: {
            HEAD: {
                name: options?.branch ?? 'main',
                upstream: options?.trackedRemoteName ? { remote: options.trackedRemoteName, name: options.branch ?? 'main' } : undefined,
            },
            remotes,
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

    describe('multi-remote repositories', () => {
        it('should classify and check pushed status against the branch-tracked remote, not the first remote', async () => {
            // `origin` (first, unsupported) vs. `github` (tracked by HEAD, actually GitHub).
            const repository = multiRemoteRepo('/workspace', [
                { name: 'origin', fetchUrl: 'https://gitlab.com/o/r.git' },
                { name: 'github', fetchUrl: 'https://github.com/o/r.git' },
            ], { trackedRemoteName: 'github' });
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.url).to.equal('https://github.com/o/r.git');
            expect(info?.hasUpstream).to.be.true;
        });

        it('should not report hasUpstream true when the tracked remote differs from the classified one', async () => {
            // HEAD tracks `fork` (unsupported), but classification must not borrow that
            // pushed status for a different remote it might otherwise prefer.
            const repository = multiRemoteRepo('/workspace', [
                { name: 'origin', fetchUrl: 'https://github.com/o/r.git' },
                { name: 'fork', fetchUrl: 'https://gitlab.com/o/r-fork.git' },
            ], { trackedRemoteName: 'fork' });
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            // The tracked remote (fork, unsupported) is authoritative -- we do not silently
            // fall back to classifying `origin` instead while reporting it as "pushed".
            expect(info?.provider).to.equal('unsupported');
            expect(info?.url).to.equal('https://gitlab.com/o/r-fork.git');
            expect(info?.hasUpstream).to.be.true;
        });

        it('should deterministically prefer "origin" when no branch is tracked', async () => {
            const repository = multiRemoteRepo('/workspace', [
                { name: 'upstream', fetchUrl: 'https://gitlab.com/o/upstream.git' },
                { name: 'origin', fetchUrl: 'https://github.com/o/r.git' },
            ]); // no trackedRemoteName -- HEAD has no upstream
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.hasUpstream).to.be.false;
        });

        it('should deterministically fall back to the first remote when neither is tracked nor named origin', async () => {
            const repository = multiRemoteRepo('/workspace', [
                { name: 'upstream', fetchUrl: 'https://github.com/o/r.git' },
                { name: 'fork', fetchUrl: 'https://gitlab.com/o/r-fork.git' },
            ]);
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.hasUpstream).to.be.false;
        });

        it('should fall back deterministically when the tracked remote name no longer exists', async () => {
            const repository = multiRemoteRepo('/workspace', [
                { name: 'origin', fetchUrl: 'https://github.com/o/r.git' },
            ], { trackedRemoteName: 'deleted-remote' });
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.hasUpstream).to.be.false;
        });

        it('should prefer pushUrl over fetchUrl when a remote has both', async () => {
            // A read-only fetch mirror (unsupported host) with a distinct GitHub push target --
            // deployment routing must follow where pushes actually go.
            const repository = multiRemoteRepo('/workspace', [
                { name: 'origin', fetchUrl: 'https://gitlab.com/o/mirror.git', pushUrl: 'https://github.com/o/r.git' },
            ], { trackedRemoteName: 'origin' });
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.url).to.equal('https://github.com/o/r.git');
            expect(info?.hasUpstream).to.be.true;
        });

        it('should fall back to fetchUrl when the tracked remote has no pushUrl', async () => {
            const repository = multiRemoteRepo('/workspace', [
                { name: 'origin', fetchUrl: 'https://github.com/o/r.git' },
            ], { trackedRemoteName: 'origin' });
            const { service } = createService([repository]);

            const info = await service.getRemoteInfo(MockUri.file('/workspace'));

            expect(info?.provider).to.equal('github');
            expect(info?.url).to.equal('https://github.com/o/r.git');
        });
    });
});
