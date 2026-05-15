/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { GenericResource } from './GenericResource';

/** ARM resource type string for resource groups */
export const ResourceGroupArmType = 'Microsoft.Resources/resourceGroups';

/**
 * Strategy used to group resources within a subscription.
 * `'resourceGroup'` maps to a real ARM resource group; the others
 * represent purely view-layer virtual groupings.
 */
export type GroupingStrategy = 'location' | 'resourceType' | 'armTag' | 'resourceGroup';

/**
 * Shared shape for any grouping node (resource group or virtual group).
 */
interface GroupingBase {
    /** The subscription that owns the grouped resources. */
    readonly subscription: AzureSubscription;
    /** The grouping strategy in use. */
    readonly groupingStrategy: GroupingStrategy;
    /** The value the grouped resources share (e.g. a location name, ARM resource type, or tag value). */
    readonly groupingValue: string;
}

/**
 * A purely view-layer grouping of resources -- never a real ARM
 * resource. Excludes `'resourceGroup'`, which is handled by
 * {@linkcode ResourceGroup}.
 */
export type VirtualGroup = GroupingBase & { readonly groupingStrategy: Exclude<GroupingStrategy, 'resourceGroup'> };

/**
 * An Azure resource group node. Resource groups are both a grouping
 * concept and a real ARM resource, so this type extends both
 * {@linkcode GroupingBase} and {@linkcode GenericResource}.
 */
export type ResourceGroup = GroupingBase & { readonly groupingStrategy: 'resourceGroup' } & GenericResource;
