/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hand-authored isUnexpected type guard for Microsoft.Resources.
// Follows the same pattern as @azure-rest/arm-appservice.

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

/** Determines whether the response is an error (unexpected status code). */
export function isUnexpected(
    response: ResourceGroupsList200Response | ResourceGroupsListDefaultResponse,
): response is ResourceGroupsListDefaultResponse;

/** Determines whether the response is an error (unexpected status code). */
export function isUnexpected(
    response: ResourceGroupsGet200Response | ResourceGroupsGetDefaultResponse,
): response is ResourceGroupsGetDefaultResponse;

/** Determines whether the response is an error (unexpected status code). */
export function isUnexpected(
    response: ResourcesList200Response | ResourcesListDefaultResponse,
): response is ResourcesListDefaultResponse;

/** Determines whether the response is an error (unexpected status code). */
export function isUnexpected(
    response: ResourcesListByResourceGroup200Response | ResourcesListByResourceGroupDefaultResponse,
): response is ResourcesListByResourceGroupDefaultResponse;

export function isUnexpected(response: { status: string }): boolean {
    // All success statuses for this API are 2xx. Any non-2xx response is unexpected.
    return !response.status.startsWith('2');
}
