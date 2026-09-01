/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../../../src/azd/wizard/SelectIacFolderStep';
import { createMockAzdService } from '../MockAzdService';

describe('SelectIacFolderStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true when iacFolder is unset', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());
            expect(step.shouldPrompt({ job: 'deploy' })).to.be.true;
            expect(step.shouldPrompt({ job: 'createNew' })).to.be.true;
        });

        it('returns false when iacFolder is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());
            const context: Partial<AzdWizardContext> = {
                job: 'deploy',
                iacFolder: MockUri.file('/repo'),
            };
            expect(step.shouldPrompt(context)).to.be.false;
        });
    });

    describe('prompt', () => {
        it('createNew: allocates a temp dir from TempDirManager (no prompt)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());

            const result = await step.prompt({ job: 'createNew' });

            // TempDirManager creates dirs under storageUri/tmp/.
            expect((result.iacFolder!).path).to.include('/tmp/d-');
            // No quick picks shown.
            expect(mockResult.quickPicks.length).to.equal(0);
        });

        it('deploy: returns iacFolder from the workspace folder picker (single-root: silent)', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push(
                { uri: MockUri.file('/repo'), name: 'repo', index: 0 },
            );
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());

            const result = await step.prompt({ job: 'deploy', resourceDisplayName: 'Function App' });

            expect((result.iacFolder!).path).to.equal('/repo');
        });

        it('deploy: throws an explanatory error when no workspace folder is open', async () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());

            const error: Error = await expect(step.prompt({ job: 'deploy', resourceDisplayName: 'Function App' })).to.be.rejectedWith(Error, 'Open a folder');
            expect(CancellationError.test(error)).to.be.false;
        });

        it('deploy: refuses to guess a product name when the wizard did not supply one', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push(
                { uri: MockUri.file('/repo'), name: 'repo', index: 0 },
            );
            const step = new SelectIacFolderStep(createActionContext('test'), ctx, new TempDirManager(ctx), createMockAzdService());

            await expect(step.prompt({ job: 'deploy' })).to.be.rejectedWith(Error, 'requires resourceDisplayName');
        });
    });
});
