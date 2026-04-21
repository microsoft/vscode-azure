/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';
import { HydrateAzdInfoStep } from '../../../wizard/azd/HydrateAzdInfoStep';

describe('HydrateAzdInfoStep (unit)', () => {
    describe('prompt', () => {
        it('should return empty when no workspace folder exists', async () => {
            const { vscode: code } = createMockVsCode();

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code);
            const result = await step.prompt();

            expect(result).to.deep.equal({});
        });

        it('should set iacFolder when azure.yaml exists', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, fs, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);
            fs.addFile(MockUri.file('/workspace/azure.yaml'));

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code);
            const result = await step.prompt();

            expect((result.iacFolder as MockUri).path).to.equal('/workspace');
        });

        it('should not set iacFolder when no azure.yaml exists', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code);
            const result = await step.prompt();

            expect(result.iacFolder).to.be.undefined;
        });
    });
});
