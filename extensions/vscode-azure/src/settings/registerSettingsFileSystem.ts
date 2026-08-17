/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type { Container } from 'inversify';
import { SettingsFileSystemProvider } from './SettingsFileSystemProvider';
import { SettingsScheme } from './SettingsUri';

/**
 * Attach the settings file system provider to the workspace.
 *
 * Separate from the product's declarative bindings (`products/registerSettings.ts`, which binds
 * {@linkcode SettingsFileSystemProvider}) because it must run during activation, *after* the trees
 * are registered: the provider resolves a document URI against the resource tree.
 */
export function registerSettingsFileSystem(container: Container): void {
    const code = container.get(IVsCode);

    // Resolving the provider is what pushes it onto the extension's subscriptions, via the
    // binding's `onActivation(pushDisposable)`. Only the registration itself is pushed here.
    const provider = container.get(SettingsFileSystemProvider);

    container.get(IExtensionContext).subscriptions.push(
        code.workspace.registerFileSystemProvider(SettingsScheme, provider, {
            // Setting names are case-sensitive in Azure, and so are the ARM ids packed into the
            // path, so the provider must not fold case.
            isCaseSensitive: true,
        }),
    );
}
