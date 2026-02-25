/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { Disposable, IExtensionContext } from '@microsoft/vscode-azure-utils';
import type { ResolutionContext, ServiceIdentifier } from 'inversify';
import type * as vscode from 'vscode';

/** Identifier for the Azure subscription provider */
export const IAzureSubscriptionProvider: ServiceIdentifier<AzureSubscriptionProvider> = Symbol.for('IAzureSubscriptionProvider');

/** Identifier for the Azure resource VSCode tree view */
export const IAzureResourceTreeView: ServiceIdentifier<vscode.TreeView<string>> = Symbol.for('IAzureResourceTreeView');

/**
 * An activation callback that pushes a disposable service to the extension context's subscriptions.
 * Use with `.onActivation(pushDisposable)` at the end of a binding chain.
 */
export function pushDisposable<T>(context: ResolutionContext, injectable: T): T {
    if (Disposable.test(injectable)) {
        context.get(IExtensionContext).subscriptions.push(injectable);
    }
    return injectable;
}
