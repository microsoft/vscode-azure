/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockSubscriptionProvider, makeSubscription } from '@microsoft/vscode-azure-azutils/testing';
import { createMockVsCode, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type { AzdDeploymentInfo, AzdProvisionCaptureResult } from '../../../azd/AzdService';
import { AzdProvisionStep } from '../../../azd/wizard/AzdProvisionStep';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep(options?: { subscriptionId?: string }) {
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const armProvider = { trackDeployment: mock.fn() } as never;
    const subscriptions = options?.subscriptionId
        ? [makeSubscription({ subscriptionId: options.subscriptionId })]
        : [];
    const subscriptionProvider = createMockSubscriptionProvider({ subscriptions });
    const step = new AzdProvisionStep(azd, output, armProvider, subscriptionProvider);
    return { azd, step, armProvider: armProvider as unknown as { trackDeployment: ReturnType<typeof mock.fn> }, output };
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

        it('should track ARM deployment when deployment info is found and subscription matches', async () => {
            const { azd, step, armProvider } = createStep({ subscriptionId: 'sub-1' });

            const deploymentInfo: AzdDeploymentInfo = { deploymentId: '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1', subscriptionId: 'sub-1' };
            const captureResult: AzdProvisionCaptureResult = {
                deploymentInfo: Promise.resolve(deploymentInfo),
                completed: Promise.resolve(),
            };
            azd.provisionWithCapture.mock.mockImplementation(() => Promise.resolve(captureResult));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            // Allow the non-blocking deploymentInfo.then() to settle
            await captureResult.deploymentInfo;
            // Yield to microtask queue so the .then() callback completes
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(1);
            expect(armProvider.trackDeployment.mock.calls[0].arguments[0]).to.equal(deploymentInfo.deploymentId);
        });

        it('should not track ARM deployment when no deployment info is found', async () => {
            const { azd, step, armProvider } = createStep({ subscriptionId: 'sub-1' });

            const captureResult: AzdProvisionCaptureResult = {
                deploymentInfo: Promise.resolve(undefined),
                completed: Promise.resolve(),
            };
            azd.provisionWithCapture.mock.mockImplementation(() => Promise.resolve(captureResult));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await captureResult.deploymentInfo;
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(0);
        });

        it('should not track ARM deployment when subscription cannot be resolved', async () => {
            // No subscriptions configured — resolveSubscription returns undefined
            const { azd, step, armProvider } = createStep();

            const deploymentInfo: AzdDeploymentInfo = { deploymentId: '/subscriptions/unknown/resourceGroups/rg1/providers/Microsoft.Resources/deployments/deploy-1', subscriptionId: 'unknown' };
            const captureResult: AzdProvisionCaptureResult = {
                deploymentInfo: Promise.resolve(deploymentInfo),
                completed: Promise.resolve(),
            };
            azd.provisionWithCapture.mock.mockImplementation(() => Promise.resolve(captureResult));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);
            await captureResult.deploymentInfo;
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(armProvider.trackDeployment.mock.callCount()).to.equal(0);
        });
    });
});
