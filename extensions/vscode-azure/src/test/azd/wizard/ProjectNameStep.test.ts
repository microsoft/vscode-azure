/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { ProjectNameStep } from '../../../azd/wizard/ProjectNameStep';

describe('ProjectNameStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true when neither projectName nor environmentName is set', () => {
            const { ctx } = createMockCodeContext();
            const step = new ProjectNameStep(ctx);
            expect(step.shouldPrompt({})).to.be.true;
        });

        it('returns false when projectName is set', () => {
            const { ctx } = createMockCodeContext();
            const step = new ProjectNameStep(ctx);
            const context: Partial<AzdWizardContext> = { projectName: 'myapp' };
            expect(step.shouldPrompt(context)).to.be.false;
        });

        it('returns false when environmentName is set (hydrated)', () => {
            const { ctx } = createMockCodeContext();
            const step = new ProjectNameStep(ctx);
            const context: Partial<AzdWizardContext> = { environmentName: 'prod' };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('derives projectName, environmentName, and azdServiceName from a single input', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [
                { input: 'my-app' },
            ]);

            const step = new ProjectNameStep(ctx);
            const result = await step.prompt();

            expect(result.projectName).to.equal('my-app');
            expect(result.environmentName).to.equal('my-app');
            expect(result.azdServiceName).to.equal('my-app');
        });
    });

    describe('validation', () => {
        async function startPromptAndGetInputBox(ctx: ReturnType<typeof createMockCodeContext>['ctx'], mock: ReturnType<typeof createMockCodeContext>['mock']) {
            const step = new ProjectNameStep(ctx);
            const stepPromise = step.prompt();
            while (mock.inputBoxes.length === 0) {
                await new Promise(resolve => { setTimeout(resolve, 0); });
            }
            return { stepPromise, ib: mock.inputBoxes[0] };
        }

        it('rejects empty input', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            const { stepPromise, ib } = await startPromptAndGetInputBox(ctx, mockResult);

            ib.changeValue('');
            expect(ib.validationMessage).to.be.a('string');
            expect(ib.validationMessage).to.include('required');

            ib.changeValue('valid');
            ib.accept();
            await stepPromise;
        });

        it('rejects names with special characters', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            const { stepPromise, ib } = await startPromptAndGetInputBox(ctx, mockResult);

            ib.changeValue('my_app!');
            expect(ib.validationMessage).to.be.a('string');
            expect(ib.validationMessage).to.include('letters');

            ib.changeValue('valid');
            ib.accept();
            await stepPromise;
        });

        it('accepts alphanumeric names with hyphens', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            const { stepPromise, ib } = await startPromptAndGetInputBox(ctx, mockResult);

            ib.changeValue('my-app-123');
            expect(ib.validationMessage).to.be.undefined;

            ib.accept();
            await stepPromise;
        });
    });
});
