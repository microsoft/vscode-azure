/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureViewDataTree } from '../../services';
import { IStaticWebAppsGitHubService, type IStaticWebAppsGitHubService as StaticWebAppsGitHubService } from '../../services/StaticWebAppsGitHubService';
import { GitHubActionLogContentProvider } from '../../staticWebApps/GitHubActionLogContentProvider';
import { createGitHubLogFoldingRanges, parseGitHubLog } from '../../staticWebApps/GitHubActionLogParser';
import {
    StaticWebAppVirtualTypes,
    type StaticWebAppJob,
    type StaticWebAppStep,
} from '../../tree/resources/staticWebApps/StaticWebApp';
import type { ManagedCommand } from '../ManagedCommand';
import { IVsCode, type IVsCode as VsCode } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';

/** Opens a filtered GitHub Action job or step log in a foldable virtual document. */
@injectable()
export class OpenGitHubLog implements ManagedCommand {
    /** Context value applied to GitHub Action job and step tree items. */
    public static readonly ContextValue = 'openStaticWebAppGitHubLog';

    public constructor(
        @inject(IVsCode) private readonly code: VsCode,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IStaticWebAppsGitHubService) private readonly github: StaticWebAppsGitHubService,
        @inject(GitHubActionLogContentProvider) private readonly contentProvider: GitHubActionLogContentProvider,
    ) { }

    /** Resolves a Static Web Apps Job/Step key and opens its parent job log. */
    public async execute(key?: unknown): Promise<void> {
        const node = typeof key === 'string' ? this.cache.get(key) : undefined;
        if (!isJobOrStep(node)) {
            throw new Error(this.code.l10n.t('Select a GitHub Actions job or step to view its log.'));
        }

        let content: string;
        let foldingRanges = [] as ReturnType<typeof createGitHubLogFoldingRanges>;
        try {
            const jobId = getJobId(node);
            const raw = new TextDecoder().decode(
                await this.github.downloadJobLogs(node.repository, jobId),
            );
            const state = parseGitHubLog(
                raw,
                new Date(getStartedAt(node) ?? ''),
                new Date(getCompletedAt(node) ?? ''),
            );
            content = state.filteredJobsLog.length > 0
                ? state.filteredJobsLog.join('\n')
                : this.code.l10n.t('There are no logs to display for this step.');
            foldingRanges = createGitHubLogFoldingRanges(state);
        } catch (error) {
            if (!isExpiredLogError(error)) {
                throw error;
            }
            content = this.code.l10n.t(
                'The logs for this run have expired and are no longer available.',
            );
        }

        await this.contentProvider.open(
            {
                jobId: getJobId(node),
                stepNumber: node.virtualType === StaticWebAppVirtualTypes.Step
                    ? node.step.number
                    : undefined,
                label: node.virtualType === StaticWebAppVirtualTypes.Job
                    ? node.job.name || String(node.job.id)
                    : node.step.name,
            },
            content,
            foldingRanges,
        );
    }
}

function isJobOrStep(node: unknown): node is StaticWebAppJob | StaticWebAppStep {
    return !!node
        && typeof node === 'object'
        && 'virtualType' in node
        && (node.virtualType === StaticWebAppVirtualTypes.Job
            || node.virtualType === StaticWebAppVirtualTypes.Step);
}

function getJobId(node: StaticWebAppJob | StaticWebAppStep): number {
    return node.virtualType === StaticWebAppVirtualTypes.Job
        ? node.job.id
        : node.jobId;
}

function getStartedAt(node: StaticWebAppJob | StaticWebAppStep): string | null | undefined {
    return node.virtualType === StaticWebAppVirtualTypes.Job
        ? node.job.started_at
        : node.step.started_at;
}

function getCompletedAt(node: StaticWebAppJob | StaticWebAppStep): string | null | undefined {
    return node.virtualType === StaticWebAppVirtualTypes.Job
        ? node.job.completed_at
        : node.step.completed_at;
}

function isExpiredLogError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    if ('status' in error && error.status === 410) {
        return true;
    }
    return 'response' in error
        && !!error.response
        && typeof error.response === 'object'
        && 'status' in error.response
        && error.response.status === 410;
}
