/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored REST parameter types for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

import type { RequestParameters } from '@azure-rest/core-client';

// ── ResourceGroups — List ───────────────────────────────────────────────────────

export interface ResourceGroupsListQueryParamProperties {
    /** The filter to apply on the operation.<br><br>You can filter by tag names and values. For example, to filter for a tag name and value, use `$filter=tagName eq 'tag1' and tagValue eq 'Value1'`. */
    $filter?: string;
    /** The number of results to return. If null is passed, returns all resource groups. */
    $top?: number;
}

export interface ResourceGroupsListQueryParam {
    queryParameters?: ResourceGroupsListQueryParamProperties;
}

/** List all resource groups in a subscription. */
export type ResourceGroupsListParameters = ResourceGroupsListQueryParam & RequestParameters;

// ── ResourceGroups — Get ────────────────────────────────────────────────────────

/** Get a resource group. */
export type ResourceGroupsGetParameters = RequestParameters;

// ── Resources — List (subscription) ─────────────────────────────────────────────

export interface ResourcesListQueryParamProperties {
    /** The filter to apply on the operation.<br><br>Filter comparison operators include `eq` (equals) and `ne` (not equals) and may be used with the following properties: `location`, `resourceType`, `name`, `resourceGroup`, `identity`, `identity/principalId`, `plan`, `plan/publisher`, `plan/product`, `plan/name`, `plan/version`, and `plan/promotionCode`.<br><br>For example, to filter by a resource type, use `$filter=resourceType eq 'Microsoft.Network/virtualNetworks'` */
    $filter?: string;
    /** Comma-separated list of additional properties to be included in the response. Valid values include `createdTime`, `changedTime` and `provisioningState`. For example, `$expand=createdTime,changedTime`. */
    $expand?: string;
    /** The number of results to return. If null is passed, returns all resources. */
    $top?: number;
}

export interface ResourcesListQueryParam {
    queryParameters?: ResourcesListQueryParamProperties;
}

/** Get all the resources in a subscription. */
export type ResourcesListParameters = ResourcesListQueryParam & RequestParameters;

// ── Resources — ListByResourceGroup ─────────────────────────────────────────────

export interface ResourcesListByResourceGroupQueryParamProperties {
    /** The filter to apply on the operation.<br><br>Filter comparison operators include `eq` (equals) and `ne` (not equals) and may be used with the following properties: `location`, `resourceType`, `name`, `resourceGroup`, `identity`, `identity/principalId`, `plan`, `plan/publisher`, `plan/product`, `plan/name`, `plan/version`, and `plan/promotionCode`.<br><br>For example, to filter by a resource type, use `$filter=resourceType eq 'Microsoft.Network/virtualNetworks'` */
    $filter?: string;
    /** Comma-separated list of additional properties to be included in the response. Valid values include `createdTime`, `changedTime` and `provisioningState`. For example, `$expand=createdTime,changedTime`. */
    $expand?: string;
    /** The number of results to return. If null is passed, returns all resources. */
    $top?: number;
}

export interface ResourcesListByResourceGroupQueryParam {
    queryParameters?: ResourcesListByResourceGroupQueryParamProperties;
}

/** Get all the resources for a resource group. */
export type ResourcesListByResourceGroupParameters = ResourcesListByResourceGroupQueryParam & RequestParameters;
