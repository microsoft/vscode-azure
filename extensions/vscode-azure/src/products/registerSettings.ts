/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionContext, IVsCode } from '@microsoft/vscode-azure-utils';
import { EditSettings } from '../commands/settings/EditSettings';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { pushDisposable } from '../services';
import { SettingsFileSystemProvider } from '../settings/SettingsFileSystemProvider';
import { SettingsScheme } from '../settings/SettingsUri';
import { ISettingsDataProvider, SettingsDataProvider } from '../tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../tree/resources/settings/SettingsViewProvider';

/**
 * Contribute the shared settings framework: the tree node, the editor's file system provider, and
 * the edit command. Products contribute the adapters that read and write their settings.
 *
 * Registered ahead of the other products so its providers -- which claim only the *virtual* settings
 * nodes, never the owning resource -- win dispatch. See `docs/settings.md`.
 */
export function registerSettings(registrar: ProductRegistrar): void {
    registrar.registerBinding(container => {
        container.bind(SettingsFileSystemProvider).toSelf().inSingletonScope().onActivation(pushDisposable);
    });

    registrar.registerActivation(container => {
        const code = container.get(IVsCode);
        const provider = container.get(SettingsFileSystemProvider);

        container.get(IExtensionContext).subscriptions.push(
            code.workspace.registerFileSystemProvider(SettingsScheme, provider, {
                isCaseSensitive: true,
            }),
        );
    });

    registrar.registerCommand(EditSettings.CommandId, EditSettings);

    // Aliased as a singleton so the resource-owning providers can inject it to compose their
    // settings children, and so the view layer can ask it which adapter serves a resource.
    registrar.registerResourceDataProvider([ISettingsDataProvider, SettingsDataProvider]);
    registrar.registerResourceViewProvider(SettingsViewProvider);
}
