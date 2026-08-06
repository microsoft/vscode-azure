/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettingsAdapter } from '@microsoft/vscode-azure-azutils';
import { IExtensionContext, IVsCode, JsoncSettingsFormat, SettingsFileSystemProvider } from '@microsoft/vscode-azure-utils';
import type { Container, ServiceIdentifier } from 'inversify';
import { WebAppSettingsAdapter } from './adapters/WebAppSettingsAdapter';
import { AzureSettingsDocumentSource } from './AzureSettingsDocumentSource';
import { LocalSettingsDocumentSource, LocalSettingsScheme } from './LocalSettingsDocumentSource';
import { ILocalSettingsResolver, LocalSettingsResolver } from './LocalSettingsResolver';
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

/** The file system provider serving `azure-settings-local:` documents. */
const ILocalSettingsFileSystem: ServiceIdentifier<SettingsFileSystemProvider> = Symbol.for('ILocalSettingsFileSystem');

/**
 * Bind the settings framework's services.
 *
 * Adapters are bound to the shared {@linkcode ISettingsAdapter} identifier and multi-injected into
 * {@linkcode SettingsRegistry}, so supporting a new product is a one-line addition here.
 *
 * The two file system providers are bound (rather than constructed inline) so they stay reachable
 * for invalidation and disposal. They differ only in their `SettingsDocumentSource`:
 * `azure-settings:` serves the collection as it exists in Azure, `azure-settings-local:` serves the
 * matching local file. Both render through the same format, which is what makes "compare with
 * local" a plain diff of two directly comparable documents.
 */
export function bindSettingsServices(container: Container): void {
    container.bind(ISettingsAdapter).to(WebAppSettingsAdapter).inSingletonScope();

    container.bind(ISettingsRegistry).to(SettingsRegistry).inSingletonScope();
    container.bind(ISettingsValueVisibility).to(SettingsValueVisibility).inSingletonScope();
    container.bind(ILocalSettingsResolver).to(LocalSettingsResolver).inSingletonScope();
    container.bind(AzureSettingsDocumentSource).toSelf().inSingletonScope();
    container.bind(LocalSettingsDocumentSource).toSelf().inSingletonScope();

    container.bind(ISettingsFileSystem).toDynamicValue(context => new SettingsFileSystemProvider(
        context.get(IVsCode),
        context.get(AzureSettingsDocumentSource),
        new JsoncSettingsFormat(context.get(IVsCode)),
    )).inSingletonScope();

    container.bind(ILocalSettingsFileSystem).toDynamicValue(context => new SettingsFileSystemProvider(
        context.get(IVsCode),
        context.get(LocalSettingsDocumentSource),
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

    for (const [scheme, id] of [
        [SettingsScheme, ISettingsFileSystem],
        [LocalSettingsScheme, ILocalSettingsFileSystem],
    ] as const) {
        const provider = container.get(id);

        subscriptions.push(
            provider,
            code.workspace.registerFileSystemProvider(scheme, provider, {
                // Setting names are case-sensitive in Azure, and so are the ARM ids packed into the
                // path, so the provider must not fold case.
                isCaseSensitive: true,
            }),
        );
    }
}
