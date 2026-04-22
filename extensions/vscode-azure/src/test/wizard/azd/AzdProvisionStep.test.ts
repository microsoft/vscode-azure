/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type { IAzdExecutor } from '../../../utils/AzdExecutor';
import { AzdProvisionStep } from '../../../wizard/azd/AzdProvisionStep';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';

function createMockAzd(): { azd: IAzdExecutor; provisionFn: ReturnType<typeof mock.fn> } {
    const provisionFn = mock.fn(() => Promise.resolve());
    return {
        azd: {
            init: mock.fn(() => Promise.resolve()) as unknown as IAzdExecutor['init'],
            envNew: mock.fn(() => Promise.resolve()) as unknown as IAzdExecutor['envNew'],
            envList: mock.fn(() => Promise.resolve([])) as unknown as IAzdExecutor['envList'],
            provision: provisionFn as unknown as IAzdExecutor['provision'],
        },
        provisionFn,
    };
}

describe('AzdProvisionStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when provision is true and iacFolder is set', () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();
            const step = new AzdProvisionStep(code, azd);

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when provision is false', () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();
            const step = new AzdProvisionStep(code, azd);

            const context = {
                provision: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when provision is undefined', () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();
            const step = new AzdProvisionStep(code, azd);

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();
            const step = new AzdProvisionStep(code, azd);

            const context = {
                provision: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();
            const step = new AzdProvisionStep(code, azd);

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd provision with the iac folder', async () => {
            const yamlUri = MockUri.file('/project/azure.yaml');
            const mockResult = createMockVsCode();
            mockResult.fs.addFile(yamlUri);

            const { azd, provisionFn } = createMockAzd();
            const step = new AzdProvisionStep(mockResult.vscode, azd);
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            expect(provisionFn.mock.callCount()).to.equal(1);
            expect((provisionFn.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
        });

        it('should throw when azure.yaml is not found', async () => {
            const { vscode: code } = createMockVsCode();
            const { azd } = createMockAzd();

            const step = new AzdProvisionStep(code, azd);
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            try {
                await step.execute(context);
                expect.fail('Expected an error');
            } catch (e) {
                expect((e as Error).message).to.include('Could not find azure.yaml');
            }
        });
    });
});
