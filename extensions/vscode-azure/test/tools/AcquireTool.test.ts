/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext, ProcessExecutor } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockCancellationToken } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AcquireTool } from '../../src/commands/tools/AcquireTool';
import { AzdInstaller } from '../../src/tools/AzdInstaller';
import { ToolService, type AcquireToolRequest, type AcquireToolResult } from '../../src/tools/ToolService';
import { createInstallerHarness } from './installerTestHelpers';

function createCommand() {
    const mockResult = createMockVsCode();
    const context = createActionContext('acquireTool');
    const { installer } = createInstallerHarness(AzdInstaller);
    const tools = new ToolService(mockResult.vscode, new ProcessExecutor(mockResult.vscode), [installer]);
    const result: AcquireToolResult = { executablePath: '/tools/azd' };
    const acquire = mock.method(tools, 'acquire', (_request: AcquireToolRequest) => Promise.resolve(result));
    return {
        command: new AcquireTool(tools, context, mockResult.vscode, [installer]),
        mockResult,
        context,
        acquire,
        result,
    };
}

describe('AcquireTool (unit)', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('should acquire directly and record the caller when no notification is requested', async () => {
        const { command, mockResult, context, acquire, result } = createCommand();

        expect(await command.execute({ toolId: 'azd', requestingExtensionId: 'publisher.caller' })).to.equal(result);

        expect(acquire.mock.callCount()).to.equal(1);
        expect(acquire.mock.calls[0].arguments[0]).to.include({
            toolId: 'azd',
            requestingExtensionId: 'publisher.caller',
            force: false,
            showProgressNotification: false,
        });
        expect(context.telemetry.properties.toolId).to.equal('azd');
        expect(context.telemetry.properties.requestingExtensionId).to.equal('publisher.caller');
        expect(context.errorHandling.rethrow).to.be.true;
        expect(mockResult.window.withProgress.mock.callCount()).to.equal(0);
    });

    for (const callerOwnsCancellation of [false, true]) {
        it(`should forward notification progress and cancellation (caller owns token: ${callerOwnsCancellation})`, async () => {
            const { command, mockResult, acquire, result } = createCommand();
            const callerToken = new MockCancellationToken();
            const notificationToken = new MockCancellationToken();
            const report = mock.fn((_value: { readonly message?: string }) => undefined);
            const progress = mock.fn((_message: string) => undefined);
            mockResult.window.withProgress.mock.mockImplementation(async (options, task) => {
                expect(options.location).to.equal(mockResult.vscode.ProgressLocation.Notification);
                expect(options.cancellable).to.equal(!callerOwnsCancellation);
                return task({ report }, notificationToken);
            });
            acquire.mock.mockImplementation(request => {
                expect(request.cancellationToken).to.equal(callerOwnsCancellation ? callerToken : notificationToken);
                request.progress?.('Installing azd');
                return Promise.resolve(result);
            });

            try {
                expect(await command.execute({
                    toolId: 'azd',
                    requestingExtensionId: 'publisher.caller',
                    showProgressNotification: true,
                    cancellationToken: callerOwnsCancellation ? callerToken : undefined,
                    progress,
                })).to.equal(result);

                expect(mockResult.window.withProgress.mock.callCount()).to.equal(1);
                expect(progress.mock.calls.map(call => call.arguments)).to.deep.equal([['Installing azd']]);
                expect(report.mock.calls.map(call => call.arguments)).to.deep.equal([[{ message: 'Installing azd' }]]);
            } finally {
                callerToken.dispose();
                notificationToken.dispose();
            }
        });
    }

    for (const showProgressNotification of [false, true]) {
        for (const failure of [new Error('Installation failed'), new CancellationError()]) {
            it(`should rethrow ${failure.name} to the caller (notification: ${showProgressNotification})`, async () => {
                const { command, context, acquire } = createCommand();
                acquire.mock.mockImplementation(() => Promise.reject(failure));

                const result = command.execute({
                    toolId: 'azd',
                    requestingExtensionId: 'publisher.caller',
                    showProgressNotification,
                });

                expect(await expect(result).to.be.rejected).to.equal(failure);
                expect(context.errorHandling.rethrow).to.be.true;
            });
        }
    }

    it('should reject invalid input before acquiring or showing progress', async () => {
        const { command, mockResult, acquire, context } = createCommand();

        await expect(command.execute({ toolId: 'azd' })).to.be.rejectedWith(/requestingExtensionId/);

        expect(acquire.mock.callCount()).to.equal(0);
        expect(mockResult.window.withProgress.mock.callCount()).to.equal(0);
        expect(context.errorHandling.rethrow).to.be.true;
    });
});
