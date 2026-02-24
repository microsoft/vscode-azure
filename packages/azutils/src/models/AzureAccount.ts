/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Environment } from '@azure/ms-rest-azure-env';
import type { AzureAccount as UpstreamAzureAccount } from '@microsoft/vscode-azext-azureauth';

/**
 * TODO: temporary class until we make this change to the auth package
 */
export interface AzureAccount extends UpstreamAzureAccount {
    environment: Environment;
}
