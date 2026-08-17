/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { CancellationError, Everything } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { AzdDown } from '../../../src/commands/deploy/AzdDown';
import { createMockAzdService } from '../../azd/MockAzdService';
import { createWizardCommandContainer } from '../createWizardCommandContainer';

describe('AzdDown (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand(options: { workspaceFolders?: boolean } = {}) {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');

        const azd = createMockAzdService();

        const dataTree = createMockDataItemTree([sub]);

        if (options.workspaceFolders !== false) {
            mockResult.workspaceFolders.push({
                uri: MockUri.file('/workspace'),
                name: 'workspace',
                index: 0,
            });

            // By default, findAzureYaml finds it in the workspace
            azd.findAzureYaml.mock.mockImplementation((dir: vscode.Uri) => {
                if (dir.path === '/workspace') {
                    return Promise.resolve([MockUri.file('/workspace/azure.yaml')]);
                }
                return Promise.resolve([]);
            });
        }

        const container = createWizardCommandContainer({ ctx, output, azd, dataTree });
        const cmd = container.get(AzdDown);

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;

        return { cmd, mockResult, azd, dataTree, invalidate };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(AzdDown);
    });

    it('should prompt for confirmation with a modal warning', async () => {
        const { cmd, mockResult } = createCommand();
        respondToPrompts(mockResult, [{ button: 'Delete' }]);

        await cmd.execute(MockUri.file('/workspace/azure.yaml'));

        const showWarning = mockResult.window.showWarningMessage;
        expect(showWarning.mock.callCount()).to.equal(1);
        // Second argument carries the options; confirm it is a modal dialog
        expect(showWarning.mock.calls[0].arguments[1]).to.deep.include({ modal: true });
    });

    it('should run azd down against the resolved folder when confirmed', async () => {
        const { cmd, mockResult, azd, invalidate } = createCommand();
        respondToPrompts(mockResult, [{ button: 'Delete' }]);

        await cmd.execute(MockUri.file('/workspace/azure.yaml'));

        expect(azd.down.mock.callCount()).to.equal(1);
        const cwd = azd.down.mock.calls[0].arguments[0] as vscode.Uri;
        expect(cwd.path).to.equal('/workspace');

        // The tree should be refreshed after the teardown
        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should cancel without running azd down when confirmation is dismissed', async () => {
        const { cmd, mockResult, azd, invalidate } = createCommand();
        respondToPrompts(mockResult, ['cancel']);

        await expect(cmd.execute(MockUri.file('/workspace/azure.yaml'))).to.be.rejectedWith(CancellationError);

        expect(azd.down.mock.callCount()).to.equal(0);
        expect(invalidate.mock.callCount()).to.equal(0);
    });

    it('should skip the confirmation prompt when skipConfirmation is set', async () => {
        const { cmd, mockResult, azd, invalidate } = createCommand();
        // No queued message response: if the command prompted, showWarningMessage
        // would resolve undefined and teardown would be skipped.

        await cmd.execute(MockUri.file('/workspace/azure.yaml'), { skipConfirmation: true });

        expect(mockResult.window.showWarningMessage.mock.callCount()).to.equal(0);
        expect(azd.down.mock.callCount()).to.equal(1);
        expect((azd.down.mock.calls[0].arguments[0] as vscode.Uri).path).to.equal('/workspace');
        expect(invalidate.mock.callCount()).to.equal(1);
    });

    it('should pass an explicitly selected environment to azd down', async () => {
        const { cmd, azd } = createCommand();

        await cmd.execute(MockUri.file('/workspace/azure.yaml'), {
            skipConfirmation: true,
            environmentName: 'staging',
        });

        expect(azd.down.mock.calls[0].arguments[1]).to.equal('staging');
    });

    it('should name the target environment in the confirmation', async () => {
        const { cmd, mockResult, azd } = createCommand();
        respondToPrompts(mockResult, [{ button: 'Delete' }]);

        await cmd.execute(MockUri.file('/workspace/azure.yaml'), { environmentName: 'staging' });

        // The user must be told which environment is about to be purged, not
        // just that "the default" is, or they cannot judge the blast radius.
        expect(mockResult.window.showWarningMessage.mock.calls[0].arguments[0]).to.include('staging');
        expect(azd.down.mock.calls[0].arguments[1]).to.equal('staging');
    });

    it('should resolve cwd from workspace folder when invoked from the command palette', async () => {
        const { cmd, mockResult, azd } = createCommand();
        respondToPrompts(mockResult, [{ button: 'Delete' }]);

        await cmd.execute();

        expect(azd.down.mock.callCount()).to.equal(1);
        expect((azd.down.mock.calls[0].arguments[0] as vscode.Uri).path).to.equal('/workspace');
    });

    it('should show error when no workspace folders are open', async () => {
        const { cmd, mockResult, azd } = createCommand({ workspaceFolders: false });
        respondToPrompts(mockResult, [{ button: 'Delete' }]);

        await expect(cmd.execute()).to.be.rejectedWith('workspace folder');

        expect(azd.down.mock.callCount()).to.equal(0);
    });

    it('should show error when no azure.yaml found in workspace', async () => {
        const { cmd, mockResult, azd } = createCommand();
        respondToPrompts(mockResult, [{ button: 'Delete' }]);
        azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([]));

        await expect(cmd.execute()).to.be.rejectedWith('azure.yaml');

        expect(azd.down.mock.callCount()).to.equal(0);
    });
});
