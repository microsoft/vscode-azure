/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId, getNodeType } from '@microsoft/vscode-azure-azutils';
import {
    basename,
    IActionExecutor,
    ICodeContext,
    type ITreeItem,
    type ViewProvider,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { CancelAction, RerunAction } from '../../../commands/staticWebApps/ActionCommands';
import { BrowseStaticWebApp } from '../../../commands/staticWebApps/BrowseStaticWebApp';
import { CloneRepository } from '../../../commands/staticWebApps/CloneRepository';
import { DeleteStaticWebAppEnvironment } from '../../../commands/staticWebApps/DeleteStaticWebAppEnvironment';
import { OpenGitHubRepository } from '../../../commands/staticWebApps/OpenGitHubRepository';
import { OpenGitHubLog } from '../../../commands/staticWebApps/OpenGitHubLog';
import { OpenWorkflowConfigFile } from '../../../commands/staticWebApps/OpenWorkflowConfigFile';
import { ShowFunctionsDocumentation } from '../../../commands/staticWebApps/ShowDocumentation';
import { ShowGitHubActions } from '../../../commands/staticWebApps/ShowGitHubActions';
import { ViewStaticWebAppProperties } from '../../../commands/staticWebApps/ViewStaticWebAppProperties';
import { OpenInPortal } from '../../../commands/tree/OpenInPortal';
import { IStaticWebAppsGitHubService } from '../../../services/StaticWebAppsGitHubService';
import { IAzureViewDataTree } from '../../../services';
import { combineContextValues } from '../../contextValueHelpers';
import { getResourceTypeIconUri } from '../../iconPath';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebApp,
    type StaticWebAppAction,
    type StaticWebAppEnvironment,
    type StaticWebAppJob,
    type StaticWebAppStep,
    type StaticWebAppVirtualNode,
    type StaticWebAppWorkflow,
    type StaticWebAppWorkflowGroup,
    type StaticWebAppWorkflowParseError,
} from './StaticWebApp';
import type { WorkflowSourceRange } from './workflowParser';

const openGitHubLogCommand = 'vscode-azure/staticWebApps/openGitHubLog';
const openWorkflowCommand = 'vscode-azure/staticWebApps/openWorkflowConfigFile';
const showFunctionsDocumentationCommand = 'vscode-azure/staticWebApps/showFunctionsDocumentation';

