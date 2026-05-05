/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockSubscriptionProvider } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { AzdProvisionStep } from '../../../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const armProvider = { trackDeployment: mock.fn() } as never;
    const subscriptionProvider = createMockSubscriptionProvider({ subscriptions: [] });
    const step = new AzdProvisionStep(azd, output, armProvider, subscriptionProvider);
    return { azd, step };
}

describe('AzdProvisionStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when provision is true and iacFolder is set', () => {
            const { step } = createStep();

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when provision is false', () => {
            const { step } = createStep();

            const context = {
                provision: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when provision is undefined', () => {
            const { step } = createStep();

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { step } = createStep();

            const context = {
                provision: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { step } = createStep();

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd provisionWithCapture with the iac folder', async () => {
            const yamlUri = MockUri.file('/project/azure.yaml');
            const mockResult = createMockVsCode();
            mockResult.fs.addFile(yamlUri);

            const { azd, step } = createStep();
            azd.findAzureYaml.mock.mockImplementation(
                () => Promise.resolve(MockUri.file('/project/azure.yaml')),
            );
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.provisionWithCapture.mock.callCount()).to.equal(1);
            expect((azd.provisionWithCapture.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
        });
    });
});
