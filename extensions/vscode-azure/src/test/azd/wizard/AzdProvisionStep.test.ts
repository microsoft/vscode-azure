/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { AzdProvisionStep } from '../../../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

describe('AzdProvisionStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when provision is true and iacFolder is set', () => {
            const azd = createMockAzdService();
            const step = new AzdProvisionStep(azd);

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when provision is false', () => {
            const azd = createMockAzdService();
            const step = new AzdProvisionStep(azd);

            const context = {
                provision: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when provision is undefined', () => {
            const azd = createMockAzdService();
            const step = new AzdProvisionStep(azd);

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const azd = createMockAzdService();
            const step = new AzdProvisionStep(azd);

            const context = {
                provision: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const azd = createMockAzdService();
            const step = new AzdProvisionStep(azd);

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd provision with the iac folder', async () => {
            const yamlUri = MockUri.file('/project/azure.yaml');
            const mockResult = createMockVsCode();
            mockResult.fs.addFile(yamlUri);

            const azd = createMockAzdService();
            azd.findAzureYaml.mock.mockImplementation(
                () => Promise.resolve(MockUri.file('/project/azure.yaml')),
            );
            const step = new AzdProvisionStep(azd);
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.provision.mock.callCount()).to.equal(1);
            expect((azd.provision.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
        });
    });
});
