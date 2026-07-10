/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import type { CreateFunctionAppContext } from '../../../src/commands/functions/CreateFunctionAppContext';
import { PickHostingPlanStep } from '../../../src/commands/functions/steps/PickHostingPlanStep';

describe('PickHostingPlanStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return true when appServicePlanSkuName is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickHostingPlanStep(ctx);
            expect(step.shouldPrompt({})).to.be.true;
        });

        it('should return false when appServicePlanSkuName is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new PickHostingPlanStep(ctx);
            const context: Partial<CreateFunctionAppContext> = { appServicePlanSkuName: 'FC1' };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('should return FC1 when Flex Consumption is picked', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Flex Consumption' }]);

            const step = new PickHostingPlanStep(ctx);
            const result = await step.prompt();

            expect(result.appServicePlanSkuName).to.equal('FC1');
        });

        it('should return EP1 when Premium is picked', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Premium' }]);

            const step = new PickHostingPlanStep(ctx);
            const result = await step.prompt();

            expect(result.appServicePlanSkuName).to.equal('EP1');
        });

        it('should return S1 when App Service Plan is picked', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'App Service Plan' }]);

            const step = new PickHostingPlanStep(ctx);
            const result = await step.prompt();

            expect(result.appServicePlanSkuName).to.equal('S1');
        });
    });
});
