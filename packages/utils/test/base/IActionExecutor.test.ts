/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { mock, type Mock } from 'node:test';
import { delay } from '../../src/base/delay';
import type { ITelemetryReporter } from '../../src/base/ITelemetryReporter';
import { CancellationError } from '../../src/vscode/CancellationError';
import { createTestActionExecutor } from '../createTestActionExecutor';
import { MockOutputChannel } from '../vscode/MockOutputChannel';

// A mock reporter is necessary here to validate that the expected calls are made to the reporter
function createReporter(): ITelemetryReporter & { sendTelemetryErrorEvent: Mock<ITelemetryReporter['sendTelemetryErrorEvent']> } {
    return {
        sendTelemetryErrorEvent: mock.fn<ITelemetryReporter['sendTelemetryErrorEvent']>(),
        dispose: () => Promise.resolve(),
    };
}

function createExecutor(reporter?: ReturnType<typeof createReporter>, output?: MockOutputChannel) {
    const r = reporter ?? createReporter();
    const { executor, code, mockVsCode } = createTestActionExecutor({ reporter: r, output });
    return { executor, reporter: r, code, mockVsCode };
}

describe('ActionExecutor (unit)', () => {
    describe('currentContext', () => {
        it('should be undefined outside of a callback', () => {
            const { executor } = createExecutor();
            expect(executor.currentContext).to.be.undefined;
        });

        it('should be defined inside a callback', async () => {
            const { executor } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                expect(executor.currentContext).to.equal(ctx);
            });
        });

        it('should be undefined again after callback completes', async () => {
            const { executor } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => { /* noop */ });
            expect(executor.currentContext).to.be.undefined;
        });
    });

    describe('callWithTelemetryAndErrorHandling', () => {
        it('should return the callback result on success', async () => {
            const { executor } = createExecutor();
            const result = await executor.callWithTelemetryAndErrorHandling('test', () => 42);
            expect(result).to.equal(42);
        });

        it('should set result to Succeeded on success', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => 'ok');

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(1);
            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Succeeded');
        });

        it('should set result to Failed on error and return undefined', async () => {
            const { executor, reporter } = createExecutor();
            const result = await executor.callWithTelemetryAndErrorHandling<string>('test', () => {
                throw new Error('boom');
            });

            expect(result).to.be.undefined;
            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Failed');
        });

        it('should set result to Canceled for CancellationError', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                throw new CancellationError();
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Canceled');
        });

        it('should rethrow when errorHandling.rethrow is set', async () => {
            const { executor } = createExecutor();
            const error = await expect(executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.errorHandling.rethrow = true;
                throw new Error('rethrown');
            })).to.be.rejected;
            expect((error as Error).message).to.equal('rethrown');
        });

        it('should record duration in measurements', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => { /* noop */ });

            const measurements = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[2];
            expect(measurements?.duration).to.be.a('number');
            expect(measurements!.duration!).to.be.greaterThanOrEqual(0);
        });

        it('should suppress telemetry when suppress is always', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'always';
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(0);
        });

        it('should suppress telemetry when suppress is onSuccess and result is Succeeded', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'onSuccess';
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(0);
        });

        it('should not suppress telemetry when suppress is onSuccess and result is Failed', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'onSuccess';
                throw new Error('fail');
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(1);
        });

        it('should set isActivationEvent when isUserEvent is false', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.isUserEvent = false;
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.isActivationEvent).to.equal('true');
        });

        it('should not set isActivationEvent when isUserEvent is true', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.isUserEvent = true;
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.isActivationEvent).to.be.undefined;
        });

        it('should log command lifecycle for success and failure', async () => {
            const output = new MockOutputChannel('test');
            const debugSpy = mock.method(output, 'debug');
            const errorSpy = mock.method(output, 'error');
            const { executor } = createExecutor(undefined, output);

            await executor.callWithTelemetryAndErrorHandling('successCallback', () => 42);
            await executor.callWithTelemetryAndErrorHandling('failingCallback', () => {
                throw new Error('boom');
            });

            expect(debugSpy.mock.calls.some(call => call.arguments[0] === '[cmd] successCallback start')).to.be.true;
            expect(debugSpy.mock.calls.some(call => call.arguments[0] === '[cmd] successCallback done')).to.be.true;
            expect(errorSpy.mock.calls.some(call =>
                call.arguments[0] instanceof Error &&
                call.arguments[0].message === 'boom')).to.be.true;
        });
    });

    describe('setTelProp / setTelMeasure', () => {
        it('should set a property on the current context', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                executor.setTelProp('nodeType', 'subscription');
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.nodeType).to.equal('subscription');
        });

        it('should set a measurement on the current context', async () => {
            const { executor, reporter } = createExecutor();
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                executor.setTelMeasure('itemCount', 5);
            });

            const measurements = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[2];
            expect(measurements?.itemCount).to.equal(5);
        });

        it('should be a no-op when no context is active', () => {
            const { executor } = createExecutor();
            // Should not throw
            executor.setTelProp('tree', 'resources');
            executor.setTelMeasure('count', 1);
        });
    });

    describe('error toast', () => {
        it('should show an error message with Report Issue button on failure', async () => {
            const { executor, mockVsCode } = createExecutor();
            const showErrorMessage = mockVsCode.window.showErrorMessage;

            await executor.callWithTelemetryAndErrorHandling('test', () => {
                throw new Error('something broke');
            });

            expect(showErrorMessage.mock.callCount()).to.equal(1);
            expect(showErrorMessage.mock.calls[0].arguments[0]).to.equal('something broke');
            expect(showErrorMessage.mock.calls[0].arguments[1]).to.equal('Report Issue');
        });

        it('should not show error message when suppress is display', async () => {
            const { executor, mockVsCode } = createExecutor();
            const showErrorMessage = mockVsCode.window.showErrorMessage;

            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.errorHandling.suppress = 'display';
                throw new Error('hidden error');
            });

            expect(showErrorMessage.mock.callCount()).to.equal(0);
        });

        it('should not show Report Issue button when suppress is reportIssue', async () => {
            const { executor, mockVsCode } = createExecutor();
            const showErrorMessage = mockVsCode.window.showErrorMessage;

            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.errorHandling.suppress = 'reportIssue';
                throw new Error('no report button');
            });

            expect(showErrorMessage.mock.callCount()).to.equal(1);
            expect(showErrorMessage.mock.calls[0].arguments[0]).to.equal('no report button');
            // No additional arguments (no button)
            expect(showErrorMessage.mock.calls[0].arguments.length).to.equal(1);
        });

        it('should open issue reporter with extensionId and data when Report Issue is clicked', async () => {
            const { executor, mockVsCode } = createExecutor();
            const showErrorMessage = mockVsCode.window.showErrorMessage;
            const executeCommand = mockVsCode.commands.executeCommand;

            // Simulate user clicking "Report Issue"
            showErrorMessage.mock.mockImplementation(
                ((...args: unknown[]) => Promise.resolve(args[1])),
            );

            await executor.callWithTelemetryAndErrorHandling('test', () => {
                throw new Error('bug');
            });

            // Give the async toast handler a tick to complete
            await delay(0);

            expect(executeCommand.mock.callCount()).to.equal(1);
            expect(executeCommand.mock.calls[0].arguments[0]).to.equal('vscode.openIssueReporter');
            const options = executeCommand.mock.calls[0].arguments[1] as { extensionId: string; data: string };
            expect(options.extensionId).to.equal('test-extension');
            expect(options.data).to.include('App Host:');
            expect(options.data).to.include('Language:');
        });

        it('should not show error toast for CancellationError', async () => {
            const { executor, mockVsCode } = createExecutor();
            const showErrorMessage = mockVsCode.window.showErrorMessage;

            await executor.callWithTelemetryAndErrorHandling('test', () => {
                throw new CancellationError();
            });

            expect(showErrorMessage.mock.callCount()).to.equal(0);
        });
    });
});
