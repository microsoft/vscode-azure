/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeVirtualResource } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockVsCode } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { DeleteAppSetting } from '../../../src/commands/functions/DeleteAppSetting';
import { FunctionAppVirtualTypes } from '../../../src/tree/resources/functions/FunctionApp';
import type { FunctionAppDataProvider } from '../../../src/tree/resources/functions/FunctionAppDataProvider';

describe('DeleteAppSetting (unit)', () => {
    function createCmd(options: {
        confirmResponse?: string | undefined;
        virtualType?: string;
        virtualPath?: string;
    } = {}) {
        const mockResult = createMockVsCode();
        const { vscode: code } = mockResult;

        if (options.confirmResponse !== undefined) {
            mockResult.messageResponses.push(options.confirmResponse);
        }

        const appSettingResource = makeVirtualResource({
            virtualType: options.virtualType ?? FunctionAppVirtualTypes.AppSetting,
            virtualPath: options.virtualPath ?? 'MY_SETTING',
        });

        const cache = {
            get: mock.fn((key: string) => key === 'test-key' ? appSettingResource : undefined),
            invalidate: mock.fn(),
        };

        const deleteSetting = mock.fn((..._args: unknown[]) => Promise.resolve());
        const dataProvider = { deleteSetting } as unknown as FunctionAppDataProvider;

        const cmd = new DeleteAppSetting(code, cache as never, dataProvider);
        return { cmd, cache, deleteSetting };
    }

    it('should return early when key is undefined', async () => {
        const { cmd, cache } = createCmd();
        await cmd.execute(undefined);
        expect(cache.get.mock.callCount()).to.equal(0);
    });

    it('should return early when resource is not found in cache', async () => {
        const { cmd, deleteSetting } = createCmd();
        await cmd.execute('nonexistent-key');
        expect(deleteSetting.mock.callCount()).to.equal(0);
    });

    it('should return early when resource is not an AppSetting type', async () => {
        const { cmd, deleteSetting } = createCmd({
            virtualType: FunctionAppVirtualTypes.AppSettings,
            virtualPath: 'App Settings',
        });
        await cmd.execute('test-key');
        expect(deleteSetting.mock.callCount()).to.equal(0);
    });

    it('should delete when user confirms', async () => {
        const { cmd, deleteSetting } = createCmd({ confirmResponse: 'Delete' });
        await cmd.execute('test-key');

        expect(deleteSetting.mock.callCount()).to.equal(1);
        expect(deleteSetting.mock.calls[0].arguments[1]).to.equal('MY_SETTING');
    });

    it('should cancel without deleting when confirmation is dismissed', async () => {
        const { cmd, deleteSetting } = createCmd({ confirmResponse: undefined });
        await expect(cmd.execute('test-key')).to.be.rejectedWith(CancellationError);
        expect(deleteSetting.mock.callCount()).to.equal(0);
    });

    it('should invalidate cache after deletion', async () => {
        const appSettingResource = makeVirtualResource({
            virtualType: FunctionAppVirtualTypes.AppSetting,
            virtualPath: 'MY_SETTING',
        });
        const parentResource = makeVirtualResource({
            virtualType: FunctionAppVirtualTypes.AppSettings,
            virtualPath: 'App Settings',
        });

        const mockResult = createMockVsCode();
        const { vscode: code } = mockResult;
        mockResult.messageResponses.push('Delete');

        const cache = {
            get: mock.fn((key: string) => key === 'test-key' ? appSettingResource : parentResource),
            invalidate: mock.fn(),
        };

        const deleteSetting = mock.fn((..._args: unknown[]) => Promise.resolve());
        const dataProvider = { deleteSetting } as unknown as FunctionAppDataProvider;

        const cmd = new DeleteAppSetting(code, cache as never, dataProvider);
        await cmd.execute('test-key');

        expect(cache.invalidate.mock.callCount()).to.be.greaterThanOrEqual(1);
    });
});
