/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createResourceManagement, type ResourceManagementClientOptionalParams, type ResourceManagementContext } from '@azure/arm-resources/api';
import { get as sdkGetProvider } from '@azure/arm-resources/api/providers';
import { $delete as sdkDeleteResourceGroup, list as sdkListResourceGroups, type ResourceGroupsDeleteOptionalParams, type ResourceGroupsListOptionalParams } from '@azure/arm-resources/api/resourceGroups';
import { deleteById as sdkDeleteById, list as sdkListResources, listByResourceGroup as sdkListByResourceGroup, type ResourcesDeleteByIdOptionalParams, type ResourcesListByResourceGroupOptionalParams, type ResourcesListOptionalParams } from '@azure/arm-resources/api/resources';
import type { TokenCredential } from '@azure/core-auth';
import { CaselessMap } from '@microsoft/vscode-azure-utils';
import type { IActionExecutor, ICodeContext, Page, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { GenericResource } from '../../models/GenericResource';
import type { ResourceGroup } from '../../models/Grouping';
import { createArmRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

export type { ResourceGroupsDeleteOptionalParams, ResourceGroupsListOptionalParams };
export type { ResourcesDeleteByIdOptionalParams, ResourcesListByResourceGroupOptionalParams, ResourcesListOptionalParams };

/** ARM and logical resource type for Azure Static Web Apps (`Microsoft.Web/staticSites`). */
export const StaticWebAppResourceType = 'Microsoft.Web/staticSites';

/** ARM and logical resource type for Container Apps. */
export const ContainerAppResourceType = 'Microsoft.App/containerApps';
/** ARM and logical resource type for Container App managed environments. */
export const ManagedEnvironmentResourceType = 'Microsoft.App/managedEnvironments';
/** ARM and logical resource type for Container Registries. */
export const AcrResourceType = 'Microsoft.ContainerRegistry/registries';

/** ARM resource type string for App Service-family resources (`Microsoft.Web/sites`). */
export const SiteType = 'Microsoft.Web/sites';
/** Logical type assigned to function apps (`Microsoft.Web/sites` with `kind` containing `functionapp`). */
export const FunctionAppLogicalType = `${SiteType}~functionapp`;
/** Logical type assigned to Logic Apps (Standard) (`Microsoft.Web/sites` with `kind` containing `workflowapp`). */
export const LogicAppLogicalType = `${SiteType}~workflowapp`;
/** Logical type assigned to App Service web apps (any other `Microsoft.Web/sites` kind). */
export const AppServiceLogicalType = `${SiteType}~app`;

/** ARM resource type string for Cognitive Services accounts (`Microsoft.CognitiveServices/accounts`). */
export const CognitiveServicesAccountType = 'Microsoft.CognitiveServices/accounts';
/** Logical type assigned to AI Foundry resources (`Microsoft.CognitiveServices/accounts` with `kind` containing `AIServices`). */
export const AIServicesLogicalType = `${CognitiveServicesAccountType}~aiservices`;
/** ARM and logical resource type for Microsoft Foundry projects under Cognitive Services accounts. */
export const FoundryProjectResourceType = `${CognitiveServicesAccountType}/projects`;

/** ARM resource type string for Cosmos DB accounts (`Microsoft.DocumentDB/databaseAccounts`). */
export const DocumentDBAccountType = 'Microsoft.DocumentDB/databaseAccounts';
/** Logical type assigned to Cosmos DB for MongoDB accounts (`Microsoft.DocumentDB/databaseAccounts` with `kind` containing `MongoDB`). */
export const CosmosDBMongoLogicalType = `${DocumentDBAccountType}~mongodb`;
/** Logical type assigned to Cosmos DB accounts (any non-MongoDB `Microsoft.DocumentDB/databaseAccounts` kind). */
export const CosmosDBLogicalType = `${DocumentDBAccountType}~cosmosdb`;
/** ARM and logical resource type for Azure DocumentDB clusters. */
export const DocumentDbResourceType = 'Microsoft.DocumentDB/mongoClusters';

/** ARM resource type prefix for Durable Task resources (`Microsoft.DurableTask`). */
export const DurableTaskPrefix = 'Microsoft.DurableTask';
/** Normalized logical type for Durable Task Hub resources (`Microsoft.DurableTask/schedulers/taskHubs`). */
export const DurableTaskHubLogicalType = `${DurableTaskPrefix}/schedulers/taskHubs`;

/** ARM resource type string for Machine Learning workspaces (`Microsoft.MachineLearningServices/workspaces`). */
export const MLWorkspaceType = 'Microsoft.MachineLearningServices/workspaces';
/** Logical type assigned to AI Foundry projects (`Microsoft.MachineLearningServices/workspaces` with `kind` containing `project`). */
export const AIFoundryProjectLogicalType = `${MLWorkspaceType}~project`;

/** Factory that creates an {@linkcode IResourceClient} for a given subscription. */
export const IResourceClientProvider: ServiceIdentifier<IResourceClientProvider> = Symbol.for('IResourceClientProvider');
export type IResourceClientProvider = SyncFactory<IResourceClient, [AzureSubscription]>;

/**
 * Interface describing the resource management APIs we use.
 * Designed so that tests can provide a mock implementation directly.
 *
 * Results are fully-formed model types with `subscription` and `logicalType`
 * already attached.
 */
export interface IResourceClient {
    readonly resourceGroups: {
        list(options?: ResourceGroupsListOptionalParams): AsyncIterable<Page<ResourceGroup>>;
        delete(resourceGroupName: string, options?: ResourceGroupsDeleteOptionalParams): Promise<void>;
    };
    readonly resources: {
        /**
         * Lists resources across the whole subscription.
         *
         * Prefer {@linkcode listByResourceGroup} when the group is known; this
         * exists for the cases that genuinely span groups, such as finding every
         * registry a user could pull an image from.
         */
        list(options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>>;
        listByResourceGroup(resourceGroupName: string, options?: ResourcesListByResourceGroupOptionalParams): AsyncIterable<Page<GenericResource>>;
        deleteById(resourceId: string, resourceType: string, options?: ResourcesDeleteByIdOptionalParams): Promise<void>;
    };
    readonly providers: {
        resolveApiVersion(resourceType: string): Promise<string>;
    };
}

/**
 * Wrapper around the `@azure/arm-resources` REST-style SDK that adapts free
 * functions into the `client.resourceGroups.*` / `client.resources.*` pattern,
 * with results converted to `AsyncIterable<Page<T>>` and metadata attached.
 *
 * Use the static {@linkcode create} factory to construct.
 */
export class ResourceClient implements IResourceClient {
    private readonly apiVersionCache = new CaselessMap<Promise<string>>();

    private constructor(
        private readonly inner: ResourceManagementContext,
        private readonly subscription: AzureSubscription,
    ) { }

    /**
     * Create a new {@linkcode ResourceClient} instance.
     */
    public static create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        credential: TokenCredential,
        subscription: AzureSubscription,
        options?: ResourceManagementClientOptionalParams,
    ): ResourceClient {
        const context = createArmRestSubscriptionClient(
            ctx,
            executor,
            createResourceManagement,
            credential,
            subscription,
            options,
        );
        return new ResourceClient(context, subscription);
    }

    public get resourceGroups(): IResourceClient['resourceGroups'] {
        return {
            list: (options) => this.listResourceGroups(options),
            delete: (resourceGroupName, options) => this.deleteResourceGroup(resourceGroupName, options),
        };
    }

    public get resources(): IResourceClient['resources'] {
        return {
            list: (options) => this.listAllResources(options),
            listByResourceGroup: (resourceGroupName, options) => this.listResources(resourceGroupName, options),
            deleteById: (resourceId, resourceType, options) => this.deleteResourceById(resourceId, resourceType, options),
        };
    }

    public get providers(): IResourceClient['providers'] {
        return { resolveApiVersion: (resourceType) => this.resolveApiVersion(resourceType) };
    }

    private listResourceGroups(options?: ResourceGroupsListOptionalParams): AsyncIterable<Page<ResourceGroup>> {
        return toPages(
            sdkListResourceGroups(this.inner, options),
            rg => {
                const resourceGroup = attachMetadata(rg, this.subscription);
                return Object.assign(resourceGroup, {
                    groupingStrategy: 'resourceGroup' as const,
                    groupingValue: resourceGroup.name,
                });
            }
        );
    }

    private listAllResources(options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            sdkListResources(this.inner, options),
            r => attachMetadata(r, this.subscription)
        );
    }

    private listResources(resourceGroupName: string, options?: ResourcesListByResourceGroupOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            sdkListByResourceGroup(this.inner, resourceGroupName, options),
            r => attachMetadata(r, this.subscription)
        );
    }

    private async deleteResourceGroup(resourceGroupName: string, options?: ResourceGroupsDeleteOptionalParams): Promise<void> {
        await sdkDeleteResourceGroup(this.inner, resourceGroupName, options).pollUntilDone();
    }

    private async deleteResourceById(resourceId: string, resourceType: string, options?: ResourcesDeleteByIdOptionalParams): Promise<void> {
        const apiVersion = await this.resolveApiVersion(resourceType);
        await sdkDeleteById(this.inner, resourceId, apiVersion, options).pollUntilDone();
    }

    private resolveApiVersion(resourceType: string): Promise<string> {
        let resolution = this.apiVersionCache.get(resourceType);
        if (!resolution) {
            resolution = this.fetchApiVersion(resourceType);
            this.apiVersionCache.set(resourceType, resolution);
            void resolution.catch(() => this.apiVersionCache.delete(resourceType));
        }
        return resolution;
    }

    /**
     * Resolve the API version to use for {@linkcode resourceType} from the
     * provider metadata for this subscription.
     *
     * ARM exposes `apiVersions` as a single flat list per resource type -- there
     * is no per-location breakdown (`locationMappings` covers EdgeZone extended
     * locations only), so the version cannot be tailored to a resource's region.
     * Selection therefore favors the most broadly available version:
     *
     * 1. `defaultApiVersion`, which the provider designates as its stable
     *    default and is typically older than the newest version.
     * 2. Otherwise the newest non-preview version, since preview versions are
     *    the most likely to be missing in a given region or sovereign cloud.
     * 3. Otherwise the newest version of any kind.
     *
     * Because the metadata is fetched through the subscription's own ARM
     * endpoint, the result is already scoped to the correct cloud. If Azure
     * still rejects the version it responds with `NoRegisteredProviderFound`,
     * which names the versions it will accept; that error is surfaced as-is
     * rather than guessed around.
     */
    private async fetchApiVersion(resourceType: string): Promise<string> {
        const separator = resourceType.indexOf('/');
        if (separator <= 0 || separator === resourceType.length - 1) {
            throw new Error(`Unable to resolve an API version for resource type "${resourceType}": expected "<provider namespace>/<resource type>".`);
        }

        const providerNamespace = resourceType.slice(0, separator);
        const providerResourceType = resourceType.slice(separator + 1);
        const provider = await sdkGetProvider(this.inner, providerNamespace);
        const match = provider.resourceTypes?.find(type => type.resourceType?.toLowerCase() === providerResourceType.toLowerCase());
        if (!match) {
            throw new Error(`Resource provider "${providerNamespace}" does not define resource type "${providerResourceType}".`);
        }

        const defaultApiVersion = match.defaultApiVersion?.trim();
        if (defaultApiVersion) {
            return defaultApiVersion;
        }

        // ARM returns these newest-first, but sort defensively since that
        // ordering is conventional rather than contractual.
        const apiVersions = match.apiVersions?.map(version => version.trim()).filter(version => version).sort((a, b) => b.localeCompare(a)) ?? [];
        const apiVersion = apiVersions.find(version => !version.toLowerCase().includes('preview')) ?? apiVersions[0];
        if (!apiVersion) {
            throw new Error(`Resource type "${resourceType}" does not define an API version.`);
        }
        return apiVersion;
    }
}

