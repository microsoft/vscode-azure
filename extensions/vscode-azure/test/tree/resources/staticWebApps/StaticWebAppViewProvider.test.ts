/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, type ConcreteAzureNode } from '@microsoft/vscode-azure-azutils';
import { createMockCodeContext, createTestActionExecutor } from '@microsoft/vscode-azure-utils/testing';
import * as vscode from 'vscode';
import { OpenInPortal } from '../../../../src/commands/tree/OpenInPortal';
import type { GitHubJob, GitHubWorkflowRun, GitHubWorkflowStep } from '../../../../src/services/StaticWebAppsGitHubService';
import {
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebAppAction,
    type StaticWebAppAppSettingsGroup,
    type StaticWebAppJob,
    type StaticWebAppNoFunctions,
    type StaticWebAppStep,
    type StaticWebAppWorkflowGroup,
} from '../../../../src/tree/resources/staticWebApps/StaticWebApp';
import { StaticWebAppViewProvider } from '../../../../src/tree/resources/staticWebApps/StaticWebAppViewProvider';
import { makeStaticWebApp, makeStaticWebAppEnvironment } from './mockStaticWebApp';

describe('StaticWebAppViewProvider (unit)', () => {
    function render(resource: ConcreteAzureNode) {
        const { ctx } = createMockCodeContext();
        const { executor } = createTestActionExecutor();
        const key = AzureNodeId.from(resource).toString();
        const cache = {
            get: (candidate: string) => candidate === key ? resource : undefined,
            getChildren: () => Promise.resolve([]),
        };
        const github = {
            parseRepositoryUrl: () => ({ owner: 'octo-org', repo: 'octo-repo' }),
        };
        const provider = new StaticWebAppViewProvider(ctx, executor, cache as never, github as never);
        return { item: provider.getTreeItem(key), key, ctx };
    }

    it('should render the site root with stable compatibility and portal contexts', () => {
        const { item } = render(makeStaticWebApp());
        expect(item.label).to.equal('mySwa');
        expect(item.description).to.equal('octo-org/octo-repo');
        expect(item.contextValue).to.include(StaticWebAppViewProvider.ContextValue);
        expect(item.contextValue).to.include(OpenInPortal.ContextValue);
        expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
    });

    it('should prioritize environment status and show linked branches when ready', () => {
        const failed = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Deploying',
            inWorkspace: true,
        })).item;
        expect(failed.description).to.equal('feature (Deploying)');

        const linked = render(makeStaticWebAppEnvironment({
            branch: 'feature',
            status: 'Ready',
            inWorkspace: true,
        })).item;
        expect(linked.description).to.equal('feature (linked)');
        expect(linked.contextValue).to.include('azureStaticEnvironment');
    });

    it('should distinguish completed and in-progress action contexts and icons', () => {
        const completed = render(makeAction({ status: 'completed', conclusion: 'success' })).item;
        expect(completed.contextValue).to.include('azureStaticActionCompleted');
        expect((completed.iconPath as vscode.ThemeIcon).id).to.equal('pass');

        const running = render(makeAction({ status: 'in_progress', conclusion: null })).item;
        expect(running.contextValue).to.include('azureStaticActionInProgress');
        expect((running.iconPath as vscode.ThemeIcon).id).to.equal('play-circle');
    });

    it('should attach future log commands to jobs and steps', () => {
        const site = makeStaticWebApp();
        /* eslint-disable @typescript-eslint/naming-convention -- GitHub REST response fixtures */
        const jobData = {
            id: 10,
            name: 'Build',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:01:00Z',
            steps: [],
        } as unknown as GitHubJob;
        const job: StaticWebAppJob = {
            virtualType: StaticWebAppVirtualTypes.Job,
            virtualPath: 'environments/default/actions/runs/1/jobs/10',
            azureResource: site,
            repository: { owner: 'octo-org', repo: 'octo-repo' },
            runId: 1,
            job: jobData,
        };
        const stepData = {
            name: 'Deploy',
            number: 1,
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:01:00Z',
        } as GitHubWorkflowStep;
        /* eslint-enable @typescript-eslint/naming-convention */
        const step: StaticWebAppStep = {
            virtualType: StaticWebAppVirtualTypes.Step,
            virtualPath: `${job.virtualPath}/steps/1`,
            azureResource: site,
            repository: job.repository,
            jobId: jobData.id,
            step: stepData,
        };

        expect(render(job).item.command?.command).to.equal('vscode-azure/staticWebApps/openGitHubLog');
        expect(render(step).item.command?.command).to.equal('vscode-azure/staticWebApps/openGitHubLog');
        expect(render(step).item.contextValue).to.include('azureStaticStep');
    });

    it('should preserve app-settings contexts for later shared commands', () => {
        const group: StaticWebAppAppSettingsGroup = {
            virtualType: StaticWebAppVirtualTypes.AppSettings,
            virtualPath: 'environments/default/appSettings',
            azureResource: makeStaticWebApp(),
            environmentBuildId: 'default',
            isProduction: true,
            branch: 'main',
        };
        const item = render(group).item;
        expect(item.contextValue).to.match(/applicationSettings.*staticWebApps/);
        expect(item.contextValue).to.include(OpenInPortal.ContextValue);
    });

    it('should render distinct no-functions help and empty-list semantics', () => {
        const site = makeStaticWebApp();
        const help: StaticWebAppNoFunctions = {
            virtualType: StaticWebAppVirtualTypes.NoFunctions,
            virtualPath: 'environments/default/noFunctions/help',
            azureResource: site,
            kind: 'help',
        };
        const empty: StaticWebAppNoFunctions = {
            ...help,
            virtualPath: 'environments/default/functions/noFunctions/empty',
            kind: 'empty',
        };

        expect(render(help).item.command?.command).to.equal('vscode-azure/staticWebApps/showFunctionsDocumentation');
        expect(render(empty).item.command).to.be.undefined;
        expect(render(empty).item.label).to.equal('No Functions have been pushed to this Static Web App.');
    });

    it('should render exact invalid context variants', () => {
        const invalid: InvalidStaticWebAppNode = {
            virtualType: StaticWebAppVirtualTypes.Invalid,
            virtualPath: 'environments/invalid/broken',
            azureResource: makeStaticWebApp(),
            invalidContextValue: 'invalidStaticEnvironment',
            displayLabel: 'broken',
        };
        expect(render(invalid).item.contextValue).to.equal('invalidStaticEnvironment');
    });

    it('should preserve workflow URI and error range in future command metadata', () => {
        const { ctx } = createMockCodeContext();
        const uri = ctx.code.Uri.file('/repo/.github/workflows/swa.yml');
        const group: StaticWebAppWorkflowGroup = {
            virtualType: StaticWebAppVirtualTypes.WorkflowGroup,
            virtualPath: 'environments/default/workflows/swa',
            azureResource: makeStaticWebApp(),
            workflow: {
                uri,
                settings: [],
                errorRange: {
                    start: { line: 2, character: 1 },
                    end: { line: 3, character: 4 },
                },
            },
        };

        const item = render(group).item;
        expect(item.label).to.equal('Invalid Workflow');
        expect(item.description).to.equal('swa.yml');
        expect(item.contextValue).to.include('azureStaticWorkflowGroup');
        expect(item.command?.command).to.equal('vscode-azure/staticWebApps/openWorkflowConfigFile');
        expect(item.command?.arguments?.[0]).to.deep.include({ uri });
    });
});

function makeAction(overrides: Partial<GitHubWorkflowRun>): StaticWebAppAction {
    /* eslint-disable @typescript-eslint/naming-convention -- GitHub REST response fixture */
    const run = {
        id: 1,
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        head_sha: 'abc',
        event: 'push',
        head_commit: { message: 'Deploy site' },
        ...overrides,
    } as GitHubWorkflowRun;
    /* eslint-enable @typescript-eslint/naming-convention */
    return {
        virtualType: StaticWebAppVirtualTypes.Action,
        virtualPath: `environments/default/actions/runs/${run.id}`,
        azureResource: makeStaticWebApp(),
        repository: { owner: 'octo-org', repo: 'octo-repo' },
        run,
    };
}
