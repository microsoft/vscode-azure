/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { Location } from '@microsoft/vscode-azure-azutils';

export interface AzdWizardContext {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    readonly environmentName?: string;

    readonly appName?: string;

    readonly iacFolder?: string; // TODO: vscode.Uri?
    readonly provision?: boolean;
}
