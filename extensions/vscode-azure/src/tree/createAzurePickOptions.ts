/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureNodeId } from '@microsoft/vscode-azure-azutils';
import type { CreateNewOption, ITreeItem, IVsCode, PickFromTreeOptions } from '@microsoft/vscode-azure-utils';

/**
 * Context values used in the standard Azure resource hierarchy that
 * represent navigable (intermediate) levels.
 */
const intermediateContextValues = new Set([
    'azureAccount',
    'azureTenant',
    'azureSubscription',
    'azureResourceGroup',
    'azureVirtualGroup',
]);

/**
 * Options for {@link createAzurePickOptions}.
 */
export interface AzurePickOverrides {
    /**
     * Title shown in the quick pick header.
     */
    readonly title?: string;

    /**
     * The `contextValue`(s) that identify the target (terminal) tree item(s).
     * Can be a single string or an array of strings.
     */
    readonly terminalContextValue: string | readonly string[];

    /**
     * When `true`, enables multi-select at the terminal level.
     */
    readonly canPickMany?: boolean;

    /**
     * When the tree is grouped by resource type, providing the target
     * resource type (e.g. `'Microsoft.Web/sites'`) allows the walker to
     * skip virtual groups that don't match, so the user doesn't have to
     * manually select the correct type group.
     *
     * The value is matched against the virtual group's label (which is
     * the decoded grouping value, e.g. `'Microsoft.Web/sites'`).
     */
    readonly targetResourceType?: string;

    /**
     * Custom placeholder text per level. If omitted, a generic default
     * is used.
     */
    readonly getPlaceholder?: (parent: string | undefined) => string;

    /**
     * Override skip-if-one behavior per level. If omitted, the default
     * is `true` except when the parent is a subscription (where we
     * always prompt so the user deliberately confirms their choice).
     */
    readonly shouldSkipIfOne?: (parent: string | undefined) => boolean;

    /**
     * Optional create-new option per level.
     */
    readonly getCreateNewOption?: (parent: string | undefined) => CreateNewOption<string> | undefined;
}

/**
 * Create a {@link PickFromTreeOptions} pre-configured for the standard
 * Azure resource hierarchy.
 *
 * The standard hierarchy levels (account, tenant, subscription, resource
 * group, virtual group) are treated as intermediate. The provided
 * `terminalContextValue` determines which tree items are valid final
 * selections.
 *
 * When {@link AzurePickOverrides.targetResourceType} is set and the tree
 * is grouped by resource type, virtual groups whose label doesn't match
 * the target type are excluded from the intermediate list -- effectively
 * auto-navigating through the type group without prompting.
 */
export function createAzurePickOptions(
    code: IVsCode,
    overrides: AzurePickOverrides,
): PickFromTreeOptions<string> {
    const terminalSet = typeof overrides.terminalContextValue === 'string'
        ? new Set([overrides.terminalContextValue])
        : new Set(overrides.terminalContextValue);

    return {
        title: overrides.title,
        canPickMany: overrides.canPickMany,

        isIntermediate(item: string, treeItem: ITreeItem): boolean {
            const ctx = treeItem.contextValue;
            if (!ctx || !intermediateContextValues.has(ctx)) {
                return false;
            }

            // When a target resource type is specified and the item is a
            // virtual group, only treat it as intermediate if it matches
            // the target type. This lets the walker skip non-matching
            // type groups automatically.
            if (overrides.targetResourceType && ctx === 'azureVirtualGroup') {
                const label = treeItemLabel(treeItem); // TODO: final label won't be the resource type
                return label === overrides.targetResourceType;
            }

            return true;
        },

        isTerminal(_item: string, treeItem: ITreeItem): boolean {
            return !!treeItem.contextValue && terminalSet.has(treeItem.contextValue);
        },

        getPlaceholder: overrides.getPlaceholder ?? ((parent) => defaultGetPlaceholder(code, parent)),

        shouldSkipIfOne: overrides.shouldSkipIfOne ?? defaultShouldSkipIfOne,

        getCreateNewOption: overrides.getCreateNewOption,
    };
}

/**
 * Default placeholder based on the parent's context.
 */
function defaultGetPlaceholder(code: IVsCode, parent: string | undefined): string {
    if (parent === undefined) {
        return code.l10n.t('Select an Azure resource');
    }

    if (!AzureNodeId.test(parent)) {
        return code.l10n.t('Select an item');
    }

    const nodeId = AzureNodeId.parse(parent);
    if (nodeId.isAccountNodeId()) {
        return code.l10n.t('Select a tenant');
    }
    if (nodeId.isTenantNodeId()) {
        return code.l10n.t('Select a subscription');
    }
    if (nodeId.isSubscriptionNodeId()) {
        return code.l10n.t('Select a resource group');
    }

    return code.l10n.t('Select a resource');
}

/**
 * Default skip-if-one: skip at every level except subscription,
 * where explicit confirmation is typically desired.
 */
function defaultShouldSkipIfOne(parent: string | undefined): boolean {
    if (parent === undefined) {
        return true;
    }

    if (!AzureNodeId.test(parent)) {
        return true;
    }

    // Don't auto-skip when the current level shows subscriptions
    // (i.e. the parent is a tenant) or resource groups (parent is a
    // subscription) -- the user should explicitly confirm these.
    const nodeId = AzureNodeId.parse(parent);
    return !nodeId.isTenantNodeId() && !nodeId.isSubscriptionNodeId();
}

/**
 * Extract a string label from an ITreeItem.
 */
function treeItemLabel(treeItem: ITreeItem): string {
    const raw = treeItem.label;
    if (typeof raw === 'string') {
        return raw;
    }
    if (raw && typeof raw === 'object' && 'label' in raw) {
        return (raw as { label: string }).label;
    }
    return '';
}
