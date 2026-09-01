/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { Everything } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { AzdUp } from '../../../src/commands/deploy/AzdUp';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createMockArmProvider, createMockCodeProvider } from '../../tree/activity/MockActivityProviders';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('AzdUp (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand(options: { workspaceFolders?: boolean } = {}) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');
        const azd = createMockAzdService();
        const armProvider = createMockArmProvider();
        const codeProvider = createMockCodeProvider();
        const dataTree = createMockDataItemTree([sub]);

        if (options.workspaceFolders !== false) {
            mockResult.workspaceFolders.push({
                uri: MockUri.file('/workspace'),
                name: 'workspace',
                index: 0,
            });

            // By default, findAzureYaml finds it in the workspace
            azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
                if ((dir).path === '/workspace') {
                    return Promise.resolve([MockUri.file('/workspace/azure.yaml')]);
                }
                return Promise.resolve([]);
            });

        }

        const container = createWizardCommandContainer({ ctx, output, azd, dataTree, armProvider, codeProvider });
        const cmd = container.get(AzdUp);
        return { cmd, ctx, mockResult, azd, dataTree };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(AzdUp);
    });

    it('should resolve cwd from file URI when invoked from explorer', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute(MockUri.file('/some/project/azure.yaml'));

        expect(azd.provision.mock.callCount()).to.equal(1);
    });

    it('should resolve cwd from workspace folder when no file URI', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect((azd.provision.mock.calls[0].arguments[0]).path).to.equal('/workspace');
    });

    it('should show error when no workspace folders are open', async () => {
        const { cmd, azd } = createCommand({ workspaceFolders: false });

        await expect(cmd.execute()).to.be.rejectedWith('workspace folder');

        expect(azd.provision.mock.callCount()).to.equal(0);
    });

    it('should show error when no azure.yaml found in workspace', async () => {
        const { cmd, azd } = createCommand();
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([]));

        await expect(cmd.execute()).to.be.rejectedWith('azure.yaml');

        expect(azd.provision.mock.callCount()).to.equal(0);
    });

    it('should invalidate the data tree after execution', async () => {
        const { cmd, dataTree } = createCommand();

        await cmd.execute();

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;
        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should call deploy after provision', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute();

        expect(azd.provision.mock.callCount()).to.equal(1);
        expect(azd.deploy.mock.callCount()).to.equal(1);
    });
});
