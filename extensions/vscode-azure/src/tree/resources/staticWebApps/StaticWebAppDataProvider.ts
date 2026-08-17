/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    getNodeType,
    IStaticWebAppClientProvider,
    parseAzureResourceId,
    portalUrlForArmResource,
    type ConcreteAzureNode,
    type IStaticWebAppClient,
    type StaticSiteBuildARMResource,
    type StaticSiteFunctionOverviewARMResource,
} from '@microsoft/vscode-azure-azutils';
import { IActionExecutor, IVsCode, type DataProvider, type Page } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';
import { IStaticWebAppsGitHubService, type GitHubJob, type GitHubRepository, type GitHubWorkflowRun, type GitHubWorkflowStep } from '../../../services/StaticWebAppsGitHubService';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    normalizeStaticWebAppBranch,
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebApp,
    type StaticWebAppAction,
    type StaticWebAppActions,
    type StaticWebAppEnvironment,
    type StaticWebAppFunction,
    type StaticWebAppFunctions,
    type StaticWebAppInvalidContext,
    type StaticWebAppJob,
    type StaticWebAppNoFunctions,
    type StaticWebAppStep,
    type StaticWebAppWorkflow,
    type StaticWebAppWorkflowGroup,
    type StaticWebAppWorkflowParseError,
} from './StaticWebApp';
import { scanStaticWebAppWorkflows, type ParsedWorkflow } from './workflowParser';

/** DI identifier for direct Static Web Apps cache mutation and command access. */
export const IStaticWebAppDataProvider: ServiceIdentifier<IStaticWebAppDataProvider> = Symbol.for('IStaticWebAppDataProvider');
export type IStaticWebAppDataProvider = StaticWebAppDataProvider;

interface GitExtension {
    getAPI(version: 1): GitApi;
}

interface GitApi {
    readonly repositories: readonly GitRepository[];
}

interface GitRepository {
    readonly rootUri: vscode.Uri;
    readonly state: {
        readonly HEAD?: { readonly name?: string };
        readonly remotes: readonly {
            readonly fetchUrl?: string;
            readonly pushUrl?: string;
        }[];
    };
}

const completedConclusions = new Set(['success', 'failure', 'skipped', 'cancelled']);
const actionStatuses = new Set(['queued', 'in_progress', 'completed']);

/**
 * Data-layer provider for Azure Static Web Apps and all service-owned children.
 *
 * Every virtual path includes its full structural ancestry, producing stable,
 * collision-free {@linkcode import('@microsoft/vscode-azure-azutils').AzureNodeId AzureNodeId}
 * keys while leaving parent relationships to the tree cache.
 */
@injectable()
export class StaticWebAppDataProvider implements DataProvider<ConcreteAzureNode> {
    private readonly clients = new Map<string, IStaticWebAppClient>();

    public constructor(
        @inject(IActionExecutor) private readonly executor: IActionExecutor,
        @inject(IVsCode) private readonly code: IVsCode,
        @inject(IStaticWebAppClientProvider) private readonly createClient: IStaticWebAppClientProvider,
        @inject(IStaticWebAppsGitHubService) private readonly github: IStaticWebAppsGitHubService,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isStaticWebApp(resource) || isStaticWebAppVirtualNode(resource);
    }

