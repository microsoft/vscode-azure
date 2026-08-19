/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import type { CreateFunctionAppContext } from '../../../src/commands/functions/CreateFunctionAppContext';
import { PickRuntimeStep } from '../../../src/commands/functions/steps/PickRuntimeStep';
import { PickRuntimeVersionStep } from '../../../src/commands/functions/steps/PickRuntimeVersionStep';

describe('PickRuntimeStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return true when runtime is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App' })).to.be.true;
        });

        it('should return false when functionWorkerRuntime is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node' };
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', ...context })).to.be.false;
        });

        it('should return false when infrastructure already exists (hasInfra)', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', hasInfra: true })).to.be.false;
        });
    });

    describe('getSubPromptSteps', () => {
        it('inserts a PickRuntimeVersionStep sub-step to resolve the version', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeStep(ctx);

            const subSteps = step.getSubPromptSteps();

            expect(subSteps).to.have.lengthOf(1);
            expect(subSteps[0]).to.be.instanceOf(PickRuntimeVersionStep);
        });
    });

    describe('prompt', () => {
        it('should return node runtime without a version (multiple supported)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Node.js' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('node');
            expect(result.runtimeVersion).to.be.undefined;
        });

        it('should return python runtime without a version (multiple supported)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Python' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('python');
            expect(result.runtimeVersion).to.be.undefined;
        });

        it('should return dotnet-isolated runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: '.NET (isolated)' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('dotnet-isolated');
            expect(result.runtimeVersion).to.be.undefined;
        });

        it('should return java runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Java' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('java');
            expect(result.runtimeVersion).to.be.undefined;
        });

        it('should return powershell runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'PowerShell' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('powershell');
            expect(result.runtimeVersion).to.be.undefined;
        });

        it('should return custom runtime without a version', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Custom' }]);

            const step = new PickRuntimeStep(ctx);
            const result = await step.prompt();

            expect(result.functionWorkerRuntime).to.equal('custom');
            expect(result.runtimeVersion).to.be.undefined;
        });
    });
});
