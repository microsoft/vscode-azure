/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AddOrEditAppSetting } from '../../../src/commands/functions/AddOrEditAppSetting';
import type { IFunctionAppDataProvider } from '../../../src/tree/resources/functions/FunctionAppDataProvider';

function createMockDataProvider() {
    const addOrUpdateSetting = mock.fn((..._args: unknown[]) => Promise.resolve());
    const getSettingValue = mock.fn((_resourceId: string, _key: string) => 'old-value');
    return {
        provider: { addOrUpdateSetting, getSettingValue } as unknown as IFunctionAppDataProvider,
        addOrUpdateSetting,
    };
}

describe('AddOrEditAppSetting (unit)', () => {
    function createCmd(options: {
        mockProvider?: ReturnType<typeof createMockDataProvider>;
        virtualType?: string;
        virtualPath?: string;
    } = {}) {
        const { mockProvider = createMockDataProvider() } = options;
        const { ctx, mock: mockResult } = createMockCodeContext();

        const cacheResource = makeVirtualResource({
            virtualType: options.virtualType ?? 'functionApp.appSettings',
            virtualPath: options.virtualPath ?? 'App Settings',
        });
        const cache = {
            get: mock.fn((key: string) => key === 'test-key' ? cacheResource : undefined),
            invalidate: mock.fn(),
        };

        const cmd = new AddOrEditAppSetting(ctx, cache as never, mockProvider.provider);
        return { cmd, mockResult, cache, mockProvider };
    }

    it('should return early when key is undefined', async () => {
        const { cmd, cache } = createCmd();
        await cmd.execute('add', undefined);
        expect(cache.get.mock.callCount()).to.equal(0);
    });

    it('should return early when resource is not found in cache', async () => {
        const { cmd } = createCmd();
        await cmd.execute('add', 'nonexistent-key');
    });

    it('should add a setting when mode is add and user provides key and value', async () => {
        const mockProvider = createMockDataProvider();
        const { cmd, mockResult } = createCmd({ mockProvider });

        respondToPrompts(mockResult, [
            { input: 'MY_SETTING' },
            { input: 'my-value' },
        ]);

        await cmd.execute('add', 'test-key');

        expect(mockProvider.addOrUpdateSetting.mock.callCount()).to.equal(1);
        expect(mockProvider.addOrUpdateSetting.mock.calls[0].arguments[1]).to.equal('MY_SETTING');
        expect(mockProvider.addOrUpdateSetting.mock.calls[0].arguments[2]).to.equal('my-value');
    });

    it('should edit a setting when mode is edit and user provides new value', async () => {
        const mockProvider = createMockDataProvider();
        const { cmd, mockResult } = createCmd({
            mockProvider,
            virtualType: 'functionApp.appSetting',
            virtualPath: 'MY_SETTING',
        });

        respondToPrompts(mockResult, [
            { input: 'new-value' },
        ]);

        await cmd.execute('edit', 'test-key');

        expect(mockProvider.addOrUpdateSetting.mock.callCount()).to.equal(1);
        expect(mockProvider.addOrUpdateSetting.mock.calls[0].arguments[1]).to.equal('MY_SETTING');
        expect(mockProvider.addOrUpdateSetting.mock.calls[0].arguments[2]).to.equal('new-value');
    });

    it('should not edit when user keeps the same value', async () => {
        const mockProvider = createMockDataProvider();
        const { cmd, mockResult } = createCmd({
            mockProvider,
            virtualType: 'functionApp.appSetting',
            virtualPath: 'MY_SETTING',
        });

        respondToPrompts(mockResult, [
            { input: 'old-value' },
        ]);

        await cmd.execute('edit', 'test-key');

        expect(mockProvider.addOrUpdateSetting.mock.callCount()).to.equal(0);
    });
});