    /**
     * Enriches only the ARM resource root. Missing repository data is valid for
     * portal-created or otherwise unlinked sites and never triggers GitHub auth.
     */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isStaticWebApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        const { client, resourceGroupName } = this.resolveClient(resource);
        const site = await client.staticSites.getStaticSite(resourceGroupName, resource.name);
        Object.assign(resource, {
            staticSite: site,
            repositoryUrl: site.repositoryUrl,
            branch: site.branch,
            defaultHostname: site.defaultHostname,
        });
        return false;
    }

    /** @inheritdoc */
    public async getChildren(resource?: ConcreteAzureNode): Promise<ConcreteAzureNode[]> {
        if (!resource) {
            return [];
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));

        if (isStaticWebApp(resource)) {
            return this.listEnvironments(resource);
        } else if (!isStaticWebAppVirtualNode(resource)) {
            return [];
        }

        switch (resource.virtualType) {
            case StaticWebAppVirtualTypes.Environment:
                return this.getEnvironmentChildren(resource);
            case StaticWebAppVirtualTypes.Actions:
                return this.listActions(resource);
            case StaticWebAppVirtualTypes.Action:
                return this.listJobs(resource);
            case StaticWebAppVirtualTypes.Job:
                return this.listSteps(resource);
            case StaticWebAppVirtualTypes.Functions:
                return this.listFunctions(resource);
            case StaticWebAppVirtualTypes.WorkflowGroup:
                return this.getWorkflowChildren(resource);
            default:
                return [];
        }
    }

    private async listEnvironments(site: StaticWebApp): Promise<ConcreteAzureNode[]> {
        if (!site.staticSite) {
            await this.enrich(site);
        }
        const { client, resourceGroupName } = this.resolveClient(site);
        const builds = await collectPages(client.staticSites.listStaticSiteBuilds(resourceGroupName, site.name));
        const environments = await Promise.all(builds.map(build => this.createEnvironmentOrInvalid(site, build)));
        return environments.sort((left, right) => compareEnvironments(left, right));
    }

    private async getEnvironmentChildren(environment: StaticWebAppEnvironment): Promise<ConcreteAzureNode[]> {
        const repository = this.github.parseRepositoryUrl(environment.azureResource.repositoryUrl);
        const actions: StaticWebAppActions = {
            virtualType: StaticWebAppVirtualTypes.Actions,
            virtualPath: `${environment.virtualPath}/actions`,
            azureResource: environment.azureResource,
            environmentBuildId: environment.buildId,
            branch: environment.branch,
            repository,
        };

        const children: ConcreteAzureNode[] = [actions];
        if (await this.hasFunctionsApi(environment)) {
            children.push(this.createFunctionsGroup(environment));
        } else {
            children.push(this.createNoFunctions(environment, 'help'));
        }

        if (environment.localRepositoryUri) {
            const workflows = await scanStaticWebAppWorkflows(this.code, environment.localRepositoryUri);
            children.push(...workflows.map(workflow => this.createWorkflowGroup(environment, workflow)));
        }

        return children;
    }

    private async listActions(group: StaticWebAppActions): Promise<ConcreteAzureNode[]> {
        if (!group.repository || !group.branch) {
            return [];
        }

        const repository = group.repository;
        const runs = await this.github.listWorkflowRuns(repository, group.branch);
        return runs.map(run => this.createActionOrInvalid(group, repository, run));
    }

    private async listJobs(action: StaticWebAppAction): Promise<ConcreteAzureNode[]> {
        const jobs = await this.github.listJobs(action.repository, action.run.id);
        return jobs
            .map(job => this.createJobOrInvalid(action, job))
            .sort(compareJobs);
    }

    private listSteps(job: StaticWebAppJob): ConcreteAzureNode[] {
        return [...(job.job.steps ?? [])]
            .sort((left, right) => left.number - right.number)
            .map(step => this.createStepOrInvalid(job, step));
    }

    private async listFunctions(group: StaticWebAppFunctions): Promise<ConcreteAzureNode[]> {
        const { client, resourceGroupName } = this.resolveClient(group.azureResource);
        const pages = group.isProduction
            ? client.staticSites.listStaticSiteFunctions(resourceGroupName, group.azureResource.name)
            : client.staticSites.listStaticSiteBuildFunctions(resourceGroupName, group.azureResource.name, group.environmentBuildId);
        const functions = await collectPages(pages);
        const children = functions.map(func => this.createFunctionOrInvalid(group, func));
        return children.length ? children : [this.createNoFunctions(group, 'empty')];
    }

    private getWorkflowChildren(group: StaticWebAppWorkflowGroup): ConcreteAzureNode[] {
        if (group.workflow.errorRange) {
            const node: StaticWebAppWorkflowParseError = {
                virtualType: StaticWebAppVirtualTypes.WorkflowParseError,
                virtualPath: `${group.virtualPath}/parseError`,
                azureResource: group.azureResource,
                uri: group.workflow.uri,
                errorRange: group.workflow.errorRange,
            };
            return [node];
        }

        return group.workflow.settings.map(setting => ({
            virtualType: StaticWebAppVirtualTypes.Workflow,
            virtualPath: `${group.virtualPath}/${setting.name}`,
            azureResource: group.azureResource,
            uri: group.workflow.uri,
            buildConfig: setting.name,
            value: setting.value,
            selectionRange: setting.range,
        } satisfies StaticWebAppWorkflow));
    }

    private async createEnvironmentOrInvalid(site: StaticWebApp, data: StaticSiteBuildARMResource): Promise<StaticWebAppEnvironment | InvalidStaticWebAppNode> {
        const sourceId = data.buildId ?? data.name ?? 'unknown';
        try {
            if (!data.buildId) {
                throw new Error('Environment is missing buildId');
            }

            const isProduction = data.buildId === 'default';
            const sourceBranch = data.sourceBranch ?? site.branch ?? '';
            const branch = isProduction ? sourceBranch : normalizeStaticWebAppBranch(sourceBranch);
            const repository = this.github.parseRepositoryUrl(site.repositoryUrl);
            const localRepositoryUri = repository && branch
                ? await this.findMatchingLocalRepository(repository, branch)
                : undefined;
            return {
                virtualType: StaticWebAppVirtualTypes.Environment,
                virtualPath: `environments/${data.buildId}`,
                azureResource: site,
                data,
                buildId: data.buildId,
                branch,
                isProduction,
                hostname: data.hostname,
                status: data.status,
                displayLabel: isProduction
                    ? this.code.l10n.t('Production')
                    : (data.pullRequestTitle ?? data.name ?? data.buildId),
                inWorkspace: !!localRepositoryUri,
                localRepositoryUri,
            };
        } catch {
            return this.createInvalid(site, `environments/invalid/${sourceId}`, 'invalidStaticEnvironment', data.name ?? sourceId);
        }
    }

    private createActionOrInvalid(
        group: StaticWebAppActions,
        repository: GitHubRepository,
        run: GitHubWorkflowRun,
    ): StaticWebAppAction | InvalidStaticWebAppNode {
        try {
            validateActionState(run);
            if (!Number.isFinite(run.id)) {
                throw new Error('Workflow run is missing id');
            }
            return {
                virtualType: StaticWebAppVirtualTypes.Action,
                virtualPath: `${group.virtualPath}/runs/${run.id}`,
                azureResource: group.azureResource,
                repository,
                run,
            };
        } catch {
            return this.createInvalid(
                group.azureResource,
                `${group.virtualPath}/runs/invalid/${String(run.id)}`,
                'invalidActionTreeItem',
                run.head_commit?.message ?? run.head_sha,
            );
        }
    }

    private createJobOrInvalid(action: StaticWebAppAction, job: GitHubJob): StaticWebAppJob | InvalidStaticWebAppNode {
        try {
            validateActionState(job);
            if (!Number.isFinite(job.id)) {
                throw new Error('Workflow job is missing id');
            }
            return {
                virtualType: StaticWebAppVirtualTypes.Job,
                virtualPath: `${action.virtualPath}/jobs/${job.id}`,
                azureResource: action.azureResource,
                repository: action.repository,
                runId: action.run.id,
                job,
            };
        } catch {
            return this.createInvalid(
                action.azureResource,
                `${action.virtualPath}/jobs/invalid/${String(job.id)}`,
                'invalidJobTreeItem',
                job.name,
            );
        }
    }

    private createStepOrInvalid(job: StaticWebAppJob, step: GitHubWorkflowStep): StaticWebAppStep | InvalidStaticWebAppNode {
        try {
            validateActionState(step);
            if (!Number.isFinite(step.number) || !step.name) {
                throw new Error('Workflow step is missing required data');
            }
            return {
                virtualType: StaticWebAppVirtualTypes.Step,
                virtualPath: `${job.virtualPath}/steps/${step.number}`,
                azureResource: job.azureResource,
                repository: job.repository,
                jobId: job.job.id,
                step,
            };
        } catch {
            return this.createInvalid(
                job.azureResource,
                `${job.virtualPath}/steps/invalid/${String(step.number)}`,
                'invalidStepTreeItem',
                step.name,
            );
        }
    }

    private createFunctionOrInvalid(group: StaticWebAppFunctions, data: StaticSiteFunctionOverviewARMResource): StaticWebAppFunction | InvalidStaticWebAppNode {
        const sourceId = data.id ?? data.name ?? 'unknown';
        if (!data.functionName) {
            return this.createInvalid(
                group.azureResource,
                `${group.virtualPath}/invalid/${sourceId}`,
                'invalidFunction',
                data.name ?? sourceId,
            );
        }

        return {
            virtualType: StaticWebAppVirtualTypes.Function,
            virtualPath: `${group.virtualPath}/${data.functionName}`,
            azureResource: group.azureResource,
            environmentBuildId: group.environmentBuildId,
            data,
            functionName: data.functionName,
        };
    }

    private createFunctionsGroup(environment: StaticWebAppEnvironment): StaticWebAppFunctions {
        const environmentResourceId = environment.data.id
            ?? `${environment.azureResource.id}/builds/${environment.buildId}`;
        return {
            virtualType: StaticWebAppVirtualTypes.Functions,
            virtualPath: `${environment.virtualPath}/functions`,
            azureResource: environment.azureResource,
            // The portal models a build's functions as their own page, so this
            // node opens there rather than at the parent static site.
            portalUrl: portalUrlForArmResource(
                environment.azureResource.subscription,
                `${environmentResourceId}/functions`,
            ),
            environmentBuildId: environment.buildId,
            isProduction: environment.isProduction,
        };
    }

    private createNoFunctions(
        parent: StaticWebAppEnvironment | StaticWebAppFunctions,
        kind: StaticWebAppNoFunctions['kind'],
    ): StaticWebAppNoFunctions {
        return {
            virtualType: StaticWebAppVirtualTypes.NoFunctions,
            virtualPath: `${parent.virtualPath}/noFunctions/${kind}`,
            azureResource: parent.azureResource,
            kind,
        };
    }

    private createWorkflowGroup(environment: StaticWebAppEnvironment, workflow: ParsedWorkflow): StaticWebAppWorkflowGroup {
        return {
            virtualType: StaticWebAppVirtualTypes.WorkflowGroup,
            virtualPath: `${environment.virtualPath}/workflows/${workflow.uri.toString()}`,
            azureResource: environment.azureResource,
            workflow,
        };
    }

    private createInvalid(
        site: StaticWebApp,
        virtualPath: string,
        invalidContextValue: StaticWebAppInvalidContext,
        sourceLabel: string | undefined,
    ): InvalidStaticWebAppNode {
        return {
            virtualType: StaticWebAppVirtualTypes.Invalid,
            virtualPath,
            azureResource: site,
            invalidContextValue,
            displayLabel: sourceLabel || this.code.l10n.t('Some items could not be displayed'),
        };
    }

    private async hasFunctionsApi(environment: StaticWebAppEnvironment): Promise<boolean> {
        const { client, resourceGroupName } = this.resolveClient(environment.azureResource);
        try {
            if (environment.isProduction) {
                await client.staticSites.listStaticSiteFunctionAppSettings(resourceGroupName, environment.azureResource.name);
            } else {
                await client.staticSites.listStaticSiteBuildFunctionAppSettings(
                    resourceGroupName,
                    environment.azureResource.name,
                    environment.buildId,
                );
            }
            return true;
        } catch {
            // This endpoint is the service's feature probe. A rejection means
            // the environment has no Functions API and is represented by help.
            return false;
        }
    }

    private async findMatchingLocalRepository(repository: GitHubRepository, branch: string): Promise<vscode.Uri | undefined> {
        const gitExtension = this.code.extensions.getExtension<GitExtension>('vscode.git');
        if (!gitExtension) {
            return undefined;
        }

        const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
        const api = git.getAPI(1);
        for (const localRepository of api.repositories) {
            if (localRepository.state.HEAD?.name !== branch || !this.code.workspace.getWorkspaceFolder(localRepository.rootUri)) {
                continue;
            }

            const remoteMatches = localRepository.state.remotes.some(remote => {
                const parsed = this.github.parseRepositoryUrl(remote.fetchUrl ?? remote.pushUrl);
                return parsed?.owner.toLowerCase() === repository.owner.toLowerCase()
                    && parsed.repo.toLowerCase() === repository.repo.toLowerCase();
            });
            if (remoteMatches) {
                return localRepository.rootUri;
            }
        }
        return undefined;
    }

    private resolveClient(site: StaticWebApp): { readonly client: IStaticWebAppClient; readonly resourceGroupName: string } {
        const { resourceGroup: resourceGroupName } = parseAzureResourceId(site.id);
        if (!resourceGroupName) {
            throw new Error(`Cannot extract resource group name from resource ID: ${site.id}`);
        }
        return { client: this.getClient(site), resourceGroupName };
    }

    private getClient(site: StaticWebApp): IStaticWebAppClient {
        const subscriptionId = site.subscription.subscriptionId;
        let client = this.clients.get(subscriptionId);
        if (!client) {
            client = this.createClient(site.subscription);
            this.clients.set(subscriptionId, client);
        }
        return client;
    }

}

