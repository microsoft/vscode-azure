/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** View id of the Azure resource tree (registered in `package.json`). */
export const AzureResourceTreeViewId = 'vscode-azure/resources';

/** View id of the workspace (local items) tree (registered in `package.json`). */
export const WorkspaceTreeViewId = 'vscode-azure/workspace';

/** View id of the activity tree (registered in `package.json`). */
export const ActivityTreeViewId = 'vscode-azure/activity';

/** Command id for loading the next page of children in the resource tree. */
export const LoadMoreCommandId = 'vscode-azure/resources/loadMore';

/** Command id for the azd "Provision & Deploy" (azd up) command. */
export const AzdUpCommandId = 'vscode-azure/azdUp';

/** Command id for the azd "Delete Deployment" (azd down) command. */
export const AzdDownCommandId = 'vscode-azure/azdDown';

/** Top-level configuration section name used with `workspace.getConfiguration()`. */
export const ConfigurationSection = 'vscode-azure';

/**
 * Configuration section that holds the tenant/subscription filter, shared with
 * the Azure Resources extension. Entries are `tenantId/subscriptionId`
 * strings.
 */
export const SubscriptionFilterConfigurationSection = 'azureResourceGroups';

/** Configuration key (within {@linkcode SubscriptionFilterConfigurationSection}) holding the selected `tenantId/subscriptionId` entries. */
export const SelectedSubscriptionsConfigurationKey = 'selectedSubscriptions';

/** ARM tag applied by azd to resources it manages, containing the environment name. */
export const AzdEnvNameTag = 'azd-env-name';
