/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ResourceGroupsListOptionalParams,
    ResourcesListByResourceGroupOptionalParams,
} from '@azure/arm-resources';
/* eslint-disable @typescript-eslint/no-restricted-imports -- The new-style SDK actually bundles smaller if it is eagerly imported */
import { type ResourceManagementClientOptionalParams, type ResourceManagementContext, createResourceManagement } from '@azure/arm-resources/api';
import { list as sdkListResourceGroups } from '@azure/arm-resources/api/resourceGroups';
import { listByResourceGroup as sdkListByResourceGroup } from '@azure/arm-resources/api/resources';
/* eslint-enable @typescript-eslint/no-restricted-imports */
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { AsyncFactory, IActionExecutor, ICodeContext, Page } from '@microsoft/vscode-azure-utils';
import type { ServiceIdentifier } from 'inversify';
import type { GenericResource } from '../../models/GenericResource';
import type { ResourceGroup } from '../../models/Grouping';
import { createAzureRestSubscriptionClient } from '../createAzureClient';
import { toPages } from '../toPages';

/** ARM resource type string for App Service-family resources (`Microsoft.Web/sites`). */
export const SiteType = 'Microsoft.Web/sites';
/** Logical type assigned to function apps (`Microsoft.Web/sites` with `kind` containing `functionapp`). */
export const FunctionAppLogicalType = `${SiteType}~functionapp`;
/** Logical type assigned to Logic Apps (Standard) (`Microsoft.Web/sites` with `kind` containing `workflowapp`). */
export const WorkflowAppLogicalType = `${SiteType}~workflowapp`;
/** Logical type assigned to App Service web apps (any other `Microsoft.Web/sites` kind). */
export const AppServiceLogicalType = `${SiteType}~app`;

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
        subscription: AzureSubscription,
        options?: ResourceManagementClientOptionalParams,
    ): Promise<ResourceClient> {
        const context = createAzureRestSubscriptionClient(
            ctx,
            executor,
            createResourceManagement,
            subscription,
            options,
        );
        return Promise.resolve(new ResourceClient(context, subscription));
    }

    public get resourceGroups(): IResourceClient['resourceGroups'] {
        return { list: (options) => this.listResourceGroups(options) };
    }

    public get resources(): IResourceClient['resources'] {
        return { listByResourceGroup: (resourceGroupName, options) => this.listResources(resourceGroupName, options) };
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
            },
        );
    }

    private listResources(resourceGroupName: string, options?: ResourcesListByResourceGroupOptionalParams): AsyncIterable<Page<GenericResource>> {
        return toPages(
            sdkListByResourceGroup(this.inner, resourceGroupName, options),
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
        default:
            return type;
    }
}