async function collectPages<T>(pages: AsyncIterable<Page<T>>): Promise<T[]> {
    const items: T[] = [];
    for await (const page of pages) {
        items.push(...page.items);
    }
    return items;
}

function compareEnvironments(left: ConcreteAzureNode, right: ConcreteAzureNode): number {
    const leftProduction = isEnvironment(left) && left.isProduction;
    const rightProduction = isEnvironment(right) && right.isProduction;
    if (leftProduction !== rightProduction) {
        return leftProduction ? -1 : 1;
    }
    return displayLabel(left).localeCompare(displayLabel(right));
}

function compareJobs(left: ConcreteAzureNode, right: ConcreteAzureNode): number {
    if (isJob(left) && isJob(right)) {
        return Date.parse(left.job.started_at) - Date.parse(right.job.started_at);
    } else if (isJob(left)) {
        return -1;
    } else if (isJob(right)) {
        return 1;
    }
    return displayLabel(left).localeCompare(displayLabel(right));
}

function displayLabel(node: ConcreteAzureNode): string {
    if (isEnvironment(node)) {
        return node.displayLabel;
    } else if (isInvalid(node)) {
        return node.displayLabel;
    }
    return '';
}

function isEnvironment(node: ConcreteAzureNode): node is StaticWebAppEnvironment {
    return isStaticWebAppVirtualNode(node) && node.virtualType === StaticWebAppVirtualTypes.Environment;
}

function isJob(node: ConcreteAzureNode): node is StaticWebAppJob {
    return isStaticWebAppVirtualNode(node) && node.virtualType === StaticWebAppVirtualTypes.Job;
}

function isInvalid(node: ConcreteAzureNode): node is InvalidStaticWebAppNode {
    return isStaticWebAppVirtualNode(node) && node.virtualType === StaticWebAppVirtualTypes.Invalid;
}

function validateActionState(data: { readonly status: string | null; readonly conclusion: string | null }): void {
    if (!data.status || !actionStatuses.has(data.status)) {
        throw new Error(`Unsupported GitHub Actions status: ${String(data.status)}`);
    }
    if (data.conclusion !== null && !completedConclusions.has(data.conclusion)) {
        throw new Error(`Unsupported GitHub Actions conclusion: ${data.conclusion}`);
    }
}
