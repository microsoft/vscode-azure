/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IToolAcquisitionService, ToolAcquisitionResult } from '@microsoft/vscode-azure-azutils';
import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockOutputChannel } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AcquireTool } from '../../../src/commands/tools/AcquireTool';

describe('AcquireTool (unit)', () => {
    it('validates and delegates silent API requests', async () => {
        const expected: ToolAcquisitionResult = {
            toolId: 'azd',
            executablePath: '/tools/azd',
            version: '1.25.0',
            method: 'path',
            installed: false,
        };
        const acquire = mock.fn(() => Promise.resolve(expected));
        const service: IToolAcquisitionService = { acquire, getResolvedPath: () => undefined };
        const context = createActionContext('test');
        const { vscode: code } = createMockVsCode();
        const command = new AcquireTool(service, context, code, new MockOutputChannel('test'));

        const result = await command.execute({
            toolId: 'azd',
            requestingExtensionId: 'microsoft.test-extension',
        });

        expect(result).to.equal(expected);
        expect(acquire.mock.callCount()).to.equal(1);
        expect(context.errorHandling.suppress).to.equal('display');
        expect(context.errorHandling.rethrow).to.equal(true);
        expect(context.telemetry.properties.acquisitionMethod).to.equal('path');
    });

    it('rejects malformed external input before delegating', async () => {
        const acquire = mock.fn<IToolAcquisitionService['acquire']>();
        const service: IToolAcquisitionService = { acquire, getResolvedPath: () => undefined };
        const context = createActionContext('test');
        const { vscode: code } = createMockVsCode();
        const command = new AcquireTool(service, context, code, new MockOutputChannel('test'));

        await expect(command.execute({
            toolId: 'azd',
        })).to.be.rejectedWith('requestingExtensionId');
        expect(acquire.mock.callCount()).to.equal(0);
    });
});
