/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaselessSet, IVsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/**
 * Classification of a Git remote for deployment routing purposes.
 *
 * `'unsupported'` covers any remote that is neither github.com nor Azure
 * DevOps (e.g. a self-hosted GitLab/Bitbucket/Gitea remote).
 */
export type GitRemoteProvider = 'github' | 'azdo' | 'unsupported';

/** Read-only classification of the Git remote for a local repository. */
export interface GitRemoteInfo {
    readonly provider: GitRemoteProvider;
    /**
     * The classified remote's `pushUrl`, falling back to `fetchUrl` only when
     * no `pushUrl` is set -- deployment routing follows where pushes go, and
     * the two can differ (e.g. a read-only fetch mirror with a distinct push
     * target).
     */
    readonly url: string;
    /** Current branch name, if resolvable. */
    readonly branch?: string;
    /**
     * `true` when the current branch has an upstream tracking ref, i.e. it
     * has already been pushed to the remote. `false` when the branch exists
     * locally only (or the branch could not be resolved).
     */
    readonly hasUpstream: boolean;
}

/** DI identifier for {@linkcode GitRemoteService}. */
export const IGitRemoteService: ServiceIdentifier<IGitRemoteService> = Symbol.for('IGitRemoteService');
export type IGitRemoteService = GitRemoteService;

interface GitExtension {
    getAPI(version: 1): GitApi;
}

interface GitApi {
    readonly repositories: readonly GitRepository[];
}

interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly HEAD?: {
            readonly name?: string;
            /** Present only when the current branch tracks a remote branch (i.e. has been pushed). */
            readonly upstream?: { readonly remote?: string; readonly name?: string };
        };
        readonly remotes: readonly {
            readonly name?: string;
            readonly fetchUrl?: string;
            readonly pushUrl?: string;
        }[];
    };
}

const azureDevOpsHostnames = new CaselessSet(['dev.azure.com', 'ssh.dev.azure.com', 'vs-ssh.visualstudio.com']);

/**
 * Read-only Git remote inspection used to route Static Web Apps deployment
 * between direct `azd deploy` and `azd pipeline config` CI/CD setup.
 *
 * Never mutates Git state (no init/add-remote/push) -- it only reads the
 * `vscode.git` extension's already-known repository state.
 */
@injectable()
export class GitRemoteService implements IGitRemoteService {
    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
    ) { }

    /** @inheritdoc */
    public async getRemoteInfo(folder: vscode.Uri): Promise<GitRemoteInfo | undefined> {
        const repository = await this.resolveRepository(folder);
        if (!repository) {
            return undefined;
        }

        const remotes = repository.state.remotes.filter(candidate => candidate.fetchUrl || candidate.pushUrl);
        if (remotes.length === 0) {
            return undefined;
        }

        // Bind classification and pushed status to the *same* remote, deterministically,
        // rather than classifying an arbitrary "first" remote while accepting any upstream.
        const upstreamRemoteName = repository.state.HEAD?.upstream?.remote;
        const trackedRemote = upstreamRemoteName
            ? remotes.find(candidate => candidate.name === upstreamRemoteName)
            : undefined;
        // No branch is currently tracking a remote (or its upstream points at a remote that no
        // longer exists) -- fall back to a deterministic pick so multi-remote repos are handled
        // consistently: prefer a remote literally named `origin`, else the first remote in the
        // (stable) array order.
        const remote = trackedRemote ?? remotes.find(candidate => candidate.name === 'origin') ?? remotes[0];

        const url = remote.pushUrl ?? remote.fetchUrl;
        if (!url) {
            return undefined;
        }

        return {
            provider: this.classifyProvider(url),
            url,
            branch: repository.state.HEAD?.name,
            // "Pushed" specifically means the branch tracks *this* (the classified) remote --
            // not merely that HEAD has some upstream, which could point at a different remote.
            hasUpstream: !!trackedRemote && trackedRemote === remote,
        };
    }

    /** Classifies a remote URL as `github`, `azdo`, or `unsupported`. */
    private classifyProvider(url: string): GitRemoteProvider {
        if (isGitHubRemoteUrl(url)) {
            return 'github';
        }
        if (isAzureDevOpsRemoteUrl(url)) {
            return 'azdo';
        }
        return 'unsupported';
    }

    /** Resolves the `vscode.git` repository whose root contains `folder`, if any. */
    private async resolveRepository(folder: vscode.Uri): Promise<GitRepository | undefined> {
        const extension = this.code.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) {
            return undefined;
        }
        const git = extension.isActive ? extension.exports : await extension.activate();
        const folderPath = folder.path.replace(/\/$/, '');
        const repositories = git.getAPI(1).repositories
            .filter(candidate => {
                const rootPath = candidate.rootUri.path.replace(/\/$/, '');
                return folderPath === rootPath || folderPath.startsWith(`${rootPath}/`);
            })
            .sort((left, right) => right.rootUri.path.length - left.rootUri.path.length);
        return repositories[0];
    }
}

/**
 * Matches Azure DevOps HTTPS (`dev.azure.com`, `*.visualstudio.com`) and SSH
 * (`ssh.dev.azure.com`, `vs-ssh.visualstudio.com`) remote URLs.
 */
/**
 * `true` when `url` points at a repository on github.com.
 *
 * Recognizes both the SSH (`git@github.com:owner/repo.git`) and HTTPS
 * (`https://github.com/owner/repo`) remote forms, requiring an
 * `owner/repo` path so that non-repository github.com URLs are not
 * misclassified as deployable remotes.
 */
function isGitHubRemoteUrl(url: string): boolean {
    if (/^(?:ssh:\/\/)?git@github\.com(?::|\/)[^/]+\/[^/]+?(?:\.git)?\/?$/i.test(url)) {
        return true;
    }

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== 'github.com' && hostname !== 'www.github.com') {
            return false;
        }
        return parsed.pathname.split('/').filter(Boolean).length === 2;
    } catch {
        return false;
    }
}

function isAzureDevOpsRemoteUrl(url: string): boolean {
    // SSH form: git@ssh.dev.azure.com:v3/... or org@vs-ssh.visualstudio.com:v3/...
    const sshMatch = /^(?:ssh:\/\/)?[^@/]+@([^:/]+)[:/]/i.exec(url);
    if (sshMatch) {
        return isAzureDevOpsHostname(sshMatch[1]);
    }

    try {
        return isAzureDevOpsHostname(new URL(url).hostname);
    } catch {
        return false;
    }
}

function isAzureDevOpsHostname(hostname: string): boolean {
    // The set compares caselessly; the suffix test still has to lower-case, since
    // DNS names are case-insensitive but `endsWith` is not.
    return azureDevOpsHostnames.has(hostname) || hostname.toLowerCase().endsWith('.visualstudio.com');
}
