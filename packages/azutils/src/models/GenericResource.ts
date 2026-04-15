/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { GenericResource as SdkGenericResource } from '@azure/arm-resources';
import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { WithRequired } from '@microsoft/vscode-azure-utils';

/**
 * Normalized representation of an Azure resource. Every ARM resource,
 * regardless of provider, satisfies this shape. Carries a reference to the
 * owning {@linkcode AzureSubscription} for context (environment, credentials, etc.).
 */
export interface GenericResource extends WithRequired<SdkGenericResource, 'id' | 'name' | 'type' | 'location'> {
    /** The subscription that owns this resource. */
    readonly subscription: AzureSubscription;
    /** The logical type of the resource. In most cases, it is the same as the ARM resource type. */
    readonly logicalType: string;
}
