/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, IActionContext, ICodeContext, IOutputChannel, selfOnly, showSmartInputBox } from '@microsoft/vscode-azure-utils';
import { inject, injectable } from 'inversify';
import type * as vscode from 'vscode';
import {
    StaticWebAppVirtualTypes,
    type StaticWebAppAppSetting,
    type StaticWebAppAppSettingsGroup,
    type StaticWebAppVirtualNode,
} from '../../tree/resources/staticWebApps/StaticWebApp';
import { IStaticWebAppDataProvider } from '../../tree/resources/staticWebApps/StaticWebAppDataProvider';
import type { ManagedCommand } from '../ManagedCommand';
import { StaticWebAppCommandResolver } from './StaticWebAppCommandResolver';

type AppSettingMode = 'add' | 'edit' | 'rename' | 'delete';
type TransferMode = 'download' | 'upload';

const localSettingsFileName = 'local.settings.json';
const reservedSettingPrefixes: readonly RegExp[] = [
    /^APPSETTING_/i,
    /^AZUREBLOBSTORAGE_/i,
    /^AZUREFILESSTORAGE_/i,
    /^AZURE_FUNCTION_/i,
    /^CONTAINER_/i,
    /^DIAGNOSTICS_/i,
    /^DOCKER_/i,
    /^FUNCTIONS_/i,
    /^IDENTITY_/i,
    /^MACHINEKEY_/i,
    /^MAINSITE_/i,
    /^MSDEPLOY_/i,
    /^SCMSITE_/i,
    /^SCM_/i,
    /^WEBSITES_/i,
    /^WEBSITE_/i,
    /^WEBSOCKET_/i,
    /^AzureWeb/i,
];

/** Adds, edits, renames, and deletes Static Web Apps function app settings. */
@injectable()
export class ManageStaticWebAppAppSetting implements ManagedCommand {
    /** Context value for the add command on an app-settings group. */
    public static readonly AddContextValue = 'addStaticWebAppSetting';
    /** Context value for the edit command on an app-setting item. */
    public static readonly EditContextValue = 'editStaticWebAppSetting';
    /** Context value for the rename command on an app-setting item. */
    public static readonly RenameContextValue = 'renameStaticWebAppSetting';
    /** Context value for the delete command on an app-setting item. */
    public static readonly DeleteContextValue = 'deleteStaticWebAppSetting';

    public constructor(
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppDataProvider) private readonly provider: IStaticWebAppDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(mode: AppSettingMode, key?: string): Promise<void> {
        if (mode === 'add') {
            const group = this.resolver.resolveVirtual<StaticWebAppAppSettingsGroup>(key, isAppSettingsGroup);
            await this.add(group);
            return;
        }

        const setting = this.resolver.resolveVirtual<StaticWebAppAppSetting>(key, isAppSetting);
        switch (mode) {
            case 'edit':
                await this.edit(setting);
                break;
            case 'rename':
                await this.rename(setting);
                break;
            case 'delete':
                await this.delete(setting);
                break;
        }
    }

    private async add(group: StaticWebAppAppSettingsGroup): Promise<void> {
        const current = await this.provider.getAppSettings(group);
        const settingName = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the app setting name'),
            placeHolder: this.ctx.code.l10n.t('e.g., MY_SETTING'),
            validateInput: value => validateStaticWebAppSettingName(this.ctx.code, value, current),
        });
        const settingValue = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter the value for \'{0}\'', settingName),
            password: true,
        });

        await this.provider.addOrUpdateAppSetting(group, settingName.trim(), settingValue);
        this.resolver.dataTree.invalidate(group);
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Added app setting \'{0}\'.', settingName.trim()));
    }

    private async edit(setting: StaticWebAppAppSetting): Promise<void> {
        let current = this.provider.getAppSettingValue(setting.appSettingsGroup, setting.settingName);
        if (current === undefined) {
            const allSettings = await this.provider.getAppSettings(setting.appSettingsGroup);
            if (!Object.hasOwn(allSettings, setting.settingName)) {
                throw new Error(this.ctx.code.l10n.t('The selected app setting no longer exists.'));
            }
            current = allSettings[setting.settingName];
        }

        const updated = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter a new value for \'{0}\'', setting.settingName),
            password: true,
            value: current,
        });
        if (updated === current) {
            return;
        }

        await this.provider.addOrUpdateAppSetting(setting.appSettingsGroup, setting.settingName, updated);
        this.resolver.dataTree.invalidate(setting.appSettingsGroup);
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Updated app setting \'{0}\'.', setting.settingName));
    }

    private async rename(setting: StaticWebAppAppSetting): Promise<void> {
        const current = await this.provider.getAppSettings(setting.appSettingsGroup);
        const newName = await showSmartInputBox(this.ctx, {
            prompt: this.ctx.code.l10n.t('Enter a new name for \'{0}\'', setting.settingName),
            value: setting.settingName,
            validateInput: value => validateStaticWebAppSettingName(this.ctx.code, value, current, setting.settingName),
        });
        const trimmedName = newName.trim();
        if (trimmedName === setting.settingName) {
            return;
        }

        if (!await this.provider.renameAppSetting(setting.appSettingsGroup, setting.settingName, trimmedName)) {
            throw new Error(this.ctx.code.l10n.t('The selected app setting no longer exists.'));
        }
        this.resolver.dataTree.invalidate(setting.appSettingsGroup);
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Renamed the app setting.'));
    }

    private async delete(setting: StaticWebAppAppSetting): Promise<void> {
        const deleteLabel = this.ctx.code.l10n.t('Delete');
        const confirmation = await this.ctx.code.window.showWarningMessage(
            this.ctx.code.l10n.t('Are you sure you want to delete app setting \'{0}\'?', setting.settingName),
            { modal: true },
            deleteLabel,
        );
        if (confirmation !== deleteLabel) {
            throw new CancellationError(undefined, 'Confirm Static Web Apps app setting deletion');
        }

        await this.provider.deleteAppSetting(setting.appSettingsGroup, setting.settingName);
        this.resolver.dataTree.invalidate(setting.appSettingsGroup);
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Deleted app setting \'{0}\'.', setting.settingName));
    }
}

