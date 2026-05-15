/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ResourceGroupsListOptionalParams,
    ResourceManagementClient,
    ResourceManagementClientOptionalParams,
    ResourcesListOptionalParams
} from '@azure/arm-resources';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext, Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { GenericResource } from '../../models/GenericResource';
import type { ResourceGroup } from '../../models/Grouping';
import { createAzureSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

/** ARM resource type string for App Service-family resources (`Microsoft.Web/sites`). */
export const SiteType = 'Microsoft.Web/sites';
/** Logical type assigned to function apps (`Microsoft.Web/sites` with `kind` containing `functionapp`). */
export const FunctionAppLogicalType = `${SiteType}~functionapp`;
/** Logical type assigned to Logic Apps (Standard) (`Microsoft.Web/sites` with `kind` containing `workflowapp`). */
export const WorkflowAppLogicalType = `${SiteType}~workflowapp`;
/** Logical type assigned to App Service web apps (any other `Microsoft.Web/sites` kind). */
export const AppServiceLogicalType = `${SiteType}~app`;

/** ARM resource type string for Cognitive Services accounts (`Microsoft.CognitiveServices/accounts`). */
export const CognitiveServicesAccountType = 'Microsoft.CognitiveServices/accounts';
/** Logical type assigned to AI Foundry resources (`Microsoft.CognitiveServices/accounts` with `kind` containing `AIServices`). */
export const AIServicesLogicalType = `${CognitiveServicesAccountType}~aiservices`;

/** Factory that creates an {@linkcode IResourceClient} for a given subscription. */
export const IResourceClientProvider: ServiceIdentifier<IResourceClientProvider> = Symbol.for('IResourceClientProvider');
export type IResourceClientProvider = AsyncFactory<IResourceClient, [AzureSubscription]>;

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
        listByResourceGroup(resourceGroupName: string, options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>>;
    };
}

/**
 * Wrapper around {@linkcode ResourceManagementClient} that exposes only the
 * methods we use, with results converted to `AsyncIterable<Page<T>>` and
 * metadata attached.
 *
 * Use the static {@linkcode create} factory to construct--it lazily imports the
 * SDK to keep load times down.
 */
export class ResourceClient implements IResourceClient {
    private static sdk: typeof import('@azure/arm-resources') | undefined;

    private constructor(
        private readonly inner: ResourceManagementClient,
        private readonly subscription: AzureSubscription,
    ) { }

    /**
     * Create a new {@linkcode ResourceClient} instance. Lazily imports
     * `@azure/arm-resources` on first call.
     */
    public static async create(
        ctx: ICodeContext,
        executor: IActionExecutor,
        subscription: AzureSubscription,
        options?: ResourceManagementClientOptionalParams,
    ): Promise<ResourceClient> {
        ResourceClient.sdk ??= await import('@azure/arm-resources');
        const inner = createAzureSubscriptionClient(
            ctx,
            executor,
            ResourceClient.sdk.ResourceManagementClient,
            subscription,
            options,
        );
        return new ResourceClient(inner, subscription);
    }

    public get resourceGroups(): IResourceClient['resourceGroups'] {
        return { list: (options) => this.listResourceGroups(options) };
    }

    public get resources(): IResourceClient['resources'] {
        return { listByResourceGroup: (resourceGroupName, options) => this.listResources(resourceGroupName, options) };
    }

    private listResourceGroups(options?: ResourceGroupsListOptionalParams): AsyncIterable<Page<ResourceGroup>> {
        return toPages(
            this.inner.resourceGroups.list(options),
            ResourceClient.sdk!.getContinuationToken, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- SDK is imported during client creation
            rg => {
                const resourceGroup = attachMetadata(rg, this.subscription);
                return Object.assign(resourceGroup, {
                    groupingStrategy: 'resourceGroup' as const,
                    groupingValue: resourceGroup.name,
                });
            },
        );
    }

    private listResources(resourceGroupName: string, options?: ResourcesListOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            this.inner.resources.listByResourceGroup(resourceGroupName, options),
            ResourceClient.sdk!.getContinuationToken, // eslint-disable-line @typescript-eslint/no-non-null-assertion -- SDK is imported during client creation
            r => attachMetadata(r, this.subscription),
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
    switch (type.toLowerCase()) {
        case SiteType.toLowerCase(): {
            const kindLower = kind?.toLowerCase();
            if (kindLower?.includes('functionapp')) {
                return FunctionAppLogicalType;
            } else if (kindLower?.includes('workflowapp')) {
                return WorkflowAppLogicalType;
            } else {
                return AppServiceLogicalType;
            }
        }
        case CognitiveServicesAccountType.toLowerCase(): {
            if (kind?.toLowerCase().includes('aiservices')) {
                return AIServicesLogicalType;
            }
            return type;
        }
        default:
            return type;
    }
}
