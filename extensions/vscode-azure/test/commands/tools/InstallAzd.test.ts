/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AcquireToolCommandId } from '@microsoft/vscode-azure-azutils';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext } from '@microsoft/vscode-azure-utils/testing';
import { MinAzdVersion } from '../../../src/azd/AzdService';
import { InstallAzd } from '../../../src/commands/tools/InstallAzd';

describe('InstallAzd (unit)', () => {
    it('should call the API-level acquisition command with user progress', async () => {
        const { ctx, mock } = createMockCodeContext();
        const command = new InstallAzd(
            ctx.code,
            ctx.extensionContext,
            createActionContext('test'),
        );

        await command.execute();

        expect(mock.commands.executeCommand.mock.calls[0].arguments).to.deep.equal([
            AcquireToolCommandId,
            {
                toolId: 'azd',
                requestingExtensionId: 'test-publisher.test-extension',
                versionRange: `>=${MinAzdVersion}`,
                progress: {
                    showNotification: true,
                    focusInstallTask: true,
                },
            },
        ]);
    });
});