function attachMetadata<T extends { type?: string; kind?: string }>(resource: T, subscription: AzureSubscription): T & GenericResource {
    if (!resource.type) {
        throw new Error(`Resource is missing required field "type": ${JSON.stringify(resource)}`);
    }

    return Object.assign(resource, {
        subscription,
        logicalType: logicalType(resource.type, resource.kind),
    }) as T & GenericResource;
}

function logicalType(type: string, kind?: string): string {
    const typeLower = type.toLowerCase();
    const kindLower = kind?.toLowerCase();

    if (typeLower === SiteType.toLowerCase()) {
        if (kindLower?.includes('workflowapp')) {
            return LogicAppLogicalType;
        } else if (kindLower?.includes('functionapp')) {
            return FunctionAppLogicalType;
        } else {
            return AppServiceLogicalType;
        }
    } else if (typeLower === CognitiveServicesAccountType.toLowerCase()) {
        if (kindLower?.includes('aiservices')) {
            return AIServicesLogicalType;
        }
        return type;
    } else if (typeLower === DocumentDBAccountType.toLowerCase()) {
        if (kindLower?.includes('mongodb')) {
            return CosmosDBMongoLogicalType;
        }
        return CosmosDBLogicalType;
    } else if (typeLower === MLWorkspaceType.toLowerCase()) {
        if (kindLower?.includes('project')) {
            return AIFoundryProjectLogicalType;
        }
        return type;
    } else if (typeLower.startsWith(DurableTaskPrefix.toLowerCase()) && typeLower.endsWith('taskhubs')) {
        // Durable Task Hub is a nested resource type; normalise any
        // `Microsoft.DurableTask/.../taskHubs` variant to a single constant.
        return DurableTaskHubLogicalType;
    } else {
        return type;
    }
}
