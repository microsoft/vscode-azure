/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { delay } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { ProjectNameStep } from '../../../azd/wizard/ProjectNameStep';

describe('ProjectNameStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true when environmentName is not set', () => {
            const { ctx } = createMockCodeContext();
            const step = new ProjectNameStep(ctx);
            expect(step.shouldPrompt({})).to.be.true;
        });

        it('returns false when environmentName is set (hydrated)', () => {
            const { ctx } = createMockCodeContext();
            const step = new ProjectNameStep(ctx);
            const context: Partial<AzdWizardContext> = { environmentName: 'prod' };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('derives environmentName and azdServiceName from a single input', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [
                { input: 'my-app' },
            ]);

            const step = new ProjectNameStep(ctx);
            const result = await step.prompt({});

            expect(result.environmentName).to.equal('my-app');
            expect(result.azdServiceName).to.equal('my-app');
        });

        it('preserves azdServiceName when already set by hydration', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, [
                { input: 'my-app' },
            ]);

            const step = new ProjectNameStep(ctx);
            const result = await step.prompt({ azdServiceName: 'existing-svc' });

            expect(result.environmentName).to.equal('my-app');
            expect(result.azdServiceName).to.be.undefined;
        });

        it('uses iacFolder basename as the input fallback (no folder picker)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            respondToPrompts(mockResult, ['acceptDefault']);

            const step = new ProjectNameStep(ctx);
            const result = await step.prompt({ iacFolder: MockUri.file('/tmp/my-cool-project') });

            expect(result.environmentName).to.equal('my-cool-project');
        });

        it('falls back to the first workspace folder name without prompting', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push({ uri: MockUri.file('/repo/my-app'), name: 'my-app', index: 0 });
            respondToPrompts(mockResult, ['acceptDefault']);

            const step = new ProjectNameStep(ctx);
            const result = await step.prompt({});

            expect(result.environmentName).to.equal('my-app');
        });

        it('does not show a workspace-folder picker even with multiple workspace folders', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push(
                { uri: MockUri.file('/a'), name: 'a', index: 0 },
                { uri: MockUri.file('/b'), name: 'b', index: 1 },
            );
            respondToPrompts(mockResult, [{ input: 'chosen-name' }]);

            const step = new ProjectNameStep(ctx);
            await step.prompt({});

            // Only the project-name input box should appear -- no folder quick pick.
            expect(mockResult.quickPicks.length).to.equal(0);
        });
    });

    describe('validation', () => {
        async function startPromptAndGetInputBox(ctx: ReturnType<typeof createMockCodeContext>['ctx'], mock: ReturnType<typeof createMockCodeContext>['mock']) {
            const step = new ProjectNameStep(ctx);
            const stepPromise = step.prompt({});
            while (mock.inputBoxes.length === 0) {
                await delay(0);
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
