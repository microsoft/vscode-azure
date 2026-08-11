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
 * Exposed so {@linkcode SettingsChangeNotifier} can tell an open document to re-read after the tree
 * commands change settings behind its back. Bound by the settings product registration.
 */
export const ISettingsFileSystem: ServiceIdentifier<SettingsFileSystemProvider> = Symbol.for('ISettingsFileSystem');

/**
 * Register the file system provider that serves settings documents.
 *
 * Separate from the product's declarative bindings because it must run during activation, *after*
 * the trees are registered: resolving the provider constructs the document source, which drills the
 * resource tree to turn a URI back into a resource.
 */
export function registerSettingsFileSystem(container: Container): void {
    const code = container.get(IVsCode);
    const subscriptions = container.get(IExtensionContext).subscriptions;

    const provider = container.get(ISettingsFileSystem);
    subscriptions.push(
        provider,
        code.workspace.registerFileSystemProvider(SettingsScheme, provider, {
            // Setting names are case-sensitive in Azure, and so are the ARM ids packed into the
            // path, so the provider must not fold case.
            isCaseSensitive: true,
        }),
    );
}
