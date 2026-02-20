/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DataProvider } from '@microsoft/vscode-azure-utils';
import type { GenericResource } from '../models/GenericResource';

/**
 * Azure-specific extension of {@link DataProvider} for resources in the
 * Azure resource tree.
 */
export type AzureResourceBranchDataProvider<T extends GenericResource> = DataProvider<T>;
