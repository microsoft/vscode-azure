/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parsed representation of an Azure Resource Manager (ARM) resource ID.
 *
 * Every ARM resource ID follows the pattern:
 * ```
 * /subscriptions/{subscriptionId}[/resourceGroups/{resourceGroupName}][/providers/{namespace}/{type}/{name}[/{childType}/{childName}...]]
 * ```
 */
export interface ParsedAzureResourceId {
    /** The subscription GUID, e.g. `'aaaabbbb-cccc-...'`. */
    readonly subscriptionId: string;
    /** The resource group name, if present. `undefined` for subscription-scoped resources. */
    readonly resourceGroup: string | undefined;
    /** The provider namespace, e.g. `'Microsoft.ContainerRegistry'`. `undefined` for subscription- or resource-group-only IDs. */
    readonly provider: string | undefined;
    /** The full resource type path, e.g. `'registries'` or `'registries/replications'`. `undefined` when no provider is present. */
    readonly resourceType: string | undefined;
    /** The resource name (last name segment). `undefined` when no provider is present. */
    readonly resourceName: string | undefined;
    /** The full ARM resource ID that was parsed. */
    readonly resourceId: string;
}

/**
 * Parses an Azure Resource Manager resource ID into its constituent parts.
 *
 * Handles:
 * - Subscription-only: `/subscriptions/{id}`
 * - Resource group: `/subscriptions/{id}/resourceGroups/{name}`
 * - Subscription-scoped resources: `/subscriptions/{id}/providers/{ns}/{type}/{name}`
 * - Resource-group-scoped resources: `/subscriptions/{id}/resourceGroups/{rg}/providers/{ns}/{type}/{name}[/{child}/...]`
 *
 * @throws Error if the ID does not start with `/subscriptions/`
 *
 * @example
 * ```ts
 * const parsed = parseAzureResourceId('/subscriptions/abc/resourceGroups/myRg/providers/Microsoft.Web/sites/mySite');
 * parsed.subscriptionId  // 'abc'
 * parsed.resourceGroup   // 'myRg'
 * parsed.provider        // 'Microsoft.Web'
 * parsed.resourceType    // 'sites'
 * parsed.resourceName    // 'mySite'
 * ```
 */
export function parseAzureResourceId(resourceId: string): ParsedAzureResourceId {
    // Split into non-empty segments: ['subscriptions', '{id}', ...]
    const segments = resourceId.split('/').filter(Boolean);

    if (segments.length < 2 || segments[0].toLowerCase() !== 'subscriptions') {
        throw new Error(`Invalid ARM resource ID (expected /subscriptions/{id}): ${resourceId}`);
    }

    const subscriptionId = segments[1];
    let resourceGroup: string | undefined;
    let provider: string | undefined;
    let resourceType: string | undefined;
    let resourceName: string | undefined;

    let i = 2;

    // Optional: /resourceGroups/{name}
    if (i < segments.length && segments[i].toLowerCase() === 'resourcegroups') {
        if (i + 1 >= segments.length) {
            throw new Error(`Invalid ARM resource ID (missing resource group name): ${resourceId}`);
        }
        resourceGroup = segments[i + 1];
        i += 2;
    }

    // Optional: /providers/{namespace}/{type}/{name}[/{childType}/{childName}...]
    if (i < segments.length && segments[i].toLowerCase() === 'providers') {
        if (i + 1 >= segments.length) {
            throw new Error(`Invalid ARM resource ID (missing provider namespace): ${resourceId}`);
        }
        provider = segments[i + 1]; // e.g. Microsoft.ContainerRegistry
        i += 2;

        // Collect type/name pairs -- the type path can be nested (e.g. registries/replications)
        const typeParts: string[] = [];
        while (i + 1 < segments.length) {
            typeParts.push(segments[i]);
            resourceName = segments[i + 1];
            i += 2;
        }
        if (typeParts.length > 0) {
            resourceType = typeParts.join('/');
        }
    }

    return { subscriptionId, resourceGroup, provider, resourceType, resourceName, resourceId: resourceId };
}

/**
 * Extracts the subscription ARM ID (`/subscriptions/{id}`) from a full ARM resource ID.
 */
export function getSubscriptionArmId(resourceId: string): string {
    const { subscriptionId } = parseAzureResourceId(resourceId);
    return `/subscriptions/${subscriptionId}`;
}

/**
 * Extracts the resource group ARM ID from a full ARM resource ID.
 * @throws Error if the ID has no resource group segment.
 */
export function getResourceGroupArmId(resourceId: string): string {
    const parsed = parseAzureResourceId(resourceId);
    if (!parsed.resourceGroup) {
        throw new Error(`ARM resource ID does not contain a resource group: ${resourceId}`);
    }
    return `/subscriptions/${parsed.subscriptionId}/resourceGroups/${parsed.resourceGroup}`;
}
