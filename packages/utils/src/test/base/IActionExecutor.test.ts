/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock, type Mock } from 'node:test';
import { ActionExecutor } from '../../base/IActionExecutor';
import type { ITelemetryReporter } from '../../base/ITelemetryReporter';
import { CancellationError } from '../../vscode/CancellationError';

// A mock reporter is necessary here to validate that the expected calls are made to the reporter
function createReporter(): ITelemetryReporter & { sendTelemetryErrorEvent: Mock<ITelemetryReporter['sendTelemetryErrorEvent']> } {
    return {
        sendTelemetryErrorEvent: mock.fn<ITelemetryReporter['sendTelemetryErrorEvent']>(),
        dispose: () => Promise.resolve(),
    };
}

describe('ActionExecutor (unit)', () => {
    describe('currentContext', () => {
        it('should be undefined outside of a callback', () => {
            const executor = new ActionExecutor(createReporter());
            expect(executor.currentContext).to.be.undefined;
        });

        it('should be defined inside a callback', async () => {
            const executor = new ActionExecutor(createReporter());
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                expect(executor.currentContext).to.equal(ctx);
            });
        });

        it('should be undefined again after callback completes', async () => {
            const executor = new ActionExecutor(createReporter());
            await executor.callWithTelemetryAndErrorHandling('test', () => { /* noop */ });
            expect(executor.currentContext).to.be.undefined;
        });
    });

    describe('callWithTelemetryAndErrorHandling', () => {
        it('should return the callback result on success', async () => {
            const executor = new ActionExecutor(createReporter());
            const result = await executor.callWithTelemetryAndErrorHandling('test', () => 42);
            expect(result).to.equal(42);
        });

        it('should set result to Succeeded on success', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', () => 'ok');

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(1);
            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Succeeded');
        });

        it('should set result to Failed on error and return undefined', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            const result = await executor.callWithTelemetryAndErrorHandling<string>('test', () => {
                throw new Error('boom');
            });

            expect(result).to.be.undefined;
            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Failed');
        });

        it('should set result to Canceled for CancellationError', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                throw new CancellationError();
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.result).to.equal('Canceled');
        });

        it('should rethrow when errorHandling.rethrow is set', async () => {
            const executor = new ActionExecutor(createReporter());
            try {
                await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                    ctx.errorHandling.rethrow = true;
                    throw new Error('rethrown');
                });
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.equal('rethrown');
            }
        });

        it('should record duration in measurements', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', () => { /* noop */ });

            const measurements = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[2];
            expect(measurements?.duration).to.be.a('number');
            expect(measurements!.duration!).to.be.greaterThanOrEqual(0);
        });

        it('should suppress telemetry when suppress is always', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'always';
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(0);
        });

        it('should suppress telemetry when suppress is onSuccess and result is Succeeded', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'onSuccess';
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(0);
        });

        it('should not suppress telemetry when suppress is onSuccess and result is Failed', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.suppress = 'onSuccess';
                throw new Error('fail');
            });

            expect(reporter.sendTelemetryErrorEvent.mock.callCount()).to.equal(1);
        });

        it('should set isActivationEvent when isUserEvent is false', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.isUserEvent = false;
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.isActivationEvent).to.equal('true');
        });

        it('should not set isActivationEvent when isUserEvent is true', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', (ctx) => {
                ctx.telemetry.isUserEvent = true;
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.isActivationEvent).to.be.undefined;
        });
    });

    describe('setTelProp / setTelMeasure', () => {
        it('should set a property on the current context', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                executor.setTelProp('nodeType', 'subscription');
            });

            const props = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[1];
            expect(props?.nodeType).to.equal('subscription');
        });

        it('should set a measurement on the current context', async () => {
            const reporter = createReporter();
            const executor = new ActionExecutor(reporter);
            await executor.callWithTelemetryAndErrorHandling('test', () => {
                executor.setTelMeasure('itemCount', 5);
            });

            const measurements = reporter.sendTelemetryErrorEvent.mock.calls[0].arguments[2];
            expect(measurements?.itemCount).to.equal(5);
        });

        it('should be a no-op when no context is active', () => {
            const executor = new ActionExecutor(createReporter());
            // Should not throw
            executor.setTelProp('tree', 'resources');
            executor.setTelMeasure('count', 1);
        });
    });
});
