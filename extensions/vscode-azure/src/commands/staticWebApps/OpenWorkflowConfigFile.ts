/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    basename,
    CancellationError,
    ICodeContext,
} from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import { IStaticWebAppsGitHubService } from '../../services/StaticWebAppsGitHubService';
import {
    isStaticWebAppVirtualNode,
    StaticWebAppVirtualTypes,
    type StaticWebApp,
    type StaticWebAppEnvironment,
    type StaticWebAppWorkflowGroup,
} from '../../tree/resources/staticWebApps/StaticWebApp';
import {
    parseStaticWebAppWorkflow,
    type WorkflowBuildConfig,
    type WorkflowSourceRange,
} from '../../tree/resources/staticWebApps/workflowParser';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';
import { encodeGitHubBranch, getGitHubRepositoryUrl } from './staticWebAppLinks';

/** Existing tree-click argument shape for workflow nodes and parse errors. */
export interface OpenWorkflowConfigFileArgs {
    readonly key: string;
    readonly uri: vscode.Uri;
    readonly range?: WorkflowSourceRange;
    readonly buildConfig?: WorkflowBuildConfig;
}

interface WorkflowTarget {
    readonly uri: vscode.Uri;
    readonly range?: WorkflowSourceRange;
    readonly buildConfig?: WorkflowBuildConfig;
}

/**
 * Opens a local Static Web Apps workflow at the exact value/error range.
 *
 * Site and environment invocations use local provider data when available,
 * then fall back to the linked repository's GitHub web editor.
 */
@injectable()
export class OpenWorkflowConfigFile implements ManagedCommand {
    /** Context value for site, environment, and workflow tree items. */
    public static readonly ContextValue = 'openStaticWebAppWorkflowConfig';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppsGitHubService) private readonly github: IStaticWebAppsGitHubService,
    ) { }

    /** @inheritdoc */
    public async execute(arg?: string | OpenWorkflowConfigFileArgs): Promise<void> {
        if (arg && typeof arg === 'object') {
            await this.openLocal({
                uri: arg.uri,
                range: arg.range,
                buildConfig: arg.buildConfig,
            });
            return;
        }

        const key = typeof arg === 'string' ? arg : undefined;
        const site = await this.resolver.resolveSite(key);
        const resource = key ? this.resolver.dataTree.get(key) : site;
        if (!resource) {
            throw new Error(this.ctx.code.l10n.t('The selected Static Web Apps item is no longer available.'));
        }

        const directTarget = this.getDirectTarget(resource);
        if (directTarget) {
            await this.openLocal(directTarget);
            return;
        }

        const environment = isStaticWebAppVirtualNode(resource)
            && resource.virtualType === StaticWebAppVirtualTypes.Environment
            ? resource
            : undefined;
        const localTarget = await this.findLocalTarget(site, environment);
        if (localTarget) {
            await this.openLocal(localTarget);
            return;
        }

        await this.openGitHubEditor(site, environment);
    }

    private getDirectTarget(resource: unknown): WorkflowTarget | undefined {
        if (!isStaticWebAppVirtualNode(resource)) {
            return undefined;
        }
        switch (resource.virtualType) {
            case StaticWebAppVirtualTypes.Workflow:
                return { uri: resource.uri, range: resource.selectionRange, buildConfig: resource.buildConfig };
            case StaticWebAppVirtualTypes.WorkflowGroup:
                return { uri: resource.workflow.uri, range: resource.workflow.errorRange };
            case StaticWebAppVirtualTypes.WorkflowParseError:
                return { uri: resource.uri, range: resource.errorRange };
            default:
                return undefined;
        }
    }

    private async findLocalTarget(
        site: StaticWebApp,
        selectedEnvironment: StaticWebAppEnvironment | undefined,
    ): Promise<WorkflowTarget | undefined> {
        let environment = selectedEnvironment;
        if (!environment) {
            const environments = (await this.resolver.dataTree.getChildren(site))
                .filter((node): node is StaticWebAppEnvironment => isStaticWebAppVirtualNode(node)
                    && node.virtualType === StaticWebAppVirtualTypes.Environment);
            if (environments.length === 0) {
                return undefined;
            }
            environment = environments.find(candidate => candidate.isProduction) ?? environments[0];
        }

        const groups = (await this.resolver.dataTree.getChildren(environment))
            .filter((node): node is StaticWebAppWorkflowGroup => isStaticWebAppVirtualNode(node)
                && node.virtualType === StaticWebAppVirtualTypes.WorkflowGroup);
        if (groups.length === 0) {
            return undefined;
        } else if (groups.length === 1) {
            return { uri: groups[0].workflow.uri, range: groups[0].workflow.errorRange };
        }

        const selected = await this.ctx.code.window.showQuickPick(
            groups.map(group => ({
                label: basename(group.workflow.uri),
                group,
            })),
            { placeHolder: this.ctx.code.l10n.t('Select the GitHub workflow file to open.') },
        );
        if (!selected) {
            throw new CancellationError(undefined, 'Select Static Web Apps workflow');
        }
        return { uri: selected.group.workflow.uri, range: selected.group.workflow.errorRange };
    }

    private async openLocal(target: WorkflowTarget): Promise<void> {
        let range = target.range;
        if (!range && target.buildConfig) {
            const workflow = await parseStaticWebAppWorkflow(this.ctx.code, target.uri);
            range = workflow?.settings.find(setting => setting.name === target.buildConfig)?.range;
        }

        const document = await this.ctx.code.workspace.openTextDocument(target.uri);
        const selection = range
            ? new this.ctx.code.Range(
                range.start.line,
                range.start.character,
                range.end.line,
                range.end.character,
            )
            : undefined;
        const editor = await this.ctx.code.window.showTextDocument(document, { selection });
        if (selection) {
            editor.revealRange(selection, this.ctx.code.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    private async openGitHubEditor(site: StaticWebApp, environment: StaticWebAppEnvironment | undefined): Promise<void> {
        const enriched = await this.resolver.whenSiteEnriched(site);
        const repository = this.github.parseRepositoryUrl(enriched.repositoryUrl);
        const branch = environment?.branch ?? enriched.branch;
        const hostname = environment?.hostname ?? enriched.defaultHostname;
        if (!repository || !branch || !hostname) {
            throw new Error(this.ctx.code.l10n.t('No local workflow or linked GitHub workflow could be found for the selected Static Web App.'));
        }

        const workflowName = `azure-static-web-apps-${hostname.split('.')[0]}.yml`;
        const url = `${getGitHubRepositoryUrl(repository)}/edit/${encodeGitHubBranch(branch)}/.github/workflows/${encodeURIComponent(workflowName)}`;
        await this.ctx.code.env.openExternal(this.ctx.code.Uri.parse(url));
    }
}
