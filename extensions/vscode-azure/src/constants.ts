/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** View id of the Azure resource tree (registered in `package.json`). */
export const AzureResourceTreeViewId = 'vscode-azure/resources';

/** View id of the activity tree (registered in `package.json`). */
export const ActivityTreeViewId = 'vscode-azure/activity';

/** Command id for loading the next page of children in the resource tree. */
export const LoadMoreCommandId = 'vscode-azure/resources/loadMore';

/** Top-level configuration section name used with `workspace.getConfiguration()`. */
export const ConfigurationSection = 'vscode-azure';

/** ARM tag applied by azd to resources it manages, containing the environment name. */
export const AzdEnvNameTag = 'azd-env-name';
