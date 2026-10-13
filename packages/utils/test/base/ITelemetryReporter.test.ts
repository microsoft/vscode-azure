/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mock } from 'node:test';
import { createTelemetryReporter, NullTelemetryReporter } from '../../src/base/ITelemetryReporter';
import { createMockCodeContext } from '../vscode/MockVsCode';

describe('createTelemetryReporter (unit)', () => {
    beforeEach(() => {
        mock.property(process, 'env', {});
    });

    afterEach(() => {
        mock.restoreAll();
    });

    for (const mode of ['Development', 'Test'] as const) {
        for (const debugTelemetry of [undefined, '0', 'false', '1']) {
            it(`suppresses telemetry in ${mode} mode with DEBUGTELEMETRY=${debugTelemetry}`, () => {
                const { ctx } = createMockCodeContext();
                mock.property(ctx.extensionContext, 'extensionMode', ctx.code.ExtensionMode[mode]);
                if (debugTelemetry !== undefined) {
                    process.env.DEBUGTELEMETRY = debugTelemetry;
                }

                const reporter = createTelemetryReporter(ctx, NullTelemetryReporter);
                expect(reporter).to.be.instanceOf(NullTelemetryReporter);
            });
        }
    }

    for (const debugTelemetry of [undefined, '', '0', 'false']) {
        it(`constructs the production reporter with DEBUGTELEMETRY=${debugTelemetry}`, () => {
            const { ctx } = createMockCodeContext();
            mock.property(ctx.extensionContext, 'extensionMode', ctx.code.ExtensionMode.Production);
            mock.property(ctx.extensionContext.extension, 'packageJSON', { aiKey: 'test-ai-key' });
            if (debugTelemetry !== undefined) {
                process.env.DEBUGTELEMETRY = debugTelemetry;
            }
            const construct = mock.fn();
            class Reporter extends NullTelemetryReporter {
                constructor(connectionString: string) {
                    super();
                    construct(connectionString);
                }
            }

            expect(createTelemetryReporter(ctx, Reporter)).to.be.instanceOf(Reporter);
            expect(construct.mock.calls[0].arguments).to.deep.equal(['test-ai-key']);
        });
    }

    it('requires an AI key for production telemetry', () => {
        const { ctx } = createMockCodeContext();
        mock.property(ctx.extensionContext, 'extensionMode', ctx.code.ExtensionMode.Production);
        expect(() => createTelemetryReporter(ctx, NullTelemetryReporter)).to.throw('AI key is required');
    });

    for (const variable of ['DEBUGTELEMETRY', 'VSCODE_RUNNING_TESTS']) {
        it(`suppresses production telemetry when ${variable} is enabled`, () => {
            const { ctx } = createMockCodeContext();
            mock.property(ctx.extensionContext, 'extensionMode', ctx.code.ExtensionMode.Production);
            process.env[variable] = '1';
            expect(createTelemetryReporter(ctx, NullTelemetryReporter)).to.be.instanceOf(NullTelemetryReporter);
        });
    }

    for (const mode of ['Production', 'Development', 'Test'] as const) {
        for (const verbose of ['v', 'VERBOSE']) {
            it(`logs verbose telemetry in ${mode} mode with DEBUGTELEMETRY=${verbose}`, () => {
                const { ctx } = createMockCodeContext();
                mock.property(ctx.extensionContext, 'extensionMode', ctx.code.ExtensionMode[mode]);
                process.env.DEBUGTELEMETRY = verbose;
                const log = mock.method(console, 'log', () => { /* noop */ });

                const reporter = createTelemetryReporter(ctx, NullTelemetryReporter);
                reporter.sendTelemetryErrorEvent('test-event', { result: 'Succeeded' });
                expect(log.mock.calls[0].arguments[0]).to.equal(`DEBUGTEL: ${ctx.extensionContext.extension.id}/test-event`);
            });
        }
    }
});
