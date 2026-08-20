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
import { collectPageItems, IActionExecutor, IVsCode, type DataProvider } from '@microsoft/vscode-azure-utils';
import { inject, injectable, type ServiceIdentifier } from 'inversify';
import { StaticWebAppSettingsAdapter } from '../../../settings/adapters/StaticWebAppSettingsAdapter';
import { getSettingsNodes } from '../settings/SettingsNode';
import {
    isStaticWebApp,
    isStaticWebAppVirtualNode,
    normalizeStaticWebAppBranch,
    StaticWebAppVirtualTypes,
    type InvalidStaticWebAppNode,
    type StaticWebApp,
    type StaticWebAppEnvironment,
    type StaticWebAppFunction,
    type StaticWebAppFunctions,
    type StaticWebAppInvalidContext,
    type StaticWebAppNoFunctions,
} from './StaticWebApp';

/** DI identifier for direct Static Web Apps cache mutation and command access. */
export const IStaticWebAppDataProvider: ServiceIdentifier<IStaticWebAppDataProvider> = Symbol.for('IStaticWebAppDataProvider');
export type IStaticWebAppDataProvider = StaticWebAppDataProvider;

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
        @inject(StaticWebAppSettingsAdapter) private readonly settingsAdapter: StaticWebAppSettingsAdapter,
    ) { }

    /** @inheritdoc */
    public canHandle(resource: unknown): resource is ConcreteAzureNode {
        return isStaticWebApp(resource) || isStaticWebAppVirtualNode(resource);
    }

    /** Enriches only the ARM resource root with current service details. */
    public async enrich(resource: ConcreteAzureNode): Promise<boolean> {
        if (!isStaticWebApp(resource)) {
            return false;
        }

        this.executor.setTelProp('nodeType', getNodeType(resource));
        const { client, resourceGroupName } = this.resolveClient(resource);
        const site = await client.staticSites.getStaticSite(resourceGroupName, resource.name);
        Object.assign(resource, {
            staticSite: site,
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
            case StaticWebAppVirtualTypes.Functions:
                return this.listFunctions(resource);
            default:
                return [];
        }
    }

    private async listEnvironments(site: StaticWebApp): Promise<ConcreteAzureNode[]> {
        if (!site.staticSite) {
            await this.enrich(site);
        }
        const { client, resourceGroupName } = this.resolveClient(site);
        const builds = await collectPageItems(client.staticSites.listStaticSiteBuilds(resourceGroupName, site.name));
        const environments = builds.map(build => this.createEnvironmentOrInvalid(site, build));
        return environments.sort((left, right) => compareEnvironments(left, right));
    }

    private async getEnvironmentChildren(environment: StaticWebAppEnvironment): Promise<ConcreteAzureNode[]> {
        // Settings first: they belong to the environment itself, whereas everything below is a
        // category of things deployed into it. They are contributed unconditionally because the
        // app settings dictionary exists whether or not the environment has a managed API -- only
        // the Functions node below depends on one being deployed.
        const children: ConcreteAzureNode[] = [
            ...getSettingsNodes(environment, this.settingsAdapter, `${environment.azureResource.name}-${environment.displayLabel}`),
        ];
        if (await this.hasFunctionsApi(environment)) {
            children.push(this.createFunctionsGroup(environment));
        } else {
            children.push(this.createNoFunctions(environment, 'help'));
        }

        return children;
    }

    private async listFunctions(group: StaticWebAppFunctions): Promise<ConcreteAzureNode[]> {
        const { client, resourceGroupName } = this.resolveClient(group.azureResource);
        const pages = group.isProduction
            ? client.staticSites.listStaticSiteFunctions(resourceGroupName, group.azureResource.name)
            : client.staticSites.listStaticSiteBuildFunctions(resourceGroupName, group.azureResource.name, group.environmentBuildId);
        const functions = await collectPageItems(pages);
        const children = functions.map(func => this.createFunctionOrInvalid(group, func));
        return children.length ? children : [this.createNoFunctions(group, 'empty')];
    }

    private createEnvironmentOrInvalid(site: StaticWebApp, data: StaticSiteBuildARMResource): StaticWebAppEnvironment | InvalidStaticWebAppNode {
        const sourceId = data.buildId ?? data.name ?? 'unknown';
        try {
            if (!data.buildId) {
                throw new Error('Environment is missing buildId');
            }

            const isProduction = data.buildId === 'default';
            const sourceBranch = data.sourceBranch ?? site.branch ?? '';
            const branch = isProduction ? sourceBranch : normalizeStaticWebAppBranch(sourceBranch);
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
            };
        } catch {
            return this.createInvalid(site, `environments/invalid/${sourceId}`, 'invalidStaticEnvironment', data.name ?? sourceId);
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
            // This endpoint is the service's feature probe: it is rejected with 'Operation not
            // supported: A function must first be deployed to use this method.' until a managed
            // API exists. A rejection therefore means the environment has no Functions API and is
            // represented by help. Note this is *not* the dictionary the settings editor uses --
            // see StaticWebAppSettingsAdapter, which reads the always-available app settings.
            return false;
        }
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

function compareEnvironments(left: ConcreteAzureNode, right: ConcreteAzureNode): number {
    const leftProduction = isEnvironment(left) && left.isProduction;
    const rightProduction = isEnvironment(right) && right.isProduction;
    if (leftProduction !== rightProduction) {
        return leftProduction ? -1 : 1;
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

function isInvalid(node: ConcreteAzureNode): node is InvalidStaticWebAppNode {
    return isStaticWebAppVirtualNode(node) && node.virtualType === StaticWebAppVirtualTypes.Invalid;
}
