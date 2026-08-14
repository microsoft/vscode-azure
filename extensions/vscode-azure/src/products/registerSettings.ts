/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { EditSettings } from '../commands/settings/EditSettings';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { AzureSettingsDocumentSource } from '../settings/AzureSettingsDocumentSource';
import { SettingsFileSystemProvider } from '../settings/core/SettingsFileSystemProvider';
import { ISettingsFileSystem } from '../settings/registerSettings';
import { ISettingsRegistry, SettingsRegistry } from '../settings/SettingsRegistry';
import { pushDisposable } from '../services';
import { ISettingsDataProvider, SettingsDataProvider } from '../tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../tree/resources/settings/SettingsViewProvider';

/**
 * Contribute the shared settings framework: the adapters that know how to read and write each
 * product's settings, the tree node, the editor's file system provider, and the edit command.
 *
 * Registered ahead of the other products so its providers -- which claim only the *virtual* settings
 * nodes, never the owning resource -- win dispatch. See `docs/settings.md`.
 */
export function registerSettings(registrar: ProductRegistrar): void {
    registrar.registerBinding(container => {
        container.bind(ISettingsRegistry).to(SettingsRegistry).inSingletonScope();
        container.bind(AzureSettingsDocumentSource).toSelf().inSingletonScope();

        // Bound rather than constructed inline so `pushDisposable` handles its disposal.
        container.bind(ISettingsFileSystem).toDynamicValue(context => new SettingsFileSystemProvider(
            context.get(IVsCode),
            context.get(AzureSettingsDocumentSource),
        )).inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerCommand(EditSettings.CommandId, EditSettings);

    // Aliased as a singleton so the resource-owning providers can inject it to compose their
    // settings children.
    registrar.registerResourceDataProvider([ISettingsDataProvider, SettingsDataProvider]);
    registrar.registerResourceViewProvider(SettingsViewProvider);
}
