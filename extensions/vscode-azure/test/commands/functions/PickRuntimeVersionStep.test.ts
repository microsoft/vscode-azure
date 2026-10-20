/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import type { CreateFunctionAppContext } from '../../../src/commands/functions/CreateFunctionAppContext';
import { runtimeVersions } from '../../../src/commands/functions/steps/runtimesAndVersions';
import { PickRuntimeVersionStep } from '../../../src/commands/functions/steps/PickRuntimeVersionStep';

describe('PickRuntimeVersionStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return false when no runtime is selected', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App' })).to.be.false;
        });

        it('should return false when runtimeVersion is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node', runtimeVersion: runtimeVersions.node[0] };
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', ...context })).to.be.false;
        });

        it('should return true when a single-version runtime is selected (resolved without prompting)', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'python' };
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', ...context })).to.be.true;
        });

        it('should return true when the runtime supports multiple versions', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node' };
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', ...context })).to.be.true;
        });

        it('should return false when infrastructure already exists (hasInfra)', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickRuntimeVersionStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { functionWorkerRuntime: 'node', hasInfra: true };
            expect(step.shouldPrompt({ resourceDisplayName: 'Function App', ...context })).to.be.false;
        });
    });

    describe('prompt', () => {
        it('should return the selected version for the chosen runtime', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: runtimeVersions.node[0] }]);

            const step = new PickRuntimeVersionStep(ctx);
            const result = await step.prompt({ resourceDisplayName: 'Function App', functionWorkerRuntime: 'node' });

            expect(result.runtimeVersion).to.equal(runtimeVersions.node[0]);
        });

        it('should resolve the single supported version without prompting', async () => {
            const { ctx } = createMockCodeContext();

            const step = new PickRuntimeVersionStep(ctx);
            const result = await step.prompt({ resourceDisplayName: 'Function App', functionWorkerRuntime: 'python' });

            expect(result.runtimeVersion).to.equal(runtimeVersions.python[0]);
        });
    });
});
