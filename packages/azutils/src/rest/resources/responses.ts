/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored REST response types for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

import type { HttpResponse } from '@azure-rest/core-client';
import type {
    CloudErrorOutput,
    ResourceGroupListResultOutput,
    ResourceGroupOutput,
    ResourceListResultOutput,
} from './outputModels.js';

// ── ResourceGroups — List ───────────────────────────────────────────────────────

/** List resource groups — success. */
export interface ResourceGroupsList200Response extends HttpResponse {
    status: '200';
    body: ResourceGroupListResultOutput;
}

/** List resource groups — error. */
export interface ResourceGroupsListDefaultResponse extends HttpResponse {
    status: string;
    body: CloudErrorOutput;
}

// ── ResourceGroups — Get ────────────────────────────────────────────────────────

/** Get a resource group — success. */
export interface ResourceGroupsGet200Response extends HttpResponse {
    status: '200';
    body: ResourceGroupOutput;
}

/** Get a resource group — error. */
export interface ResourceGroupsGetDefaultResponse extends HttpResponse {
    status: string;
    body: CloudErrorOutput;
}

// ── Resources — List (subscription) ─────────────────────────────────────────────

/** List resources in a subscription — success. */
export interface ResourcesList200Response extends HttpResponse {
    status: '200';
    body: ResourceListResultOutput;
}

/** List resources in a subscription — error. */
export interface ResourcesListDefaultResponse extends HttpResponse {
    status: string;
    body: CloudErrorOutput;
}

// ── Resources — ListByResourceGroup ─────────────────────────────────────────────

/** List resources in a resource group — success. */
export interface ResourcesListByResourceGroup200Response extends HttpResponse {
    status: '200';
    body: ResourceListResultOutput;
}

/** List resources in a resource group — error. */
export interface ResourcesListByResourceGroupDefaultResponse extends HttpResponse {
    status: string;
    body: CloudErrorOutput;
}
