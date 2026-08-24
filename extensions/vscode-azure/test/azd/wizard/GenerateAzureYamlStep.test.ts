/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MockUri } from '@microsoft/vscode-azure-utils/testing';
import type * as vscode from 'vscode';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { GenerateAzureYamlStep } from '../../../src/azd/wizard/GenerateAzureYamlStep';
import { createMockAzdService } from '../MockAzdService';

describe('GenerateAzureYamlStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return false when iacFolder is not set', async () => {
            const azd = createMockAzdService();
            const step = new GenerateAzureYamlStep(azd);

            expect(await step.shouldExecute({})).to.be.false;
        });

        it('should return true when azure.yaml does not exist', async () => {
            const azd = createMockAzdService();
            const step = new GenerateAzureYamlStep(azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.true;
        });

        it('should return false when azure.yaml exists', async () => {
            const azd = createMockAzdService();
            azd.findAzureYaml.mock.mockImplementation(
                () => Promise.resolve([MockUri.file('/project/azure.yaml')]),
            );
            const step = new GenerateAzureYamlStep(azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });

        it('should return false when azure.yml exists', async () => {
            const azd = createMockAzdService();
            azd.findAzureYaml.mock.mockImplementation(
                () => Promise.resolve([MockUri.file('/project/azure.yml')]),
            );
            const step = new GenerateAzureYamlStep(azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd init with the iac folder', async () => {
            const azd = createMockAzdService();
            const step = new GenerateAzureYamlStep(azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            await step.execute(context);

            expect(azd.init.mock.callCount()).to.equal(1);
            expect((azd.init.mock.calls[0].arguments[0] as vscode.Uri).path).to.equal('/project');
        });
    });
});
