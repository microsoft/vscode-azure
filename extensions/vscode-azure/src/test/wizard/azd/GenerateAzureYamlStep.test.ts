/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';
import { GenerateAzureYamlStep } from '../../../wizard/azd/GenerateAzureYamlStep';

describe('GenerateAzureYamlStep (unit)', () => {
    function createCodeWithFs(existingFiles: MockUri[] = []) {
        const { vscode: code, fs } = createMockVsCode();
        for (const uri of existingFiles) {
            fs.addFile(uri);
        }
        return code;
    }

    describe('shouldExecute', () => {
        it('should return false when iacFolder is not set', async () => {
            const code = createCodeWithFs();
            const step = new GenerateAzureYamlStep(code);

            expect(await step.shouldExecute({})).to.be.false;
        });

        it('should return true when azure.yaml does not exist', async () => {
            const code = createCodeWithFs();
            const step = new GenerateAzureYamlStep(code);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.true;
        });

        it('should return false when azure.yaml exists', async () => {
            const code = createCodeWithFs([MockUri.file('/project/azure.yaml')]);
            const step = new GenerateAzureYamlStep(code);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });

        it('should return false when azure.yml exists', async () => {
            const code = createCodeWithFs([MockUri.file('/project/azure.yml')]);
            const step = new GenerateAzureYamlStep(code);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call execAzd with init --minimal --no-prompt', async () => {
            const exec = mock.fn((..._args: unknown[]) => Promise.resolve({ stdout: '', stderr: '' }));
            const code = createCodeWithFs();
            const step = new GenerateAzureYamlStep(code, exec);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            await step.execute(context);

            expect(exec.mock.callCount()).to.equal(1);
            expect(exec.mock.calls[0].arguments[0]).to.deep.equal(['init', '--minimal', '--no-prompt']);
            expect(exec.mock.calls[0].arguments[1]).to.equal('/project');
        });
    });
});
