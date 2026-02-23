/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { GenericResource } from './GenericResource';

interface GroupingBase {
    readonly subscription: AzureSubscription;
    readonly groupingStrategy: string;
    readonly groupingValue: string;
}

export type VirtualGroup = GroupingBase & { readonly groupingStrategy: 'location' | 'resourceType' | 'armTag' };
export type ResourceGroup = GroupingBase & { readonly groupingStrategy: 'resourceGroup' } & GenericResource;