/** View-layer renderer for Azure Static Web Apps and all virtual descendants. */
@injectable()
export class StaticWebAppViewProvider implements ViewProvider<string> {
    /** Context value retained for command and menu compatibility. */
    public static readonly ContextValue = 'azureStaticWebApp';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IAzureViewDataTree) private readonly cache: IAzureViewDataTree,
        @inject(IStaticWebAppsGitHubService) private readonly github: IStaticWebAppsGitHubService,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is string {
        if (typeof resource !== 'string' || !AzureNodeId.test(resource)) {
            return false;
        }
        const node = this.cache.get(resource);
        return !!node && (isStaticWebApp(node) || isStaticWebAppVirtualNode(node));
    }

    /** @inheritdoc */
    public getTreeItem(key: string): ITreeItem {
        const resource = this.cache.get(key);
        if (!resource) {
            return new this.ctx.code.TreeItem(key);
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        if (isStaticWebApp(resource)) {
            return this.getSiteTreeItem(key, resource);
        } else if (isStaticWebAppVirtualNode(resource)) {
            return this.getVirtualTreeItem(key, resource);
        }
        throw new Error('Expected an Azure Static Web Apps resource');
    }

    /** @inheritdoc */
    public async getChildren(key?: string): Promise<string[]> {
        if (!key) {
            return [];
        }
        const resource = this.cache.get(key);
        if (!resource) {
            return [];
        }
        const children = await this.cache.getChildren(resource);
        return children.map(child => AzureNodeId.from(child).toString());
    }

    private getSiteTreeItem(key: string, site: StaticWebApp): ITreeItem {
        const item = new this.ctx.code.TreeItem(site.name, this.ctx.code.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.contextValue = combineContextValues(
            StaticWebAppViewProvider.ContextValue,
            BrowseStaticWebApp.ContextValue,
            CloneRepository.ContextValue,
            OpenInPortal.ContextValue,
            OpenWorkflowConfigFile.ContextValue,
        );
        item.iconPath = getResourceTypeIconUri(this.ctx, site.logicalType);

        const repository = this.github.parseRepositoryUrl(site.repositoryUrl);
        if (repository) {
            item.description = `${repository.owner}/${repository.repo}`;
        }
        return item;
    }

    private getVirtualTreeItem(key: string, node: StaticWebAppVirtualNode): ITreeItem {
        switch (node.virtualType) {
            case StaticWebAppVirtualTypes.Environment:
                return this.getEnvironmentTreeItem(key, node);
            case StaticWebAppVirtualTypes.Actions:
                return this.treeItem(
                    key,
                    this.ctx.code.l10n.t('Actions'),
                    combineContextValues('azureStaticActions', ShowGitHubActions.ContextValue),
                    true,
                    'github-inverted',
                );
            case StaticWebAppVirtualTypes.Action:
                return this.getActionTreeItem(key, node);
            case StaticWebAppVirtualTypes.Job:
                return this.getJobTreeItem(key, node);
            case StaticWebAppVirtualTypes.Step:
                return this.getStepTreeItem(key, node);
            case StaticWebAppVirtualTypes.Functions:
                return this.treeItem(
                    key,
                    this.ctx.code.l10n.t('Functions'),
                    combineContextValues('azureStaticFunctions', OpenInPortal.ContextValue),
                    true,
                    'list-unordered',
                );
            case StaticWebAppVirtualTypes.Function:
                return this.treeItem(key, node.functionName, 'azureStaticFunction', false, 'symbol-function');
            case StaticWebAppVirtualTypes.NoFunctions:
                return this.getNoFunctionsTreeItem(key, node.kind);
            case StaticWebAppVirtualTypes.WorkflowGroup:
                return this.getWorkflowGroupTreeItem(key, node);
            case StaticWebAppVirtualTypes.Workflow:
                return this.getWorkflowTreeItem(key, node);
            case StaticWebAppVirtualTypes.WorkflowParseError:
                return this.getWorkflowParseErrorTreeItem(key, node);
            case StaticWebAppVirtualTypes.Invalid:
                return this.getInvalidTreeItem(key, node);
        }
    }

    private getEnvironmentTreeItem(key: string, environment: StaticWebAppEnvironment): ITreeItem {
        const item = this.treeItem(
            key,
            environment.displayLabel,
            combineContextValues(
                'azureStaticEnvironment',
                BrowseStaticWebApp.ContextValue,
                DeleteStaticWebAppEnvironment.ContextValue,
                OpenGitHubRepository.ContextValue,
                OpenWorkflowConfigFile.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            ),
            true,
            'server-environment',
        );
        if (environment.status && environment.status !== 'Ready') {
            item.description = environment.branch
                ? this.ctx.code.l10n.t('{0} ({1})', environment.branch, environment.status)
                : environment.status;
        } else if (environment.branch) {
            item.description = environment.inWorkspace
                ? this.ctx.code.l10n.t('{0} (linked)', environment.branch)
                : environment.branch;
        }
        return item;
    }

    private getActionTreeItem(key: string, action: StaticWebAppAction): ITreeItem {
        const label = action.run.head_commit?.message ?? action.run.head_sha;
        const contextValue = action.run.status === 'completed'
            ? combineContextValues(
                'azureStaticActionCompleted',
                RerunAction.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            )
            : combineContextValues(
                'azureStaticActionInProgress',
                CancelAction.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            );
        const item = this.treeItem(key, label, contextValue, true);
        item.description = action.run.event;
        item.iconPath = this.getActionIcon(action.run);
        return item;
    }

    private getJobTreeItem(key: string, job: StaticWebAppJob): ITreeItem {
        const hasSteps = !!job.job.steps?.length;
        const item = this.treeItem(
            key,
            job.job.name || String(job.job.id),
            combineContextValues(
                'azureStaticJob',
                OpenGitHubLog.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            ),
            hasSteps,
        );
        item.description = this.getActionDescription(job.job);
        item.iconPath = this.getActionIcon(job.job);
        item.command = this.command(openGitHubLogCommand, this.ctx.code.l10n.t('Open GitHub Action Log'), key);
        return item;
    }

    private getStepTreeItem(key: string, step: StaticWebAppStep): ITreeItem {
        const item = this.treeItem(
            key,
            step.step.name,
            combineContextValues(
                'azureStaticStep',
                OpenGitHubLog.ContextValue,
                ViewStaticWebAppProperties.ContextValue,
            ),
            false,
        );
        item.description = this.getActionDescription(step.step);
        item.iconPath = this.getActionIcon(step.step);
        item.command = this.command(openGitHubLogCommand, this.ctx.code.l10n.t('Open GitHub Action Log'), key);
        return item;
    }

    private getNoFunctionsTreeItem(key: string, kind: 'help' | 'empty'): ITreeItem {
        if (kind === 'empty') {
            return this.treeItem(
                key,
                this.ctx.code.l10n.t('No Functions have been pushed to this Static Web App.'),
                combineContextValues('noFunctions', ShowFunctionsDocumentation.ContextValue),
                false,
                'info',
            );
        }

        const item = this.treeItem(
            key,
            this.ctx.code.l10n.t('Learn how to add an API with Azure Functions...'),
            combineContextValues('noFunctions', ShowFunctionsDocumentation.ContextValue),
            false,
            'book',
        );
        item.command = this.command(
            showFunctionsDocumentationCommand,
            this.ctx.code.l10n.t('Show Azure Functions Documentation'),
            key,
        );
        return item;
    }

    private getWorkflowGroupTreeItem(key: string, group: StaticWebAppWorkflowGroup): ITreeItem {
        const hasError = !!group.workflow.errorRange;
        const item = this.treeItem(
            key,
            hasError ? this.ctx.code.l10n.t('Invalid Workflow') : this.ctx.code.l10n.t('Workflow'),
            combineContextValues('azureStaticWorkflowGroup', OpenWorkflowConfigFile.ContextValue),
            true,
            hasError ? 'warning' : 'settings-gear',
        );
        item.description = basename(group.workflow.uri);
        if (hasError) {
            item.command = this.workflowCommand(key, group.workflow.uri, group.workflow.errorRange);
        }
        return item;
    }

    private getWorkflowTreeItem(key: string, workflow: StaticWebAppWorkflow): ITreeItem {
        const item = this.treeItem(
            key,
            `${workflow.buildConfig}="${workflow.value}"`,
            combineContextValues('azureStaticWorkflow', OpenWorkflowConfigFile.ContextValue),
            false,
            'symbol-constant',
        );
        item.command = this.workflowCommand(key, workflow.uri, workflow.selectionRange, workflow.buildConfig);
        return item;
    }

    private getWorkflowParseErrorTreeItem(key: string, error: StaticWebAppWorkflowParseError): ITreeItem {
        const item = this.treeItem(
            key,
            this.ctx.code.l10n.t(
                'Error: Invalid YAML between lines {0} and {1}',
                error.errorRange.start.line,
                error.errorRange.end.line,
            ),
            combineContextValues('parseYamlErrorTreeItem', OpenWorkflowConfigFile.ContextValue),
            false,
            'warning',
        );
        item.command = this.workflowCommand(key, error.uri, error.errorRange);
        return item;
    }

    private getInvalidTreeItem(key: string, invalid: InvalidStaticWebAppNode): ITreeItem {
        return this.treeItem(key, invalid.displayLabel, invalid.invalidContextValue, false, 'warning');
    }

    private treeItem(
        key: string,
        label: string,
        contextValue: string,
        collapsible: boolean,
        icon?: string,
    ): ITreeItem {
        const state = collapsible
            ? this.ctx.code.TreeItemCollapsibleState.Collapsed
            : this.ctx.code.TreeItemCollapsibleState.None;
        const item = new this.ctx.code.TreeItem(label, state);
        item.id = key;
        item.contextValue = contextValue;
        if (icon) {
            item.iconPath = new this.ctx.code.ThemeIcon(icon);
        }
        return item;
    }

    private getActionIcon(data: { readonly status: string | null; readonly conclusion: string | null }): vscode.ThemeIcon {
        let id: string;
        let color: string;
        switch (data.conclusion) {
            case 'cancelled':
                id = 'circle-slash';
                color = 'testing.iconUnset';
                break;
            case 'failure':
                id = 'error';
                color = 'testing.iconFailed';
                break;
            case 'skipped':
                id = 'debug-step-over';
                color = 'testing.iconSkipped';
                break;
            case 'success':
                id = 'pass';
                color = 'testing.iconPassed';
                break;
            default:
                if (data.status === 'queued') {
                    id = 'clock';
                    color = 'testing.iconQueued';
                } else if (data.status === 'in_progress') {
                    id = 'play-circle';
                    color = 'testing.iconUnset';
                } else {
                    id = 'pass';
                    color = 'testing.iconPassed';
                }
        }
        return new this.ctx.code.ThemeIcon(id, new this.ctx.code.ThemeColor(color));
    }

    private getActionDescription(data: {
        readonly status: string | null;
        readonly conclusion: string | null;
        // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST response field
        readonly started_at?: string | null;
        // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub REST response field
        readonly completed_at?: string | null;
    }): string {
        if (data.conclusion) {
            const verb = conclusionVerb(this.ctx.code, data.conclusion);
            return this.ctx.code.l10n.t('{0} {1}', verb, relativeTime(this.ctx.code, data.completed_at));
        }
        const verb = statusVerb(this.ctx.code, data.status);
        return this.ctx.code.l10n.t('{0} {1}', verb, relativeTime(this.ctx.code, data.started_at));
    }

    private workflowCommand(
        key: string,
        uri: vscode.Uri,
        range: WorkflowSourceRange | undefined,
        buildConfig?: string,
    ): vscode.Command {
        return {
            command: openWorkflowCommand,
            title: this.ctx.code.l10n.t('Open Workflow Configuration'),
            arguments: [{ key, uri, range, buildConfig }],
        };
    }

    private command(command: string, title: string, key: string): vscode.Command {
        return { command, title, arguments: [key] };
    }
}

function conclusionVerb(code: ICodeContext['code'], conclusion: string): string {
    switch (conclusion) {
        case 'success': return code.l10n.t('succeeded');
        case 'failure': return code.l10n.t('failed');
        case 'skipped': return code.l10n.t('skipped');
        case 'cancelled': return code.l10n.t('cancelled');
        default: return conclusion;
    }
}

function statusVerb(code: ICodeContext['code'], status: string | null): string {
    switch (status) {
        case 'in_progress': return code.l10n.t('started');
        case 'queued': return code.l10n.t('queued');
        case 'completed': return code.l10n.t('completed');
        default: return status ?? '';
    }
}

function relativeTime(code: ICodeContext['code'], timestamp: string | null | undefined): string {
    if (!timestamp) {
        return code.l10n.t('now');
    }

    const seconds = Math.round((Date.parse(timestamp) - Date.now()) / 1000);
    const absoluteSeconds = Math.abs(seconds);
    const formatter = new Intl.RelativeTimeFormat(code.env.language, { numeric: 'auto' });
    if (absoluteSeconds < 60) {
        return formatter.format(seconds, 'second');
    } else if (absoluteSeconds < 3600) {
        return formatter.format(Math.round(seconds / 60), 'minute');
    } else if (absoluteSeconds < 86400) {
        return formatter.format(Math.round(seconds / 3600), 'hour');
    }
    return formatter.format(Math.round(seconds / 86400), 'day');
}
