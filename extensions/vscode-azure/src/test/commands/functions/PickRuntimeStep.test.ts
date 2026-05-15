/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { CreateFunctionAppContext } from '../../../commands/functions/CreateFunctionAppContext';
import { PickRuntimeStep } from '../../../commands/functions/steps/PickRuntimeStep';

describe('PickRuntimeStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return true when runtime is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);
            expect(step.shouldPrompt({})).to.be.true;
        });

        it('should return false when functionWorkerRuntime is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node' };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('should return node runtime with correct version', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Node.js' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('node');
            expect(result.runtimeVersion).to.equal('24');
        });

        it('should return python runtime with correct version', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Python' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('python');
            expect(result.runtimeVersion).to.equal('3.14');
        });

        it('should return dotnet-isolated runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: '.NET (isolated)' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('dotnet-isolated');
            expect(result.runtimeVersion).to.equal('10.0');
        });

        it('should return java runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Java' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('java');
            expect(result.runtimeVersion).to.equal('25');
        });

        it('should return powershell runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'PowerShell' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('powershell');
            expect(result.runtimeVersion).to.equal('7.6');
        });

        it('should return custom runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Custom' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('custom');
            expect(result.runtimeVersion).to.equal('');
        });
    });
});
