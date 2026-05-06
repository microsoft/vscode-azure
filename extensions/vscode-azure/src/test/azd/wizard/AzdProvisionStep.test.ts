/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockSubscriptionProvider } from '@microsoft/vscode-azure-azutils/testing';
import { createMockCodeContext, MockOutputChannel, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import { AzdProvisionStep } from '../../../azd/wizard/AzdProvisionStep';
import { TempDirManager } from '../../../azd/TempDirManager';
import type { AzdWizardContext } from '../../../azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const { ctx } = createMockCodeContext();
    const azd = createMockAzdService();
    const output = new MockOutputChannel('test');
    const armProvider = { trackDeployment: mock.fn() } as never;
    const subscriptionProvider = createMockSubscriptionProvider({ subscriptions: [] });
    const tempDirManager = new TempDirManager(ctx);
    const step = new AzdProvisionStep(ctx, azd, output, armProvider, subscriptionProvider, tempDirManager);
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
        it('should call azd.provision with the iac folder and AZD_DEPLOYMENT_ID_FILE env', async () => {
            const { azd, step } = createStep();
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.provision.mock.callCount()).to.equal(1);
            expect((azd.provision.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
            const env = azd.provision.mock.calls[0].arguments[1] as Record<string, string>;
            expect(env).to.have.property('AZD_DEPLOYMENT_ID_FILE');
        });
    });
});
