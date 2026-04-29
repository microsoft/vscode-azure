/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { ConfirmProvisionStep } from '../../../azd/wizard/ConfirmProvisionStep';

describe('ConfirmProvisionStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true only in Bootstrapped state (existingDefaultEnvName set)', () => {
            const { ctx } = createMockCodeContext();
            const step = new ConfirmProvisionStep(ctx);

            expect(step.shouldPrompt({ existingDefaultEnvName: 'dev' })).to.be.true;
        });

        it('returns false when existingDefaultEnvName is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new ConfirmProvisionStep(ctx);

            expect(step.shouldPrompt({})).to.be.false;
        });

        it('returns true even when provision was already seeded (Bootstrapped overrides the seed)', () => {
            const { ctx } = createMockCodeContext();
            const step = new ConfirmProvisionStep(ctx);

            const context: Partial<AzdWizardContext> = { existingDefaultEnvName: 'dev', provision: true };
            expect(step.shouldPrompt(context)).to.be.true;
        });
    });

    describe('prompt', () => {
        it('returns provision=true when user picks Yes', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'Yes' }]);

            const step = new ConfirmProvisionStep(ctx);
            const result = await step.prompt({ existingDefaultEnvName: 'dev' });

            expect(result.provision).to.be.true;
        });

        it('returns provision=false when user picks No', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [{ pick: 'No' }]);

            const step = new ConfirmProvisionStep(ctx);
            const result = await step.prompt({ existingDefaultEnvName: 'dev' });

            expect(result.provision).to.be.false;
        });
    });
});
