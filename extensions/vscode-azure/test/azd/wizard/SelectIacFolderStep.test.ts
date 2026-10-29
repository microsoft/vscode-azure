/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, ExternalError } from '@microsoft/vscode-azure-utils';
import { createMockCodeContext, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { TempDirManager } from '../../../src/azd/TempDirManager';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { SelectIacFolderStep } from '../../../src/azd/wizard/SelectIacFolderStep';
import { createMockAzdService } from '../MockAzdService';

describe('SelectIacFolderStep (unit)', () => {
    describe('shouldPrompt', () => {
        it('returns true when iacFolder is unset', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());
            expect(step.shouldPrompt({ job: 'deploy' })).to.be.true;
            expect(step.shouldPrompt({ job: 'createNew' })).to.be.true;
        });

        it('returns false when iacFolder is already set', () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());
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
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

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
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

            const result = await step.prompt({ job: 'deploy', resourceDisplayName: 'Function App' });

            expect((result.iacFolder!).path).to.equal('/repo');
        });

        it('deploy: throws an explanatory error when no workspace folder is open', async () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

            const error: Error = await expect(step.prompt({ job: 'deploy', resourceDisplayName: 'Function App' })).to.be.rejectedWith(ExternalError, 'Open a folder');
            expect(CancellationError.test(error)).to.be.false;
        });

        it('requires an open workspace folder to find an azure.yaml file', async () => {
            const { ctx } = createMockCodeContext();
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

            await expect(step.prompt({})).to.be.rejectedWith(ExternalError, 'No workspace folder is open');
        });

        it('explains when the workspace contains no azure.yaml file', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push({ uri: MockUri.file('/repo'), name: 'repo', index: 0 });
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

            await expect(step.prompt({})).to.be.rejectedWith(ExternalError, 'No azure.yaml file found');
        });

        it('deploy: refuses to guess a product name when the wizard did not supply one', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push(
                { uri: MockUri.file('/repo'), name: 'repo', index: 0 },
            );
            const step = new SelectIacFolderStep(ctx, new TempDirManager(ctx), createMockAzdService());

            await expect(step.prompt({ job: 'deploy' })).to.be.rejectedWith(Error, 'requires resourceDisplayName');
        });

        describe('in an untrusted workspace', () => {
            function untrusted() {
                const { ctx, mock: mockResult } = createMockCodeContext();
                mockResult.workspaceFolders.push({ uri: MockUri.file('/repo'), name: 'repo', index: 0 });
                mock.property(mockResult.workspace, 'isTrusted', false);
                const azd = createMockAzdService();
                azd.findAzureYaml.mock.mockImplementation(() => Promise.resolve([MockUri.file('/repo/azure.yaml')]));
                return { step: new SelectIacFolderStep(ctx, new TempDirManager(ctx), azd), mockResult, azd };
            }

            it('deploy: rejects before showing any prompt', async () => {
                const { step, mockResult } = untrusted();

                await expect(step.prompt({ job: 'deploy', resourceDisplayName: 'Function App' })).to.be.rejectedWith(ExternalError, 'untrusted workspace');

                expect(mockResult.quickPicks.length).to.equal(0);
            });

            it('no job: rejects without scanning workspace folders for azure.yaml', async () => {
                const { step, azd } = untrusted();

                await expect(step.prompt({})).to.be.rejectedWith(ExternalError, 'untrusted workspace');

                expect(azd.findAzureYaml.mock.callCount()).to.equal(0);
            });

            it('createNew: still allocates a temp dir', async () => {
                const { step } = untrusted();

                const result = await step.prompt({ job: 'createNew' });

                expect((result.iacFolder!).path).to.include('/tmp/d-');
            });
        });
    });
});
