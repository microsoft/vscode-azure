/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureAccount, AzureSubscription, AzureTenant } from '@microsoft/vscode-azext-azureauth';
import type { DataItemTree } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from './GenericResource';
import type { ResourceGroup, VirtualGroup } from './Grouping';
import type { VirtualResource } from './VirtualResource';

export type AzureNode = AzureAccount | AzureTenant | AzureSubscription | ResourceGroup | VirtualGroup | GenericResource | VirtualResource;

export type ConcreteAzureNode = Exclude<AzureNode, VirtualGroup>;
export type ConcreteAzureNodeTree = DataItemTree<ConcreteAzureNode>;

export function isAccount(node: AzureNode): node is AzureAccount {
    return 'id' in node && 'label' in node && 'environment' in node;
}

export function isTenant(node: AzureNode): node is AzureTenant {
    return 'tenantId' in node && 'account' in node && !isSubscription(node);
}

export function isSubscription(node: AzureNode): node is AzureSubscription {
    return 'subscriptionId' in node && 'tenantId' in node;
}

export function isResourceGroup(node: AzureNode): node is ResourceGroup {
    return 'groupingStrategy' in node && node.groupingStrategy === 'resourceGroup';
}

export function isVirtualGroup(node: AzureNode): node is VirtualGroup {
    return 'groupingStrategy' in node && node.groupingStrategy !== 'resourceGroup';
}

/** Narrows this node to a {@link GenericResource} node. {@link ResourceGroup} nodes do **not** match, though they do conform to `GenericResource`. */
export function isGenericResource(node: AzureNode): node is GenericResource {
    return !isResourceGroup(node) && 'id' in node && 'name' in node && 'type' in node && 'logicalType' in node;
}

export function isVirtualResource(node: AzureNode): node is VirtualResource {
    return 'virtualType' in node && 'virtualPath' in node;
}
