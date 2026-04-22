/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockCodeContext, MockUri, respondToPrompts } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { OfferSaveStep } from '../../../azd/wizard/OfferSaveStep';
import { TempProjectManager } from '../../../azd/wizard/TempProjectManager';

describe('OfferSaveStep (unit)', () => {
    describe('prompt', () => {
        it('should set provision=true and use workspace folder when Save & Deploy is picked', async () => {
            const folderUri = MockUri.file('/workspace');
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            respondToPrompts(mockResult, [
                { pick: 'Save & Deploy' },
            ]);

            const step = new OfferSaveStep(ctx, new TempProjectManager(ctx));
            const result = await step.prompt();

            expect(result.provision).to.be.true;
            expect((result.iacFolder as MockUri).path).to.equal('/workspace');
        });

        it('should set provision=false and use workspace folder when Save Only is picked', async () => {
            const folderUri = MockUri.file('/workspace');
            const { ctx, mock: mockResult } = createMockCodeContext();
            mockResult.workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            respondToPrompts(mockResult, [
                { pick: 'Save Only' },
            ]);

            const step = new OfferSaveStep(ctx, new TempProjectManager(ctx));
            const result = await step.prompt();

            expect(result.provision).to.be.false;
            expect((result.iacFolder as MockUri).path).to.equal('/workspace');
        });

        it('should set provision=true and use temp dir when Deploy Only is picked', async () => {
            const { ctx, mock: mockResult } = createMockCodeContext();

            respondToPrompts(mockResult, [
                { pick: 'Deploy Only' },
            ]);

            const step = new OfferSaveStep(ctx, new TempProjectManager(ctx));
            const result = await step.prompt();

            expect(result.provision).to.be.true;
            expect((result.iacFolder as MockUri).path).to.include('/mock/storage/iac/project-');
        });
    });
});
