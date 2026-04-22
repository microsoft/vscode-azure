/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMockVsCode, MockUri } from '@microsoft/vscode-azure-utils/testing';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { mock } from 'node:test';
import type { IAzdExecutor } from '../../../utils/AzdExecutor';
import type { AzdWizardContext } from '../../../wizard/azd/AzdWizardContext';
import { GenerateAzureYamlStep } from '../../../wizard/azd/GenerateAzureYamlStep';

function createMockAzd(): { azd: IAzdExecutor; initFn: ReturnType<typeof mock.fn> } {
    const initFn = mock.fn((..._args: unknown[]) => Promise.resolve());
    return {
        azd: {
            init: initFn as unknown as IAzdExecutor['init'],
            envNew: mock.fn(() => Promise.resolve()) as unknown as IAzdExecutor['envNew'],
            envList: mock.fn(() => Promise.resolve([])) as unknown as IAzdExecutor['envList'],
            provision: mock.fn(() => Promise.resolve()) as unknown as IAzdExecutor['provision'],
        },
        initFn,
    };
}

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
            const { azd } = createMockAzd();
            const step = new GenerateAzureYamlStep(code, azd);

            expect(await step.shouldExecute({})).to.be.false;
        });

        it('should return true when azure.yaml does not exist', async () => {
            const code = createCodeWithFs();
            const { azd } = createMockAzd();
            const step = new GenerateAzureYamlStep(code, azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.true;
        });

        it('should return false when azure.yaml exists', async () => {
            const code = createCodeWithFs([MockUri.file('/project/azure.yaml')]);
            const { azd } = createMockAzd();
            const step = new GenerateAzureYamlStep(code, azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });

        it('should return false when azure.yml exists', async () => {
            const code = createCodeWithFs([MockUri.file('/project/azure.yml')]);
            const { azd } = createMockAzd();
            const step = new GenerateAzureYamlStep(code, azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            expect(await step.shouldExecute(context)).to.be.false;
        });
    });

    describe('execute', () => {
        it('should call azd init with the iac folder', async () => {
            const code = createCodeWithFs();
            const { azd, initFn } = createMockAzd();
            const step = new GenerateAzureYamlStep(code, azd);

            const context = { iacFolder: MockUri.file('/project') } as AzdWizardContext;
            await step.execute(context);

            expect(initFn.mock.callCount()).to.equal(1);
            expect((initFn.mock.calls[0].arguments[0] as MockUri).path).to.equal('/project');
        });
    });
});