/** Downloads or uploads Static Web Apps settings through local JSON files. */
@injectable()
export class TransferStaticWebAppAppSettings implements ManagedCommand {
    /** Context value for downloading a settings group. */
    public static readonly DownloadContextValue = 'downloadStaticWebAppSettings';
    /** Context value for uploading a settings group. */
    public static readonly UploadContextValue = 'uploadStaticWebAppSettings';

    public constructor(
        @inject(IActionContext) private readonly context: IActionContext,
        @inject(ICodeContext) private readonly ctx: ICodeContext,
        @inject(IOutputChannel) private readonly output: IOutputChannel,
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppDataProvider) private readonly provider: IStaticWebAppDataProvider,
    ) { }

    /** @inheritdoc */
    public async execute(mode: TransferMode, key?: string): Promise<void> {
        const group = this.resolver.resolveVirtual<StaticWebAppAppSettingsGroup>(key, isAppSettingsGroup);
        if (mode === 'download') {
            await this.download(group);
        } else {
            await this.upload(group);
        }
    }

    private async download(group: StaticWebAppAppSettingsGroup): Promise<void> {
        const destination = await this.ctx.code.window.showSaveDialog({
            defaultUri: this.defaultLocalSettingsUri(),
            filters: { JSON: ['json'] },
            saveLabel: this.ctx.code.l10n.t('Download'),
            title: this.ctx.code.l10n.t('Select the destination file for downloaded settings.'),
        });
        if (!destination) {
            throw new CancellationError(undefined, 'Select app settings download destination');
        }

        const local = await this.readLocalSettingsIfPresent(destination) ?? { IsEncrypted: false, Values: {} };
        const remote = await this.provider.getAppSettings(group);
        if (hasConflictingValues(remote, local.Values)) {
            const overwriteLabel = this.ctx.code.l10n.t('Overwrite');
            const response = await this.ctx.code.window.showWarningMessage(
                this.ctx.code.l10n.t('Some downloaded settings already exist locally. Overwrite their values?'),
                { modal: true },
                overwriteLabel,
            );
            if (response !== overwriteLabel) {
                throw new CancellationError(undefined, 'Confirm local app settings overwrite');
            }
        }

        const content: LocalSettingsFile = { ...local, IsEncrypted: false, Values: { ...local.Values, ...remote } };
        await this.ctx.code.workspace.fs.writeFile(destination, new TextEncoder().encode(`${JSON.stringify(content, null, 4)}\n`));
        this.output.info('Static Web Apps settings download completed.');
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Successfully downloaded app settings.'));
    }

    private async upload(group: StaticWebAppAppSettingsGroup): Promise<void> {
        const selected = await this.ctx.code.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: this.defaultLocalSettingsUri(),
            filters: { JSON: ['json'] },
            openLabel: this.ctx.code.l10n.t('Upload'),
            title: this.ctx.code.l10n.t('Select the local settings file to upload.'),
        });
        const source = selected?.[0];
        if (!source) {
            throw new CancellationError(undefined, 'Select app settings upload source');
        }

        const local = parseLocalSettings(
            this.ctx.code,
            new TextDecoder().decode(await this.ctx.code.workspace.fs.readFile(source)),
        );
        const entries = Object.entries(local.Values);
        const uploadable = Object.fromEntries(entries.filter(([name]) => !isReservedSetting(name)));
        this.context.telemetry.measurements.excludedSettingCount = entries.length - Object.keys(uploadable).length;
        if (Object.keys(uploadable).length === 0) {
            throw new Error(this.ctx.code.l10n.t('The selected file contains no settings that can be uploaded.'));
        }

        const remote = await this.provider.getAppSettings(group);
        if (hasConflictingValues(uploadable, remote)) {
            const uploadLabel = this.ctx.code.l10n.t('Upload');
            const response = await this.ctx.code.window.showWarningMessage(
                this.ctx.code.l10n.t('Some local settings already exist remotely. Overwrite their values?'),
                { modal: true },
                uploadLabel,
            );
            if (response !== uploadLabel) {
                throw new CancellationError(undefined, 'Confirm remote app settings overwrite');
            }
        }

        await this.provider.replaceAppSettings(group, { ...remote, ...uploadable });
        this.resolver.dataTree.invalidate(group);
        this.output.info('Static Web Apps settings upload completed.');
        void this.ctx.code.window.showInformationMessage(this.ctx.code.l10n.t('Successfully uploaded app settings.'));
    }

    private defaultLocalSettingsUri(): vscode.Uri | undefined {
        const folder = this.ctx.code.workspace.workspaceFolders?.[0];
        return folder ? this.ctx.code.Uri.joinPath(folder.uri, localSettingsFileName) : undefined;
    }

    private async readLocalSettingsIfPresent(uri: vscode.Uri): Promise<LocalSettingsFile | undefined> {
        try {
            await this.ctx.code.workspace.fs.stat(uri);
        } catch (error) {
            if ((error as { readonly code?: unknown }).code === 'FileNotFound') {
                return undefined;
            }
            throw error;
        }
        return parseLocalSettings(
            this.ctx.code,
            new TextDecoder().decode(await this.ctx.code.workspace.fs.readFile(uri)),
        );
    }
}

