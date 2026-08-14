/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import type { SettingsFileSystemProvider } from './core/SettingsFileSystemProvider';
import { SettingsScheme } from './SettingsUri';

/**
 * The file system provider serving `azure-settings:` documents.
 *
 * Bound by the settings product registration, which also arranges the provider's own disposal via
 * `pushDisposable`. Resolved during activation to attach it to the workspace.
 */
export const ISettingsFileSystem: ServiceIdentifier<SettingsFileSystemProvider> = Symbol.for('ISettingsFileSystem');

/**
 * Register the file system provider that serves settings documents.
 *
 * Separate from the product's declarative bindings because it must run during activation, *after*
 * the trees are registered: resolving the provider constructs the document source, which resolves a
 * URI against the resource tree.
 */
export function registerSettingsFileSystem(container: Container): void {
    const code = container.get(IVsCode);

    // Resolving the provider is what pushes it onto the extension's subscriptions, via the
    // binding's `onActivation(pushDisposable)`. Only the registration itself is pushed here.
    const provider = container.get(ISettingsFileSystem);

    container.get(IExtensionContext).subscriptions.push(
        code.workspace.registerFileSystemProvider(SettingsScheme, provider, {
            // Setting names are case-sensitive in Azure, and so are the ARM ids packed into the
            // path, so the provider must not fold case.
            isCaseSensitive: true,
        }),
    );
}
