/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { CreateFunctionAppContext } from '../../../commands/functions/CreateFunctionAppContext';
import { PickRuntimeVersionStep } from '../../../commands/functions/steps/PickRuntimeVersionStep';

describe('PickRuntimeVersionStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return false when no runtime is selected', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            expect(step.shouldPrompt({})).to.be.false;
        });

        it('should return false when runtimeVersion is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node', runtimeVersion: '24' };
            expect(step.shouldPrompt(context)).to.be.false;
        });

        it('should return true when a single-version runtime is selected (resolved without prompting)', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'custom' };
            expect(step.shouldPrompt(context)).to.be.true;
        });

        it('should return true when the runtime supports multiple versions', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node' };
            expect(step.shouldPrompt(context)).to.be.true;
        });
    });

    describe('prompt', () => {
        it('should return the selected version for the chosen runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: '24' }]);

            const step = new PickRuntimeVersionStep(ctx);
            const result = await step.prompt({ functionWorkerRuntime: 'node' });

            expect(result.runtimeVersion).to.equal('24');
        });

        it('should resolve the single supported version without prompting', async () => {
            const { ctx } = createMockCodeContext();

            const step = new PickRuntimeVersionStep(ctx);
            const result = await step.prompt({ functionWorkerRuntime: 'custom' });

            expect(result.runtimeVersion).to.equal('');
        });
    });
});
