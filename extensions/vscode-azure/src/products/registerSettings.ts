/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVsCode } from '@microsoft/vscode-azure-utils';
import { AddOrEditSetting } from '../commands/settings/AddOrEditSetting';
import { CopySettingValue } from '../commands/settings/CopySettingValue';
import { DeleteSetting } from '../commands/settings/DeleteSetting';
import { EditSettings } from '../commands/settings/EditSettings';
import { RenameSetting } from '../commands/settings/RenameSetting';
import { ToggleSettingValueVisibility } from '../commands/settings/ToggleSettingValueVisibility';
import type { ProductRegistrar } from '../registration/ProductRegistrar';
import { WebAppSettingsAdapter } from '../settings/adapters/WebAppSettingsAdapter';
import { AzureSettingsDocumentSource } from '../settings/AzureSettingsDocumentSource';
import { JsoncSettingsFormat } from '../settings/core/JsoncSettingsFormat';
import { SettingsFileSystemProvider } from '../settings/core/SettingsFileSystemProvider';
import { ISettingsFileSystem } from '../settings/registerSettings';
import { ISettingsAdapter } from '../settings/SettingsAdapter';
import { ISettingsChangeNotifier, SettingsChangeNotifier } from '../settings/SettingsChangeNotifier';
import { ISettingsRegistry, SettingsRegistry } from '../settings/SettingsRegistry';
import { ISettingsValueVisibility, SettingsValueVisibility } from '../settings/SettingsValueVisibility';
import { ISettingsDataProvider, SettingsDataProvider } from '../tree/resources/settings/SettingsDataProvider';
import { SettingsViewProvider } from '../tree/resources/settings/SettingsViewProvider';

/**
 * Contribute the shared settings framework: the adapters that know how to read and write each
 * product's settings, the tree nodes, the editor's file system provider, and the command set.
 *
 * Registered ahead of the generic Azure product so its providers -- which claim only the *virtual*
 * settings nodes, never the owning resource -- win dispatch. See `docs/settings.md`.
 */
export function registerSettings(registrar: ProductRegistrar): void {
    registrar.registerBinding(container => {
        // Adapters are multi-injected into the registry, so adding a product is one line here.
        container.bind(ISettingsAdapter).to(WebAppSettingsAdapter).inSingletonScope();

        container.bind(ISettingsRegistry).to(SettingsRegistry).inSingletonScope();
        container.bind(ISettingsValueVisibility).to(SettingsValueVisibility).inSingletonScope();
        container.bind(AzureSettingsDocumentSource).toSelf().inSingletonScope();

        // Bound rather than constructed inline so it stays reachable for invalidation and disposal.
        container.bind(ISettingsFileSystem).toDynamicValue(context => new SettingsFileSystemProvider(
            context.get(IVsCode),
            context.get(AzureSettingsDocumentSource),
            new JsoncSettingsFormat(context.get(IVsCode)),
        )).inSingletonScope();

        container.bind(ISettingsChangeNotifier).to(SettingsChangeNotifier).inSingletonScope();
    });

    registrar.registerCommand('vscode-azure/settings/edit', EditSettings);
    registrar.registerCommand('vscode-azure/settings/add', AddOrEditSetting, 'add');
    registrar.registerCommand('vscode-azure/settings/editValue', AddOrEditSetting, 'edit');
    registrar.registerCommand('vscode-azure/settings/rename', RenameSetting);
    registrar.registerCommand('vscode-azure/settings/delete', DeleteSetting);
    registrar.registerCommand('vscode-azure/settings/copyValue', CopySettingValue);
    registrar.registerCommand('vscode-azure/settings/toggleValues', ToggleSettingValueVisibility);

    // Aliased as a singleton so the resource-owning providers can inject it to compose their
    // settings children.
    registrar.registerResourceDataProvider([ISettingsDataProvider, SettingsDataProvider]);
    registrar.registerResourceViewProvider(SettingsViewProvider);
}