/** Toggles one app-setting value without asynchronous state races. */
@injectable()
export class ToggleStaticWebAppAppSettingVisibility implements ManagedCommand {
    /** Context value for the app-setting inline action. */
    public static readonly ContextValue = 'toggleStaticWebAppSettingVisibility';

    public constructor(
        @inject(StaticWebAppCommandResolver) private readonly resolver: StaticWebAppCommandResolver,
        @inject(IStaticWebAppDataProvider) private readonly provider: IStaticWebAppDataProvider,
    ) { }

    /** @inheritdoc */
    public execute(key?: string): void {
        const setting = this.resolver.resolveVirtual<StaticWebAppAppSetting>(key, isAppSetting);
        this.provider.toggleAppSettingVisibility(setting.appSettingsGroup, setting.settingName);
        this.resolver.dataTree.invalidate(selfOnly(setting));
    }
}

interface LocalSettingsFile {
    readonly IsEncrypted?: boolean;
    readonly Values: Record<string, string>;
    readonly [key: string]: unknown;
}

function isAppSettingsGroup(node: StaticWebAppVirtualNode): node is StaticWebAppAppSettingsGroup {
    return node.virtualType === StaticWebAppVirtualTypes.AppSettings;
}

function isAppSetting(node: StaticWebAppVirtualNode): node is StaticWebAppAppSetting {
    return node.virtualType === StaticWebAppVirtualTypes.AppSetting;
}

/** Validates duplicate, malformed, and platform-reserved setting names. */
export function validateStaticWebAppSettingName(
    code: ICodeContext['code'],
    value: string,
    existing: Record<string, string>,
    currentName?: string,
): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return code.l10n.t('Setting name cannot be empty.');
    } else if (trimmed.includes('=')) {
        return code.l10n.t('Setting names cannot contain \'=\'.');
    } else if (isReservedSetting(trimmed)) {
        return code.l10n.t('This setting name is reserved by the Azure Static Web Apps platform.');
    }

    const duplicate = Object.keys(existing).find(name => name.toLowerCase() === trimmed.toLowerCase()
        && name.toLowerCase() !== currentName?.toLowerCase());
    return duplicate ? code.l10n.t('An app setting with this name already exists.') : undefined;
}

function isReservedSetting(name: string): boolean {
    return reservedSettingPrefixes.some(prefix => prefix.test(name));
}

function hasConflictingValues(incoming: Record<string, string>, existing: Record<string, string>): boolean {
    return Object.entries(incoming).some(([key, value]) => Object.hasOwn(existing, key) && existing[key] !== value);
}

function parseLocalSettings(code: ICodeContext['code'], source: string): LocalSettingsFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        throw new Error(code.l10n.t('The selected settings file is not valid JSON.'));
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(code.l10n.t('The selected settings file must contain a JSON object.'));
    }

    const candidate = parsed as { readonly IsEncrypted?: unknown; readonly Values?: unknown };
    if (candidate.IsEncrypted === true) {
        throw new Error(code.l10n.t('Encrypted local settings files are not supported by this command.'));
    }
    if (!candidate.Values || typeof candidate.Values !== 'object' || Array.isArray(candidate.Values)
        || Object.values(candidate.Values).some(value => typeof value !== 'string')) {
        throw new Error(code.l10n.t('The selected settings file must contain a \'Values\' object with string values.'));
    }
    const settingNames = Object.keys(candidate.Values);
    if (new Set(settingNames.map(name => name.toLowerCase())).size !== settingNames.length) {
        throw new Error(code.l10n.t('The selected settings file contains duplicate setting names.'));
    }
    return parsed as LocalSettingsFile;
}
