/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

/** GitHub OAuth scopes needed by Static Web Apps tree and command operations. */
export const staticWebAppsGitHubScopes = ['repo', 'workflow', 'user:email', 'read:user'] as const;

/** Parsed github.com repository identity. */
export interface GitHubRepository {
    readonly owner: string;
    readonly repo: string;
}

type ListedWorkflowRun = RestEndpointMethodTypes['actions']['listWorkflowRunsForRepo']['response']['data']['workflow_runs'][number];
type ListedJob = RestEndpointMethodTypes['actions']['listJobsForWorkflowRun']['response']['data']['jobs'][number];

/** Workflow-run data retained by Static Web Apps action nodes. */
export type GitHubWorkflowRun = ListedWorkflowRun;
/** Workflow-job data retained by Static Web Apps job nodes. */
export type GitHubJob = ListedJob;
/** Workflow-step data retained by Static Web Apps step nodes. */
export type GitHubWorkflowStep = NonNullable<ListedJob['steps']>[number];
/** Workflow definition returned by GitHub. */
export type GitHubWorkflow = RestEndpointMethodTypes['actions']['getWorkflow']['response']['data'];

/** DI identifier for the lazily authenticated Static Web Apps GitHub service. */
export const IStaticWebAppsGitHubService: ServiceIdentifier<IStaticWebAppsGitHubService> = Symbol.for('IStaticWebAppsGitHubService');
export type IStaticWebAppsGitHubService = StaticWebAppsGitHubService;

/**
 * Lazy, token-safe GitHub operations used by Static Web Apps.
 *
 * Construction and activation never prompt, and nothing here runs until a tree
 * or command operation asks for it. Callers that must not prompt use
 * {@linkcode StaticWebAppsGitHubService.hasAuthentication hasAuthentication};
 * everything else acquires a session on demand.
 */
@injectable()
export class StaticWebAppsGitHubService {
    private static readonly authProvider = 'github';
    private static readonly codespacesScope = 'x-SwaScope';

    public constructor(
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IExtensionContext) private readonly extensionContext: IExtensionContext,
    ) { }

    /**
     * Whether VS Code already holds a GitHub session this extension can use.
     *
     * Never creates one, so it never prompts and never surfaces an account
     * picker. Callers use it to decide whether a GitHub-backed affordance is
     * worth offering, not as a precondition -- the operations themselves
     * acquire a session on demand.
     */
    public async hasAuthentication(): Promise<boolean> {
        return !!await this.getSession(false);
    }

    /** Parses HTTPS and SSH github.com remotes without requiring authentication. */
    public parseRepositoryUrl(repositoryUrl: string | undefined): GitHubRepository | undefined {
        if (!repositoryUrl) {
            return undefined;
        }

        const sshMatch = /^(?:ssh:\/\/)?git@github\.com(?::|\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repositoryUrl);
        if (sshMatch) {
            return { owner: sshMatch[1], repo: sshMatch[2] };
        }

        try {
            const url = new URL(repositoryUrl);
            if (url.hostname.toLowerCase() !== 'github.com' && url.hostname.toLowerCase() !== 'www.github.com') {
                return undefined;
            }

            const segments = url.pathname.split('/').filter(Boolean);
            if (segments.length !== 2) {
                return undefined;
            }

            return {
                owner: segments[0],
                repo: segments[1].replace(/\.git$/i, ''),
            };
        } catch {
            return undefined;
        }
    }

    /** Lists workflow runs for exactly one environment branch. */
    public async listWorkflowRuns(repository: GitHubRepository, branch: string): Promise<GitHubWorkflowRun[]> {
        const client = await this.createClient();
        const response = await client.rest.actions.listWorkflowRunsForRepo({
            owner: repository.owner,
            repo: repository.repo,
            branch,
        });
        return response.data.workflow_runs.filter(run => run.head_branch === branch);
    }

    /** Gets the latest state of one workflow run. */
    public async getWorkflowRun(repository: GitHubRepository, runId: number): Promise<GitHubWorkflowRun> {
        const client = await this.createClient();
        return (await client.rest.actions.getWorkflowRun({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            run_id: runId,
        })).data;
    }

    /** Requests a rerun of a completed workflow run. */
    public async rerunWorkflowRun(repository: GitHubRepository, runId: number): Promise<void> {
        const client = await this.createClient();
        await client.rest.actions.reRunWorkflow({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            run_id: runId,
        });
    }

    /** Requests cancellation of an active workflow run. */
    public async cancelWorkflowRun(repository: GitHubRepository, runId: number): Promise<void> {
        const client = await this.createClient();
        await client.rest.actions.cancelWorkflowRun({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            run_id: runId,
        });
    }

    /** Lists jobs for a workflow run in API order. */
    public async listJobs(repository: GitHubRepository, runId: number): Promise<GitHubJob[]> {
        const client = await this.createClient();
        return (await client.rest.actions.listJobsForWorkflowRun({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            run_id: runId,
        })).data.jobs;
    }

    /** Gets the latest state of one workflow job. */
    public async getJob(repository: GitHubRepository, jobId: number): Promise<GitHubJob> {
        const client = await this.createClient();
        return (await client.rest.actions.getJobForWorkflowRun({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            job_id: jobId,
        })).data;
    }

    /** Gets a workflow definition by numeric id or file name. */
    public async getWorkflow(repository: GitHubRepository, workflowId: number | string): Promise<GitHubWorkflow> {
        const client = await this.createClient();
        return (await client.rest.actions.getWorkflow({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            workflow_id: workflowId,
        })).data;
    }

    /** Downloads the raw log payload for one workflow job. */
    public async downloadJobLogs(repository: GitHubRepository, jobId: number): Promise<ArrayBuffer> {
        const client = await this.createClient();
        const data = (await client.rest.actions.downloadJobLogsForWorkflowRun({
            owner: repository.owner,
            repo: repository.repo,
            // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST parameter
            job_id: jobId,
        })).data;

        if (data instanceof ArrayBuffer) {
            return data;
        } else if (ArrayBuffer.isView(data)) {
            return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        } else if (typeof data === 'string') {
            return new TextEncoder().encode(data).buffer;
        }

        throw new Error(this.code.l10n.t('GitHub returned an unsupported job log response.'));
    }

    private async createClient(): Promise<Octokit> {
        const session = await this.getSession(true);
        if (!session) {
            throw new Error(this.code.l10n.t('GitHub authentication is required for this operation.'));
        }

        const packageJSON = this.extensionContext.extension.packageJSON as { readonly version?: unknown };
        const version = typeof packageJSON.version === 'string' ? packageJSON.version : 'unknown';
        return new Octokit({
            auth: session.accessToken,
            userAgent: `${this.extensionContext.extension.id}/${version}`,
        });
    }

    private async getSession(createIfNone: boolean) {
        const session = createIfNone
            ? await this.code.authentication.getSession(StaticWebAppsGitHubService.authProvider, [...staticWebAppsGitHubScopes], { createIfNone: true })
            : await this.code.authentication.getSession(StaticWebAppsGitHubService.authProvider, [...staticWebAppsGitHubScopes], { createIfNone: false });

        if (!session?.accessToken.startsWith('ghu_')) {
            return session;
        }

        const codespacesScopes = [...staticWebAppsGitHubScopes, StaticWebAppsGitHubService.codespacesScope];
        return createIfNone
            ? await this.code.authentication.getSession(StaticWebAppsGitHubService.authProvider, codespacesScopes, { createIfNone: true })
            : await this.code.authentication.getSession(StaticWebAppsGitHubService.authProvider, codespacesScopes, { createIfNone: false });
    }
}
