/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored REST client definition for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

import type { Client, StreamableMethod } from '@azure-rest/core-client';

import type {
    ResourceGroupsGetParameters,
    ResourceGroupsListParameters,
    ResourcesListByResourceGroupParameters,
    ResourcesListParameters,
} from './parameters.js';

import type {
    ResourceGroupsGet200Response,
    ResourceGroupsGetDefaultResponse,
    ResourceGroupsList200Response,
    ResourceGroupsListDefaultResponse,
    ResourcesList200Response,
    ResourcesListByResourceGroup200Response,
    ResourcesListByResourceGroupDefaultResponse,
    ResourcesListDefaultResponse,
} from './responses.js';

// ── Operation interfaces ────────────────────────────────────────────────────────

/** Operations on /subscriptions/{subscriptionId}/resourcegroups */
export interface ResourceGroupsList {
    /** Gets all the resource groups for a subscription. */
    get(
        options?: ResourceGroupsListParameters,
    ): StreamableMethod<ResourceGroupsList200Response | ResourceGroupsListDefaultResponse>;
}

/** Operations on /subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName} */
export interface ResourceGroupsGet {
    /** Gets a resource group. */
    get(
        options?: ResourceGroupsGetParameters,
    ): StreamableMethod<ResourceGroupsGet200Response | ResourceGroupsGetDefaultResponse>;
}

/** Operations on /subscriptions/{subscriptionId}/resources */
export interface ResourcesList {
    /** Get all the resources in a subscription. */
    get(
        options?: ResourcesListParameters,
    ): StreamableMethod<ResourcesList200Response | ResourcesListDefaultResponse>;
}

/** Operations on /subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/resources */
export interface ResourcesListByResourceGroup {
    /** Get all the resources for a resource group. */
    get(
        options?: ResourcesListByResourceGroupParameters,
    ): StreamableMethod<ResourcesListByResourceGroup200Response | ResourcesListByResourceGroupDefaultResponse>;
}

// ── Routes ──────────────────────────────────────────────────────────────────────

export interface Routes {
    /** Resource for '/subscriptions/\{subscriptionId\}/resourcegroups' has methods for the following verbs: get */
    (path: '/subscriptions/{subscriptionId}/resourcegroups', subscriptionId: string): ResourceGroupsList;

    /** Resource for '/subscriptions/\{subscriptionId\}/resourcegroups/\{resourceGroupName\}' has methods for the following verbs: get */
    (
        path: '/subscriptions/{subscriptionId}/resourcegroups/{resourceGroupName}',
        subscriptionId: string,
        resourceGroupName: string,
    ): ResourceGroupsGet;

    /** Resource for '/subscriptions/\{subscriptionId\}/resources' has methods for the following verbs: get */
    (path: '/subscriptions/{subscriptionId}/resources', subscriptionId: string): ResourcesList;

    /** Resource for '/subscriptions/\{subscriptionId\}/resourceGroups/\{resourceGroupName\}/resources' has methods for the following verbs: get */
    (
        path: '/subscriptions/{subscriptionId}/resourceGroups/{resourceGroupName}/resources',
        subscriptionId: string,
        resourceGroupName: string,
    ): ResourcesListByResourceGroup;
}

// ── Client ──────────────────────────────────────────────────────────────────────

/** A client for the Microsoft.Resources API. */
export type ResourceClient = Client & {
    path: Routes;
};
