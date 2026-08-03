/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createResourceManagement, type ResourceManagementClientOptionalParams, type ResourceManagementContext } from '@azure/arm-resources/api';
import { list as sdkListResourceGroups, type ResourceGroupsListOptionalParams } from '@azure/arm-resources/api/resourceGroups';
import { list as sdkListResources, listByResourceGroup as sdkListByResourceGroup, type ResourcesListByResourceGroupOptionalParams, type ResourcesListOptionalParams } from '@azure/arm-resources/api/resources';
import type { TokenCredential } from '@azure/core-auth';
import type { IActionExecutor, ICodeContext, Page, SyncFactory } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { AzureSubscription } from '../../auth/AzureSubscription';
import type { GenericResource } from '../../models/GenericResource';
import type { ResourceGroup } from '../../models/Grouping';
import { createArmRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

export type { ResourceGroupsListOptionalParams, ResourcesListByResourceGroupOptionalParams, ResourcesListOptionalParams };

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

/** ARM resource type string for Cosmos DB accounts (`Microsoft.DocumentDB/databaseAccounts`). */
export const DocumentDBAccountType = 'Microsoft.DocumentDB/databaseAccounts';
/** Logical type assigned to Cosmos DB for MongoDB accounts (`Microsoft.DocumentDB/databaseAccounts` with `kind` containing `MongoDB`). */
export const CosmosDBMongoLogicalType = `${DocumentDBAccountType}~mongodb`;
/** Logical type assigned to Cosmos DB accounts (any non-MongoDB `Microsoft.DocumentDB/databaseAccounts` kind). */
export const CosmosDBLogicalType = `${DocumentDBAccountType}~cosmosdb`;

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
    };
    readonly resources: {
        /**
         * List every resource in the subscription in one ARM operation,
         * regardless of resource group.
         *
         * Prefer this over calling {@linkcode listByResourceGroup} once per
         * resource group when the complete resource set is needed (e.g. to
         * group by resource type, location, or tag): it replaces N round trips
         * with one.
         *
         * **Note:** unlike {@linkcode resourceGroups.list}, this does not
         * surface resource groups that contain no resources. Callers that need
         * the full set of resource groups must still list them separately.
         */
        list(options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>>;
        listByResourceGroup(resourceGroupName: string, options?: ResourcesListByResourceGroupOptionalParams): AsyncIterable<Page<GenericResource>>;
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
        return { list: (options) => this.listResourceGroups(options) };
    }

    public get resources(): IResourceClient['resources'] {
        return {
            list: (options) => this.listAllResources(options),
            listByResourceGroup: (resourceGroupName, options) => this.listResources(resourceGroupName, options),
        };
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

    private listResources(resourceGroupName: string, options?: ResourcesListByResourceGroupOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            sdkListByResourceGroup(this.inner, resourceGroupName, options),
            r => attachMetadata(r, this.subscription)
        );
    }

    private listAllResources(options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            sdkListResources(this.inner, options),
            r => attachMetadata(r, this.subscription)
        );
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
