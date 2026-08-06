/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettingsAdapter } from '@microsoft/vscode-azure-azutils';
import { IExtensionContext, IVsCode, JsoncSettingsFormat, SettingsFileSystemProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { WebAppSettingsAdapter } from './adapters/WebAppSettingsAdapter';
import { AzureSettingsDocumentSource } from './AzureSettingsDocumentSource';
import { ISettingsChangeNotifier, SettingsChangeNotifier } from './SettingsChangeNotifier';
import { ISettingsRegistry, SettingsRegistry } from './SettingsRegistry';
import { SettingsScheme } from './SettingsUri';
import { ISettingsValueVisibility, SettingsValueVisibility } from './SettingsValueVisibility';

/**
 * The file system provider serving `azure-settings:` documents.
 *
 * Exposed so {@linkcode SettingsChangeNotifier} can tell an open document to re-read after the tree
 * commands change settings behind its back.
 */
export const ISettingsFileSystem: ServiceIdentifier<SettingsFileSystemProvider> = Symbol.for('ISettingsFileSystem');

/**
 * Bind the settings framework's services.
 *
 * Adapters are bound to the shared {@linkcode ISettingsAdapter} identifier and multi-injected into
 * {@linkcode SettingsRegistry}, so supporting a new product is a one-line addition here.
 *
 * The file system provider is bound (rather than constructed inline) so it stays reachable for
 * invalidation and disposal.
 */
export function bindSettingsServices(container: Container): void {
    container.bind(ISettingsAdapter).to(WebAppSettingsAdapter).inSingletonScope();

    container.bind(ISettingsRegistry).to(SettingsRegistry).inSingletonScope();
    container.bind(ISettingsValueVisibility).to(SettingsValueVisibility).inSingletonScope();
    container.bind(AzureSettingsDocumentSource).toSelf().inSingletonScope();

    container.bind(ISettingsFileSystem).toDynamicValue(context => new SettingsFileSystemProvider(
        context.get(IVsCode),
        context.get(AzureSettingsDocumentSource),
        new JsoncSettingsFormat(context.get(IVsCode)),
    )).inSingletonScope();

    container.bind(ISettingsChangeNotifier).to(SettingsChangeNotifier).inSingletonScope();
}

/**
 * Register the file system providers that serve settings documents.
 *
 * Called during activation, after the trees are registered, because the Azure document source
 * resolves resources by drilling the resource tree.
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
