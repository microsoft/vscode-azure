/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import {
    ManageStaticWebAppAppSetting,
    ToggleStaticWebAppAppSettingVisibility,
    TransferStaticWebAppAppSettings,
    validateStaticWebAppSettingName,
} from '../../../src/commands/staticWebApps/StaticWebAppAppSettingsCommands';
import { StaticWebAppCommandResolver } from '../../../src/commands/staticWebApps/StaticWebAppCommandResolver';
import {
    StaticWebAppVirtualTypes,
    type StaticWebAppAppSetting,
    type StaticWebAppAppSettingsGroup,
} from '../../../src/tree/resources/staticWebApps/StaticWebApp';
import { makeStaticWebApp } from '../../tree/resources/staticWebApps/mockStaticWebApp';

describe('Static Web Apps app-settings commands (unit)', () => {
    function createHarness(resource: StaticWebAppAppSettingsGroup | StaticWebAppAppSetting) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const invalidate = mock.fn();
        const cache = {
            get: mock.fn((key: string) => key === 'key' ? resource : undefined),
            invalidate,
        };
        const resolver = new StaticWebAppCommandResolver(ctx, cache as never, { select: mock.fn() } as never);
        const provider = {
            getAppSettings: mock.fn(() => Promise.resolve<Record<string, string>>({ EXISTING: 'old' })),
            getAppSettingValue: mock.fn(() => 'old'),
            addOrUpdateAppSetting: mock.fn((_group: unknown, _key: string, _value: string) => Promise.resolve()),
            renameAppSetting: mock.fn((_group: unknown, _oldKey: string, _newKey: string) => Promise.resolve(true)),
            deleteAppSetting: mock.fn((_group: unknown, _key: string) => Promise.resolve()),
            replaceAppSettings: mock.fn((_group: unknown, _settings: Record<string, string>) => Promise.resolve()),
            toggleAppSettingVisibility: mock.fn((_group: unknown, _key: string) => true),
        };
        return { ctx, mockResult, invalidate, resolver, provider };
    }

    it('should reject duplicate and reserved setting names', () => {
        const { ctx } = createMockCodeContext();
        expect(validateStaticWebAppSettingName(ctx.code, 'existing', { EXISTING: 'value' }))
            .to.equal('An app setting with this name already exists.');
        expect(validateStaticWebAppSettingName(ctx.code, 'FUNCTIONS_WORKER_RUNTIME', {}))
            .to.equal('This setting name is reserved by the Azure Static Web Apps platform.');
    });

    it('should add and rename settings without placing values in resource data', async () => {
        const group = makeGroup();
        const addHarness = createHarness(group);
        respondToPrompts(addHarness.mockResult, [{ input: 'NEW_SETTING' }, { input: 'new-secret' }]);
        await new ManageStaticWebAppAppSetting(
            addHarness.ctx,
            addHarness.resolver,
            addHarness.provider as never,
        ).execute('add', 'key');
        expect(addHarness.provider.addOrUpdateAppSetting.mock.calls[0].arguments.slice(1)).to.deep.equal([
            'NEW_SETTING',
            'new-secret',
        ]);
        expect(addHarness.invalidate.mock.calls[0].arguments[0]).to.equal(group);

        const setting = makeSetting(group);
        const renameHarness = createHarness(setting);
        respondToPrompts(renameHarness.mockResult, [{ input: 'RENAMED' }]);
        await new ManageStaticWebAppAppSetting(
            renameHarness.ctx,
            renameHarness.resolver,
            renameHarness.provider as never,
        ).execute('rename', 'key');
        expect(renameHarness.provider.renameAppSetting.mock.calls[0].arguments.slice(1)).to.deep.equal([
            'EXISTING',
            'RENAMED',
        ]);
    });

    it('should download settings into local.settings.json shape', async () => {
        const group = makeGroup();
        const harness = createHarness(group);
        harness.provider.getAppSettings.mock.mockImplementation(() => Promise.resolve({ REMOTE: 'secret' }));
        const destination = harness.mockResult.vscode.Uri.file('/workspace/local.settings.json');
        harness.mockResult.window.showSaveDialog.mock.mockImplementation(() => Promise.resolve(destination));
        const command = new TransferStaticWebAppAppSettings(
            createActionContext('test'),
            harness.ctx,
            new MockOutputChannel('test'),
            harness.resolver,
            harness.provider as never,
        );

        await command.execute('download', 'key');

        const downloaded = JSON.parse(new TextDecoder().decode(harness.mockResult.fs.files.get(destination.path))) as {
            readonly IsEncrypted: boolean;
            readonly Values: Record<string, string>;
        };
        expect(downloaded).to.deep.equal({ IsEncrypted: false, Values: { REMOTE: 'secret' } });
    });

    it('should validate upload shape, exclude reserved values, merge, and invalidate', async () => {
        const group = makeGroup();
        const harness = createHarness(group);
        harness.provider.getAppSettings.mock.mockImplementation(() => Promise.resolve({ REMOTE: 'old' }));
        const source = harness.mockResult.vscode.Uri.file('/workspace/local.settings.json');
        harness.mockResult.fs.addFile(source, JSON.stringify({
            IsEncrypted: false,
            Values: {
                LOCAL: 'new',
                // eslint-disable-next-line @typescript-eslint/naming-convention -- Azure Functions platform setting
                FUNCTIONS_WORKER_RUNTIME: 'node',
            },
        }));
        harness.mockResult.window.showOpenDialog.mock.mockImplementation(() => Promise.resolve([source]));
        const context = createActionContext('test');
        const command = new TransferStaticWebAppAppSettings(
            context,
            harness.ctx,
            new MockOutputChannel('test'),
            harness.resolver,
            harness.provider as never,
        );

        await command.execute('upload', 'key');

        expect(harness.provider.replaceAppSettings.mock.calls[0].arguments[1]).to.deep.equal({
            REMOTE: 'old',
            LOCAL: 'new',
        });
        expect(context.telemetry.measurements.excludedSettingCount).to.equal(1);
        expect(harness.invalidate.mock.calls[0].arguments[0]).to.equal(group);
    });

    it('should report a dismissed app-settings file picker as cancellation', async () => {
        const group = makeGroup();
        const harness = createHarness(group);
        const command = new TransferStaticWebAppAppSettings(
            createActionContext('test'),
            harness.ctx,
            new MockOutputChannel('test'),
            harness.resolver,
            harness.provider as never,
        );

        let error: unknown;
        try {
            await command.execute('upload', 'key');
        } catch (caught) {
            error = caught;
        }

        expect(CancellationError.test(error)).to.equal(true);
        expect(harness.provider.replaceAppSettings.mock.callCount()).to.equal(0);
    });

    it('should toggle visibility synchronously and invalidate only the item', () => {
        const setting = makeSetting(makeGroup());
        const harness = createHarness(setting);
        const command = new ToggleStaticWebAppAppSettingVisibility(harness.resolver, harness.provider as never);

        command.execute('key');

        expect(harness.provider.toggleAppSettingVisibility.mock.callCount()).to.equal(1);
        expect(harness.invalidate.mock.callCount()).to.equal(1);
    });
});

function makeGroup(): StaticWebAppAppSettingsGroup {
    return {
        virtualType: StaticWebAppVirtualTypes.AppSettings,
        virtualPath: 'environments/default/appSettings',
        azureResource: makeStaticWebApp(),
        environmentBuildId: 'default',
        isProduction: true,
        branch: 'main',
    };
}

function makeSetting(group: StaticWebAppAppSettingsGroup): StaticWebAppAppSetting {
    return {
        virtualType: StaticWebAppVirtualTypes.AppSetting,
        virtualPath: `${group.virtualPath}/EXISTING`,
        azureResource: group.azureResource,
        environmentBuildId: group.environmentBuildId,
        isProduction: group.isProduction,
        branch: group.branch,
        settingName: 'EXISTING',
        appSettingsGroup: group,
    };
}
