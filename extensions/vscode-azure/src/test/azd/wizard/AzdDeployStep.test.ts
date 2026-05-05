/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { AzdDeployStep } from '../../../azd/wizard/AzdDeployStep';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const actionContext = createActionContext('test');
    const codeProvider = {
        trackDeployment: mock.fn((activity: Record<string, unknown>) => {
            // Return the same object so in-place mutations (status, endTime) are visible
            Object.assign(activity, { type: 'codeDeployment', startTime: new Date() });
            return activity;
        }),
    } as never;
    const step = new AzdDeployStep(actionContext, azd, output, codeProvider);
    return { azd, output, codeProvider, actionContext, step };
}

describe('AzdDeployStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when deploy is true and iacFolder is set', () => {
            const { step } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when deploy is false', () => {
            const { step } = createStep();

            const context = {
                deploy: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { step } = createStep();

            const context = {
                deploy: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { step } = createStep();

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd deployWithCapture with the iac folder', async () => {
            const { azd, step } = createStep();

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.deployWithCapture.mock.callCount()).to.equal(1);
            expect((azd.deployWithCapture.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
        });

        it('should populate endpointUrls on context when deploy returns URLs', async () => {
            const { azd, step } = createStep();

            azd.deployWithCapture.mock.mockImplementation(() => Promise.resolve({
                endpointUrls: ['https://myapp.azurewebsites.net'],
                completed: Promise.resolve(),
            }));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(context.endpointUrls).to.deep.equal(['https://myapp.azurewebsites.net']);
        });

        it('should not set endpointUrls when deploy returns no URLs', async () => {
            const { step } = createStep();

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(context.endpointUrls).to.be.undefined;
        });

        it('should track a code deployment activity', async () => {
            const { codeProvider, step } = createStep();

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            const trackFn = (codeProvider as unknown as { trackDeployment: ReturnType<typeof mock.fn> }).trackDeployment;
            expect(trackFn.mock.callCount()).to.equal(1);
            const arg = trackFn.mock.calls[0].arguments[0] as Record<string, unknown>;
            expect(arg.status).to.equal('Completed');
        });

        it('should mark activity as Failed and rethrow with suppressDisplay when deploy rejects', async () => {
            const { azd, codeProvider, actionContext, step } = createStep();

            azd.deployWithCapture.mock.mockImplementation(() => Promise.resolve({
                endpointUrls: [],
                completed: Promise.reject(new Error('deploy failed')),
            }));

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            try {
                await step.execute(context);
                expect.fail('Expected error');
            } catch (e) {
                expect((e as Error).message).to.equal('deploy failed');
            }

            const trackFn = (codeProvider as unknown as { trackDeployment: ReturnType<typeof mock.fn> }).trackDeployment;
            const arg = trackFn.mock.calls[0].arguments[0] as Record<string, unknown>;
            expect(arg.status).to.equal('Failed');
            expect(actionContext.errorHandling.suppressDisplay).to.be.true;
        });
    });
});
