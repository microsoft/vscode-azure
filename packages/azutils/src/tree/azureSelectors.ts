/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Selector } from '@microsoft/vscode-azure-utils';
import { type ConcreteAzureNode, getNodeType, isAccount, isGenericResource, isResourceGroup, isSubscription } from '../models/AzureNode';

/**
 * Pre-canned {@linkcode Selector}s for the Azure resource tree.
 *
 * Each returns a verdict predicate over a data-layer {@linkcode ConcreteAzureNode}.
 * All comparisons are case-insensitive, per repo convention for ARM identifiers
 * and types, and all key on fields that are populated from the listing (i.e.
 * stable before enrichment), so they are safe to evaluate over partially
 * enriched nodes.
 *
 * Every selector here returns `'subtree'`: it targets a single apex node and
 * relies on the tree to evict everything beneath it. To re-render a node's
 * label without dropping its children, use `selfOnly(...)` from
 * `@microsoft/vscode-azure-utils` instead.
 *
 * @module azureSelectors
 */

/**
 * Match the {@linkcode AzureAccount} node with the given account id (and its
 * whole subtree). Used, e.g., to evict a signed-out account.
 *
 * @param accountId - The VS Code authentication account id.
 */
export function byAccount(accountId: string): Selector<ConcreteAzureNode> {
    const target = accountId.toLowerCase();
    return (node) => (isAccount(node) && node.id.toLowerCase() === target) ? 'subtree' : undefined;
}

/**
 * Match the {@linkcode AzureSubscription} node with the given subscription id
 * (and everything under it).
 *
 * @param subscriptionId - The Azure subscription id (GUID).
 */
export function bySubscription(subscriptionId: string): Selector<ConcreteAzureNode> {
    const target = subscriptionId.toLowerCase();
    return (node) => (isSubscription(node) && node.subscriptionId.toLowerCase() === target) ? 'subtree' : undefined;
}

/**
 * Match a resource node -- a {@linkcode GenericResource} or
 * {@linkcode ResourceGroup} -- by its ARM resource id (and its subtree, e.g.
 * any virtual sub-resources).
 *
 * @param armResourceId - The ARM resource id (`/subscriptions/.../...`).
 */
export function byResource(armResourceId: string): Selector<ConcreteAzureNode> {
    const target = armResourceId.toLowerCase();
    return (node) => ((isGenericResource(node) || isResourceGroup(node)) && node.id.toLowerCase() === target) ? 'subtree' : undefined;
}

/**
 * Match every node of the given logical/ARM type (and each one's subtree).
 * The type is compared against {@linkcode getNodeType}, which yields the logical
 * type for ARM resources and resource groups, the virtual type for virtual
 * sub-resources, and well-known strings for account/tenant/subscription nodes.
 *
 * Matches can occur at multiple, scattered points in the tree; each is treated
 * as an independent apex.
 *
 * @param type - The (case-insensitive) type string to match.
 */
export function byType(type: string): Selector<ConcreteAzureNode> {
    const target = type.toLowerCase();
    return (node) => (getNodeType(node).toLowerCase() === target) ? 'subtree' : undefined;
}
