/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { Location } from '@microsoft/vscode-azure-azutils';

export interface AzdWizardContext<T = unknown> {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    readonly environmentName?: string;

    readonly appName?: string;
    readonly bicepOptions?: T;

    readonly iacFolder?: string; // TODO: vscode.Uri?
    readonly provision?: boolean;
}
