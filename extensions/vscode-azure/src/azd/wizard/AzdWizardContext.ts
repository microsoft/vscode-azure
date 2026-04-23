/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import type { Location } from '@microsoft/vscode-azure-azutils';
import type * as vscode from 'vscode';

/** Shared wizard context for azd-backed resource creation wizards. */
export interface AzdWizardContext {
    readonly subscription?: AzureSubscription;
    readonly location?: Location;
    /** Name of the azd environment used to isolate state and resources. */
    readonly environmentName?: string;

    /** Folder that holds (or will hold) the generated `azure.yaml` and `infra/` files. */
    readonly iacFolder?: vscode.Uri;
    /** If `true`, the wizard should deploy after generating files. */
    readonly provision?: boolean;
}
