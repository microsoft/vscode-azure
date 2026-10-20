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
        for (const [label, runtime] of [
            ['Node.js', 'node'], ['Python', 'python'], ['.NET (isolated)', 'dotnet-isolated'],
            ['Java', 'java'], ['PowerShell', 'powershell'],
        ] as const) {
            it(`maps the ${label} choice to ${runtime} and leaves the version to the sub-step`, async () => {
                const { ctx, mock: mockResult } = createMockCodeContext();
                respondToPrompts(mockResult, [{ pick: label }]);

                const result = await new PickRuntimeStep(ctx).prompt();

                expect(result.functionWorkerRuntime).to.equal(runtime);
                expect(result.runtimeVersion).to.be.undefined;
            });
        }
    });
});
