/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockDataItemTree, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createActionContext, Everything } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { mock } from 'node:test';
import type * as vscode from 'vscode';
import { TempDirManager } from '../../azd/TempDirManager';
import { AzdDown } from '../../commands/AzdDown';
import { createMockAzdService } from '../azd/MockAzdService';

describe('AzdDown (unit)', () => {
    const sub = makeSubscription({ subscriptionId: 'sub-1', displayName: 'Test Sub' });

    function createCommand() {
        const { ctx, mock: mockResult } = createMockCodeContext();
        const output = new MockOutputChannel('test');

        const azd = createMockAzdService();

        const dataTree = createMockDataItemTree([sub]);

        const tempManager = new TempDirManager(ctx);

        const cmd = new AzdDown(
            createActionContext('test'),
            ctx,
            output,
            azd,
            dataTree,
            tempManager,
        );

        const invalidate = (dataTree as unknown as { invalidate: ReturnType<typeof mock.fn> }).invalidate;

        return { cmd, mockResult, azd, dataTree, invalidate };
    }

    it('should be constructable with required dependencies', () => {
        const { cmd } = createCommand();
        expect(cmd).to.be.instanceOf(AzdDown);
    });

    it('should prompt for confirmation with a modal warning', async () => {
        const { cmd, mockResult } = createCommand();
        mockResult.messageResponses.push('Delete');

        await cmd.execute(MockUri.file('/workspace/azure.yaml'));

        const showWarning = mockResult.window.showWarningMessage;
        expect(showWarning.mock.callCount()).to.equal(1);
        // Second argument carries the options; confirm it is a modal dialog
        expect(showWarning.mock.calls[0].arguments[1]).to.deep.include({ modal: true });
    });

    it('should run azd down against the resolved folder when confirmed', async () => {
        const { cmd, mockResult, azd, invalidate } = createCommand();
        mockResult.messageResponses.push('Delete');

        await cmd.execute(MockUri.file('/workspace/azure.yaml'));

        expect(azd.down.mock.callCount()).to.equal(1);
        const cwd = azd.down.mock.calls[0].arguments[0] as vscode.Uri;
        expect(cwd.path).to.equal('/workspace');

        // The tree should be refreshed after the teardown
        expect(invalidate.mock.callCount()).to.equal(1);
        expect(invalidate.mock.calls[0].arguments[0]).to.equal(Everything);
    });

    it('should not run azd down when the user cancels confirmation', async () => {
        const { cmd, azd, invalidate } = createCommand();
        // No queued message response -> showWarningMessage resolves undefined (dismissed)

        await cmd.execute(MockUri.file('/workspace/azure.yaml'));

        expect(azd.down.mock.callCount()).to.equal(0);
        expect(invalidate.mock.callCount()).to.equal(0);
    });
});
