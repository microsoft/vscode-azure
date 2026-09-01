/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createActionContext } from '@microsoft/vscode-azure-utils';
import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { mock } from 'node:test';
import { AzdDeployStep } from '../../../src/azd/wizard/AzdDeployStep';
import type { AzdWizardContext } from '../../../src/azd/wizard/AzdWizardContext';
import { createMockAzdService } from '../MockAzdService';

function createStep() {
    const azd = createMockAzdService();
    const actionContext = createActionContext('test');
    const mockCode = createMockVsCode();
    const completeFn = mock.fn();
    const addChildFn = mock.fn();
    const codeProvider = {
        trackDeployment: mock.fn(() => ({
            id: 'test-id',
            complete: completeFn,
            addChild: addChildFn,
        })),
    } as never;
    const step = new AzdDeployStep(actionContext, mockCode.vscode, azd, codeProvider);
    return { azd, codeProvider, actionContext, step, completeFn, addChildFn, mockCode };
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
        it('should focus the activity view', async () => {
            const { step, mockCode } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            const executeCmd = mockCode.commands.executeCommand as unknown as ReturnType<typeof mock.fn>;
            expect(executeCmd.mock.callCount()).to.be.greaterThanOrEqual(1);
            expect(executeCmd.mock.calls[0].arguments[0]).to.equal('vscode-azure/activity.focus');
        });

        it('should call azd.deploy with the iac folder', async () => {
            const { azd, step } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(azd.deploy.mock.callCount()).to.equal(1);
            expect((azd.deploy.mock.calls[0].arguments[0]).path).to.equal('/project');
        });

        it('should track a code deployment activity', async () => {
            const { step, completeFn } = createStep();

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(completeFn.mock.callCount()).to.equal(1);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Completed');
        });

        it('should mark activity as Failed and rethrow with suppress display when deploy rejects', async () => {
            const { azd, actionContext, step, completeFn } = createStep();

            azd.deploy.mock.mockImplementation(() => Promise.reject(new Error('deploy failed')));

            const context = {
                deploy: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await expect(step.execute(context)).to.be.rejectedWith('deploy failed');

            expect(completeFn.mock.callCount()).to.equal(1);
            expect(completeFn.mock.calls[0].arguments[0]).to.equal('Failed');
            expect(completeFn.mock.calls[0].arguments[1]).to.be.instanceOf(Error);
            expect(actionContext.errorHandling.suppress).to.equal('display');
        });
    });
});
