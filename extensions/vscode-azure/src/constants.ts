/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Fully-qualified extension id (`<publisher>.<name>`) as declared in `package.json`. */
export const ExtensionId = 'ms-azuretools.vscode-azure';

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
 * Configuration key (within {@linkcode ConfigurationSection}) holding the
 * tenant/subscription filter as an array of `tenantId/subscriptionId` strings.
 */
export const SelectedSubscriptionsConfigurationKey = 'selectedSubscriptions';

/**
 * Configuration key (within {@linkcode ConfigurationSection}) holding the
 * tenants the user signed in to by manually entering a tenant id.
 */
export const SignedInTenantsConfigurationKey = 'signedInTenants';

/** ARM tag applied by azd to resources it manages, containing the environment name. */
export const AzdEnvNameTag = 'azd-env-name';

/**
 * Property key under which a data provider attaches a resource's browsable
 * website URL during enrichment.
 *
 * A symbol is used so the property cannot collide with an ARM property and so
 * view providers can detect it exactly, without inspecting the resource type.
 * Read and write it through the helpers in `tree/resources/websiteUrl.ts`.
 */
export const WebsiteUrl: unique symbol = Symbol.for('vscode-azure.websiteUrl');

/**
 * Matches a canonical GUID (e.g. `aaaabbbb-cccc-dddd-eeee-ffff00001111`),
 * anchored and case-insensitive.
 */
export const GuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
