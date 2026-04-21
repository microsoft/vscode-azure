/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import type { Mock } from 'node:test';
import { AzdProvisionStep } from '../../../wizard/azd/AzdProvisionStep';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';

describe('AzdProvisionStep (unit)', () => {
    describe('shouldExecute', () => {
        it('should return true when provision is true and iacFolder is set', () => {
            const { vscode: code } = createMockVsCode();
            const step = new AzdProvisionStep(code);

            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.true;
        });

        it('should return false when provision is false', () => {
            const { vscode: code } = createMockVsCode();
            const step = new AzdProvisionStep(code);

            const context = {
                provision: false,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when provision is undefined', () => {
            const { vscode: code } = createMockVsCode();
            const step = new AzdProvisionStep(code);

            const context = {
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when iacFolder is undefined', () => {
            const { vscode: code } = createMockVsCode();
            const step = new AzdProvisionStep(code);

            const context = {
                provision: true,
            } as AzdWizardContext;

            expect(step.shouldExecute(context)).to.be.false;
        });

        it('should return false when both are missing', () => {
            const { vscode: code } = createMockVsCode();
            const step = new AzdProvisionStep(code);

            expect(step.shouldExecute({})).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call provision command with azure.yaml URI', async () => {
            const yamlUri = MockUri.file('/project/azure.yaml');
            const mockResult = createMockVsCode();
            mockResult.fs.addFile(yamlUri);

            const step = new AzdProvisionStep(mockResult.vscode);
            const context = {
                provision: true,
                iacFolder: MockUri.file('/project'),
            } as AzdWizardContext;

            await step.execute(context);

            const executeCommand = mockResult.commands.executeCommand as unknown as Mock<typeof mockResult.commands.executeCommand>;
            expect(executeCommand.mock.callCount()).to.equal(1);
            const args = executeCommand.mock.calls[0].arguments;
            expect(args[0]).to.equal('azure-dev.commands.cli.provision');
            expect((args[1] as MockUri).path).to.equal(yamlUri.path);
        });

        it('should throw when azure.yaml is not found', async () => {
            const { vscode: code } = createMockVsCode();

            const step = new AzdProvisionStep(code);
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
