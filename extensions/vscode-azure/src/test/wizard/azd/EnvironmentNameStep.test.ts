/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';
import { EnvironmentNameStep } from '../../../wizard/azd/EnvironmentNameStep';

describe('EnvironmentNameStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('should return true when environmentName is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new EnvironmentNameStep(ctx);
            expect(step.shouldPrompt({})).to.be.true;
        });

        it('should return false when environmentName is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new EnvironmentNameStep(ctx);
            const context: Partial<AzdWizardContext> = { environmentName: 'dev' };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('should return the entered environment name', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [
                { input: 'my-env' },
            ]);

            const step = new EnvironmentNameStep(ctx);
            const result = await step.prompt();

            expect(result.environmentName).to.equal('my-env');
        });
    });

    describe('validation', () => {
        it('should reject empty names', () => {
            expect(/^[a-zA-Z0-9-]+$/.test('')).to.be.false;
        });

        it('should accept alphanumeric names with hyphens', () => {
            expect(/^[a-zA-Z0-9-]+$/.test('my-env-123')).to.be.true;
        });

        it('should reject names with spaces', () => {
            expect(/^[a-zA-Z0-9-]+$/.test('my env')).to.be.false;
        });

        it('should reject names with special characters', () => {
            expect(/^[a-zA-Z0-9-]+$/.test('my_env!')).to.be.false;
        });
    });
});
