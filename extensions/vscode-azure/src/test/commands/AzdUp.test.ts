/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockSubscriptionProvider } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { AzdUp } from '../../commands/AzdUp';
import { createMockAzdService } from '../azd/MockAzdService';

describe('AzdUp (unit)', () => {
    function createCommand(options: { workspaceFolders?: boolean } = {}) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');
        const azd = createMockAzdService();
        const armProvider = { trackDeployment: mock.fn() } as never;
        const codeProvider = {
            trackDeployment: mock.fn((activity: Record<string, unknown>) => ({
                ...activity,
                type: 'codeDeployment',
                startTime: new Date(),
            })),
        } as never;
        const subscriptionProvider = createMockSubscriptionProvider({ subscriptions: [] });
        const dataTree = { invalidateAll: mock.fn() } as never;

        if (options.workspaceFolders !== false) {
            mockResult.workspaceFolders.push({
                uri: MockUri.file('/workspace'),
                name: 'workspace',
                index: 0,
            } as never);

            // By default, findAzureYaml finds it in the workspace
            azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
                if ((dir as MockUri).path === '/workspace') {
                    return Promise.resolve(MockUri.file('/workspace/azure.yaml') as unknown as vscode.Uri);
                }
                return Promise.resolve(undefined);
            });

        }

        const cmd = new AzdUp(ctx, output, azd, armProvider, codeProvider, subscriptionProvider, dataTree);
        return { cmd, ctx, mockResult, azd, dataTree };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(AzdUp);
    });

    it('should resolve cwd from file URI when invoked from explorer', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute(MockUri.file('/some/project/azure.yaml') as unknown as vscode.Uri);

        expect(azd.provisionWithCapture.mock.callCount()).to.equal(1);
    });

    it('should resolve cwd from workspace folder when no file URI', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.provisionWithCapture.mock.callCount()).to.equal(1);
        expect((azd.provisionWithCapture.mock.calls[0].arguments[0] as MockUri).path).to.equal('/workspace');
    });

    it('should show error when no workspace folders are open', async () => {
        const { cmd, azd, mockResult } = createCommand({ workspaceFolders: false });

        await cmd.execute();

        expect(azd.provisionWithCapture.mock.callCount()).to.equal(0);
        const showError = mockResult.window.showErrorMessage as unknown as { mock: { callCount(): number } };
        expect(showError.mock.callCount()).to.equal(1);
    });

    it('should show error when no azure.yaml found in workspace', async () => {
        const { cmd, azd, mockResult } = createCommand();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve(undefined));

        await cmd.execute();

        expect(azd.provisionWithCapture.mock.callCount()).to.equal(0);
        const showError = mockResult.window.showErrorMessage as unknown as { mock: { callCount(): number } };
        expect(showError.mock.callCount()).to.equal(1);
    });

    it('should invalidate the data tree after execution', async () => {
        const { cmd, dataTree } = createCommand();

        await cmd.execute();

        const invalidateAll = (dataTree as unknown as { invalidateAll: ReturnType<typeof mock.fn> }).invalidateAll;
        expect(invalidateAll.mock.callCount()).to.equal(1);
    });

    it('should call deployWithCapture after provisionWithCapture', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.provisionWithCapture.mock.callCount()).to.equal(1);
        expect(azd.deployWithCapture.mock.callCount()).to.equal(1);
    });
});
