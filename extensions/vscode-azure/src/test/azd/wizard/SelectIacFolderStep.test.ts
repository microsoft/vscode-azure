/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../../../azd/wizard/SelectIacFolderStep';
import { TempProjectManager } from '../../../azd/wizard/TempProjectManager';

describe('SelectIacFolderStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true when iacFolder is unset', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempProjectManager(ctx));
            expect(step.shouldPrompt({ job: 'deploy' })).to.be.true;
            expect(step.shouldPrompt({ job: 'createNew' })).to.be.true;
        });

        it('returns false when iacFolder is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempProjectManager(ctx));
            const context: Partial<AzdWizardContext> = {
                job: 'deploy',
                iacFolder: MockUri.file('/repo') as never,
            };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('createNew: allocates a temp dir from TempProjectManager (no prompt)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempProjectManager(ctx));

            const result = await step.prompt({ job: 'createNew' });

            // TempProjectManager creates dirs under storageUri/iac/.
            expect((result.iacFolder as MockUri).path).to.include('/iac/project-');
            // No quick picks shown.
            expect(mockResult.quickPicks.length).to.equal(0);
        });

        it('deploy: returns iacFolder from the workspace folder picker (single-root: silent)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push(
                { uri: MockUri.file('/repo'), name: 'repo', index: 0 } as never,
            );
            const step = new SelectIacFolderStep(ctx, new TempProjectManager(ctx));

            const result = await step.prompt({ job: 'deploy' });

            expect((result.iacFolder as MockUri).path).to.equal('/repo');
        });

        it('deploy: throws an explanatory error when no workspace folder is open', async () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempProjectManager(ctx));

            try {
                await step.prompt({ job: 'deploy' });
                expect.fail('Expected error');
            } catch (e) {
                expect(CancellationError.test(e)).to.be.false;
                expect((e as Error).message).to.include('Open a folder');
            }
        });
    });
});
