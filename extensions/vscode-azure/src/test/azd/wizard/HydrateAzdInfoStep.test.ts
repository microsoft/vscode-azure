/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { HydrateAzdInfoStep } from '../../../azd/wizard/HydrateAzdInfoStep';
import { createMockAzdService } from '../MockAzdService';

describe('HydrateAzdInfoStep (unit)', () => {

    describe('prompt', () => {
        it('should return empty when no workspace folder exists', async () => {
            const { vscode: code } = createMockVsCode();

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, createMockAzdService());
            const result = await step.prompt();

            expect(result).to.deep.equal({});
        });

        it('should set iacFolder when azure.yaml exists', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const azd = createMockAzdService();
            azd.findAzureYaml.mock.mockImplementation(
                () => Promise.resolve(MockUri.file('/workspace/azure.yaml')),
            );

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, azd);
            const result = await step.prompt();

            expect((result.iacFolder as MockUri).path).to.equal('/workspace');
        });

        it('should not set iacFolder when no azure.yaml exists', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, createMockAzdService());
            const result = await step.prompt();

            expect(result.iacFolder).to.be.undefined;
        });

        it('should set environmentName from the default azd environment', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const envList = [
                { Name: 'staging', IsDefault: false },
                { Name: 'production', IsDefault: true },
            ];

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, createMockAzdService(envList));
            const result = await step.prompt();

            expect(result.environmentName).to.equal('production');
        });

        it('should not set environmentName when no default env exists', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const envList = [
                { Name: 'staging', IsDefault: false },
            ];

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, createMockAzdService(envList));
            const result = await step.prompt();

            expect(result.environmentName).to.be.undefined;
        });

        it('should not set environmentName when azd fails', async () => {
            const folderUri = MockUri.file('/workspace');
            const { vscode: code, workspaceFolders } = createMockVsCode();
            workspaceFolders.push({ uri: folderUri, name: 'workspace', index: 0 } as never);

            const failingAzd = createMockAzdService();
            failingAzd.envList.mock.mockImplementation(
                () => Promise.reject(new Error('azd not found')),
            );

            const step = new HydrateAzdInfoStep<AzdWizardContext>(code, failingAzd);
            const result = await step.prompt();

            expect(result.environmentName).to.be.undefined;
        });
    });
});
