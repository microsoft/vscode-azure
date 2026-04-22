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
        it('should reject empty input', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();

            // Don't use respondToPrompts — drive the input box manually
            const stepPromise = new EnvironmentNameStep(ctx).prompt();

            const ib = mockResult.inputBoxes[0];
            ib.changeValue('');

            // Validation message should be set
            expect(ib.validationMessage).to.be.a('string');
            expect(ib.validationMessage).to.include('required');

            // Accept a valid value to complete the promise
            ib.changeValue('valid');
            ib.accept();
            await stepPromise;
        });

        it('should reject names with special characters', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();

            const stepPromise = new EnvironmentNameStep(ctx).prompt();

            const ib = mockResult.inputBoxes[0];
            ib.changeValue('my_env!');
            expect(ib.validationMessage).to.be.a('string');
            expect(ib.validationMessage).to.include('letters');

            ib.changeValue('valid');
            ib.accept();
            await stepPromise;
        });

        it('should accept alphanumeric names with hyphens', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();

            const stepPromise = new EnvironmentNameStep(ctx).prompt();

            const ib = mockResult.inputBoxes[0];
            ib.changeValue('my-env-123');
            expect(ib.validationMessage).to.be.undefined;

            ib.accept();
            await stepPromise;
        });
    });
});
